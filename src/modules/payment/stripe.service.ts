import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import Stripe from "stripe";
import {
  WebhookEvent,
  WebhookEventDocument,
} from "./schemas/webhook-event.schema";
import { OrderService } from "../order/order.service";
import { InventoryService } from "../inventory/inventory.service";
import { CustomOrderService } from "../custom-order/custom-order.service";
import { OrderDocument } from "../order/schemas/order.schema";

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    @InjectModel(WebhookEvent.name)
    private readonly webhookModel: Model<WebhookEventDocument>,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
    private readonly customOrderService: CustomOrderService,
    private readonly config: ConfigService,
  ) {
    // Instantiate with empty key when disabled — methods throw before making calls
    this.stripe = new Stripe(
      this.config.get<string>("stripe.secretKey") ?? "",
      { apiVersion: "2024-06-20" as Stripe.LatestApiVersion },
    );
  }

  // ─── Feature flag guard ────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (this.config.get<string>("stripe.enabled") !== "true") {
      throw new BadRequestException(
        "Stripe is not enabled on this deployment. " +
          "Set STRIPE_ENABLED=true once a Stripe-supported entity and account exist.",
      );
    }
  }

  // ─── Create Checkout Session ───────────────────────────────────────────────

  /**
   * Creates a Stripe Checkout Session for an order.
   *
   * Uses order.chargeTotal (minor units) and order.chargeCurrency as the
   * exact amount — never recomputes from current FX rates.
   * The idempotency key is the order's paymentReference so retries are safe.
   */
  async createCheckoutSession(
    order: OrderDocument,
  ): Promise<{ checkoutUrl: string; reference: string }> {
    this.assertEnabled();

    const orderId = (order._id as unknown as Types.ObjectId).toString();
    const storefrontUrl = this.config.get<string>(
      "storefront.baseUrl",
      "http://localhost:3000",
    );

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: order.chargeCurrency.toLowerCase(),
              // chargeTotal is already in the currency's minor unit (cents, etc.)
              unit_amount: order.chargeTotal!,
              product_data: {
                name: `Labi Order ${order.orderNumber}`,
                description: `${order.items.length} item${order.items.length !== 1 ? "s" : ""}`,
              },
            },
          },
        ],
        client_reference_id: order.paymentReference,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
        },
        success_url: `${storefrontUrl}/checkout/confirm?ref=${order.paymentReference}`,
        cancel_url: `${storefrontUrl}/checkout`,
      },
      {
        idempotencyKey: `session-${order.paymentReference}`,
      },
    );

    return {
      checkoutUrl: session.url!,
      reference: order.paymentReference,
    };
  }

  // ─── Webhook handling ──────────────────────────────────────────────────────

  /**
   * Verifies the Stripe webhook signature and dispatches to the event handler.
   * Raw body must be passed exactly as received (NestJS rawBody: true).
   */
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.assertEnabled();

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get<string>("stripe.webhookSecret")!,
      );
    } catch (err) {
      this.logger.warn(
        `Stripe webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException("Invalid Stripe webhook signature");
    }

    await this.handleStripeEvent(event);
  }

  /**
   * Processes a verified Stripe event.
   * Idempotent: stores the event ID in WebhookEvent before processing;
   * duplicate event IDs are skipped silently.
   */
  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    const eventId = `stripe:${event.id}`;

    // Idempotency check — same pattern as Paystack/Flutterwave
    const existing = await this.webhookModel.findOne({ eventId }).lean();
    if (existing) {
      this.logger.log(`Duplicate Stripe webhook ${eventId} — skipping`);
      return;
    }

    let orderId: string | null = null;

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.payment_status === "paid") {
            const order = await this.resolveOrder(session.client_reference_id);
            if (order) {
              orderId = (order._id as unknown as Types.ObjectId).toString();

              // Amount/currency assertion (spec §7.3, A6, A12)
              const expectedAmount =
                order.chargeTotal ?? Math.round(order.total * 100);
              const expectedCurrency = (
                order.chargeCurrency ?? "NGN"
              ).toLowerCase();
              const actualAmount = session.amount_total ?? undefined;
              const actualCurrency = session.currency ?? undefined;

              if (actualAmount != null && actualAmount !== expectedAmount) {
                await this.orderService.flagPayment(
                  orderId,
                  `Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`,
                );
              } else if (
                actualCurrency &&
                actualCurrency !== expectedCurrency
              ) {
                await this.orderService.flagPayment(
                  orderId,
                  `Currency mismatch: expected ${expectedCurrency}, got ${actualCurrency}`,
                );
              } else {
                await this.orderService.markPaid(orderId, eventId);
                for (const item of order.items) {
                  await this.inventoryService.commitReservedStock(
                    item.productId,
                    item.qty,
                  );
                }
              }
            }
          }
          break;
        }

        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;
          const order = await this.resolveOrder(session.client_reference_id);
          if (order) {
            orderId = (order._id as unknown as Types.ObjectId).toString();
            await this.orderService.markAbandoned(orderId);
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const pi = event.data.object as Stripe.PaymentIntent;
          // Find order via the payment intent's client reference (metadata)
          const ref = pi.metadata?.paymentReference;
          if (ref) {
            const order = await this.orderService.findByReference(ref);
            if (order) {
              orderId = (order._id as unknown as Types.ObjectId).toString();
              await this.orderService.markFailed(orderId);
            }
          }
          break;
        }

        case "charge.refunded": {
          const charge = event.data.object as Stripe.Charge;
          const ref = charge.metadata?.paymentReference;
          if (ref) {
            const order = await this.orderService.findByReference(ref);
            if (order) {
              orderId = (order._id as unknown as Types.ObjectId).toString();
              // Update status to refunded (reuse markCancelled pattern with new status)
              await this.orderService.markRefunded(orderId);
            }
          }
          break;
        }

        default:
          this.logger.log(`Unhandled Stripe event type: ${event.type}`);
      }

      await this.webhookModel.create({
        provider: "stripe",
        eventId,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
        orderId,
        processedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`Error processing Stripe event ${eventId}`, err);
      throw err;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async resolveOrder(
    clientReferenceId: string | null,
  ): Promise<OrderDocument | null> {
    if (!clientReferenceId) return null;
    return this.orderService.findByReference(clientReferenceId);
  }
}
