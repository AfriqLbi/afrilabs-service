import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as crypto from "crypto";
import {
  WebhookEvent,
  WebhookEventDocument,
} from "./schemas/webhook-event.schema";
import { OrderService } from "../order/order.service";
import { InventoryService } from "../inventory/inventory.service";
import { CustomOrderService } from "../custom-order/custom-order.service";
import { OrderDocument } from "../order/schemas/order.schema";

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  data: { status: string; reference: string; id: number };
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectModel(WebhookEvent.name)
    private readonly webhookModel: Model<WebhookEventDocument>,
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
    private readonly customOrderService: CustomOrderService,
    private readonly config: ConfigService,
  ) {}

  // ─── Paystack: initialize ─────────────────────────────────────────────────

  async initializePaystack(
    order: OrderDocument,
  ): Promise<{ checkoutUrl: string; reference: string }> {
    const secretKey = this.config.get<string>("paystack.secretKey");
    const orderId = (order._id as unknown as Types.ObjectId).toString();
    const body = JSON.stringify({
      email: order.customerEmail ?? "guest@alphavista.ng",
      amount: Math.round(order.total * 100),
      reference: order.paymentReference,
      callback_url: `${this.config.get("storefront.baseUrl")}/checkout/confirm?ref=${order.paymentReference}`,
      metadata: { orderId, orderNumber: order.orderNumber },
    });

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok)
      throw new BadRequestException("Paystack initialization failed");

    const data = (await res.json()) as PaystackInitResponse;
    return {
      checkoutUrl: data.data.authorization_url,
      reference: data.data.reference,
    };
  }

  // ─── Flutterwave: initialize ──────────────────────────────────────────────

  async initializeFlutterwave(
    order: OrderDocument,
  ): Promise<{ checkoutUrl: string; reference: string }> {
    const secretKey = this.config.get<string>("flutterwave.secretKey");
    const orderId = (order._id as unknown as Types.ObjectId).toString();

    // Use chargeCurrency when available (non-NGN multi-currency orders).
    // Falls back to "NGN" for legacy orders without the field.
    const currency = order.chargeCurrency ?? "NGN";

    // For non-NGN orders use chargeTotal (already in minor units of currency).
    // For NGN orders keep using order.total (in kobo → divide by 100 for Flutterwave).
    const amount =
      currency === "NGN"
        ? order.total // Flutterwave accepts NGN in full naira
        : (order.chargeTotal ?? Math.round(order.total * 100)) / 100;

    const body = JSON.stringify({
      tx_ref: order.paymentReference,
      amount,
      currency,
      redirect_url: `${this.config.get("storefront.baseUrl")}/checkout/confirm?ref=${order.paymentReference}`,
      customer: {
        email: order.customerEmail ?? "guest@labi.ng",
        name: order.customerName ?? "Guest",
      },
      meta: { orderId },
    });

    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok)
      throw new BadRequestException("Flutterwave initialization failed");

    const data = (await res.json()) as {
      status: string;
      data: { link: string };
    };
    return { checkoutUrl: data.data.link, reference: order.paymentReference };
  }

  // ─── Webhook: Paystack ────────────────────────────────────────────────────

  async handlePaystackWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const secret = this.config.get<string>("paystack.webhookSecret")!;
    const expected = crypto
      .createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex"),
      )
    ) {
      throw new UnauthorizedException("Invalid Paystack webhook signature");
    }

    const event = JSON.parse(rawBody.toString()) as {
      event: string;
      data: {
        id: number;
        reference: string;
        status: string;
        amount?: number;
        currency?: string;
      };
    };

    const eventId = `paystack:${event.data.id}`;
    const existing = await this.webhookModel.findOne({ eventId }).lean();
    if (existing) {
      this.logger.log(`Duplicate Paystack webhook ${eventId} — skipping`);
      return;
    }

    await this.processPaystackEvent(event, eventId);
  }

  private async processPaystackEvent(
    event: {
      event: string;
      data: {
        id: number;
        reference: string;
        status: string;
        amount?: number;
        currency?: string;
      };
    },
    eventId: string,
  ): Promise<void> {
    const reference = event.data.reference;
    const order = await this.orderService.findByReference(reference);

    // Route to custom-order service when the reference belongs to a custom order
    const customOrder = !order
      ? await this.customOrderService.findByPaymentReference(reference)
      : null;

    try {
      if (event.event === "charge.success") {
        if (order) {
          // Amount/currency assertion (spec §7.3, A6, A12)
          const expectedAmount =
            order.chargeTotal ?? Math.round(order.total * 100);
          const expectedCurrency = (
            order.chargeCurrency ?? "NGN"
          ).toLowerCase();
          const actualCurrency = (event.data.currency ?? "NGN").toLowerCase();

          if (
            event.data.amount != null &&
            event.data.amount !== expectedAmount
          ) {
            await this.orderService.flagPayment(
              (order._id as unknown as Types.ObjectId).toString(),
              `Amount mismatch: expected ${expectedAmount}, got ${event.data.amount}`,
            );
          } else if (actualCurrency !== expectedCurrency) {
            await this.orderService.flagPayment(
              (order._id as unknown as Types.ObjectId).toString(),
              `Currency mismatch: expected ${expectedCurrency}, got ${actualCurrency}`,
            );
          } else {
            // Standard catalog order: confirm + commit stock
            await this.orderService.markPaid(
              (order._id as unknown as Types.ObjectId).toString(),
              eventId,
            );
            for (const item of order.items) {
              await this.inventoryService.commitReservedStock(
                item.productId,
                item.qty,
              );
            }
          }
        } else if (customOrder) {
          // BUSINESS RULE: custom order enters production ONLY via this webhook path
          await this.customOrderService.confirmPayment(reference, eventId);
        }
      } else if (
        event.event === "charge.failed" ||
        event.event === "transfer.failed"
      ) {
        if (order) {
          await this.orderService.markFailed(
            (order._id as unknown as Types.ObjectId).toString(),
          );
        } else if (customOrder) {
          await this.customOrderService.handlePaymentFailed(reference);
        }
      }

      const linkedId = order
        ? (order._id as unknown as Types.ObjectId).toString()
        : customOrder
          ? (customOrder._id as unknown as Types.ObjectId).toString()
          : null;

      await this.webhookModel.create({
        provider: "paystack",
        eventId,
        type: event.event,
        payload: event as unknown as Record<string, unknown>,
        orderId: linkedId,
        processedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`Error processing webhook ${eventId}`, err);
      throw err;
    }
  }

  // ─── Webhook: Flutterwave ─────────────────────────────────────────────────

  async handleFlutterwaveWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const secret = this.config.get<string>("flutterwave.secretKey")!;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature ?? "", "hex"),
      )
    ) {
      throw new UnauthorizedException("Invalid Flutterwave webhook signature");
    }

    const event = JSON.parse(rawBody.toString()) as {
      event: string;
      data: {
        id: number;
        tx_ref: string;
        status: string;
        amount?: number;
        currency?: string;
      };
    };

    const eventId = `flutterwave:${event.data.id}`;
    const existing = await this.webhookModel.findOne({ eventId }).lean();
    if (existing) {
      this.logger.log(`Duplicate Flutterwave webhook ${eventId} — skipping`);
      return;
    }

    const order = await this.orderService.findByReference(event.data.tx_ref);
    const customOrder = !order
      ? await this.customOrderService.findByPaymentReference(event.data.tx_ref)
      : null;

    if (
      event.event === "charge.completed" &&
      event.data.status === "successful"
    ) {
      if (order) {
        // Amount/currency assertion (spec §7.3)
        const expectedAmount =
          order.chargeTotal ?? Math.round(order.total * 100);
        const expectedCurrency = (order.chargeCurrency ?? "NGN").toLowerCase();
        const actualAmount =
          event.data.amount != null
            ? Math.round(event.data.amount * 100)
            : undefined;
        const actualCurrency = (event.data.currency ?? "NGN").toLowerCase();

        if (actualAmount != null && actualAmount !== expectedAmount) {
          await this.orderService.flagPayment(
            (order._id as unknown as Types.ObjectId).toString(),
            `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`,
          );
        } else if (actualCurrency !== expectedCurrency) {
          await this.orderService.flagPayment(
            (order._id as unknown as Types.ObjectId).toString(),
            `Currency mismatch: expected ${expectedCurrency}, got ${actualCurrency}`,
          );
        } else {
          await this.orderService.markPaid(
            (order._id as unknown as Types.ObjectId).toString(),
            eventId,
          );
          for (const item of order.items) {
            await this.inventoryService.commitReservedStock(
              item.productId,
              item.qty,
            );
          }
        }
      } else if (customOrder) {
        // BUSINESS RULE: custom order enters production ONLY via this webhook path
        await this.customOrderService.confirmPayment(
          event.data.tx_ref,
          eventId,
        );
      }
    } else if (event.data.status === "failed") {
      if (order) {
        await this.orderService.markFailed(
          (order._id as unknown as Types.ObjectId).toString(),
        );
      } else if (customOrder) {
        await this.customOrderService.handlePaymentFailed(event.data.tx_ref);
      }
    }

    const linkedId = order
      ? (order._id as unknown as Types.ObjectId).toString()
      : customOrder
        ? (customOrder._id as unknown as Types.ObjectId).toString()
        : null;

    await this.webhookModel.create({
      provider: "flutterwave",
      eventId,
      type: event.event,
      payload: event as unknown as Record<string, unknown>,
      orderId: linkedId,
      processedAt: new Date(),
    });
  }

  // ─── Active verification ──────────────────────────────────────────────────

  async verifyPaystackTransaction(reference: string): Promise<string> {
    const secretKey = this.config.get<string>("paystack.secretKey");
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (!res.ok) return "unknown";
    const data = (await res.json()) as PaystackVerifyResponse;
    return data.data?.status ?? "unknown";
  }

  // ─── Refund (shipping adjustment — spec §8.4) ─────────────────────────────

  /**
   * Initiates a partial or full refund through the original payment gateway.
   * Returns a refundId if the gateway confirms, or an empty object on failure.
   */
  async refundOrder(
    order: OrderDocument,
    amountMinorUnits: number,
    reason: string,
  ): Promise<{ refundId?: string }> {
    const provider = order.paymentProvider;
    try {
      if (provider === "paystack") {
        return await this.refundPaystack(order, amountMinorUnits, reason);
      }
      if (provider === "flutterwave") {
        return await this.refundFlutterwave(order, amountMinorUnits, reason);
      }
      if (provider === "stripe") {
        return await this.refundStripe(order, amountMinorUnits);
      }
    } catch (err) {
      this.logger.error(
        `Refund failed for ${order.orderNumber} via ${provider}: ${(err as Error).message}`,
      );
    }
    return {};
  }

  private async refundPaystack(
    order: OrderDocument,
    amountMinorUnits: number,
    reason: string,
  ): Promise<{ refundId?: string }> {
    const secretKey = this.config.get<string>("paystack.secretKey");
    const res = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction: order.paymentReference,
        amount: amountMinorUnits,
        merchant_note: reason,
      }),
    });
    if (!res.ok) {
      this.logger.warn(
        `Paystack refund HTTP ${res.status} for ${order.orderNumber}`,
      );
      return {};
    }
    const data = (await res.json()) as { data: { id: number } };
    return { refundId: data.data?.id?.toString() };
  }

  private async refundFlutterwave(
    order: OrderDocument,
    amountMinorUnits: number,
    _reason: string,
  ): Promise<{ refundId?: string }> {
    const secretKey = this.config.get<string>("flutterwave.secretKey");
    // Flutterwave refunds require the transaction ID, not the reference.
    // We use the verify endpoint to look it up, then refund.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(order.paymentReference)}/verify`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (!verifyRes.ok) return {};
    const verifyData = (await verifyRes.json()) as { data: { id: number } };
    const txId = verifyData.data?.id;
    if (!txId) return {};

    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${txId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountMinorUnits / 100,
        }),
      },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { data: { id: number } };
    return { refundId: data.data?.id?.toString() };
  }

  private async refundStripe(
    order: OrderDocument,
    amountMinorUnits: number,
  ): Promise<{ refundId?: string }> {
    const secretKey = this.config.get<string>("stripe.secretKey");
    if (!secretKey) return {};
    // Retrieve the checkout session by the payment reference (metadata)
    const stripe = new (await import("stripe")).default(secretKey);
    const sessions = await stripe.checkout.sessions.list({
      limit: 1,
    });
    // Find the session matching this order's payment reference
    const session = sessions.data.find(
      (s) => s.client_reference_id === order.paymentReference,
    );
    if (!session?.payment_intent) return {};

    const refund = await stripe.refunds.create({
      payment_intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent,
      amount: amountMinorUnits,
    });
    return { refundId: refund.id };
  }
}
