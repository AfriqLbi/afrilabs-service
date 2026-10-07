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
      data: { id: number; reference: string; status: string };
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
      data: { id: number; reference: string; status: string };
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
      data: { id: number; tx_ref: string; status: string };
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
}
