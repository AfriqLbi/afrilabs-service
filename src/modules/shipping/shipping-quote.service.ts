import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { Model, Connection, Types } from "mongoose";
import { ConfigService } from "@nestjs/config";
import { Order, OrderDocument } from "../order/schemas/order.schema";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { InventoryService } from "../inventory/inventory.service";
import { SubmitQuoteDto, OverrideShippingFeeDto } from "./dto/shipping.dto";
import {
  QUEUE_SHIPPING,
  JOB_EXPIRE_SHIPPING_QUOTE,
  JOB_SHIPPING_QUOTE_REMINDER,
  JOB_SHIPPING_QUOTE_SLA,
} from "./shipping.constants";

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VALID_DAYS = 7;
const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000; // 24 h before expiry

@Injectable()
export class ShippingQuoteService {
  private readonly logger = new Logger(ShippingQuoteService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly inventoryService: InventoryService,
    @InjectQueue(QUEUE_SHIPPING) private readonly shippingQueue: Queue,
  ) {}

  // ─── Request quote ────────────────────────────────────────────────────────

  /**
   * Called by OrderService after creating an order in a quote zone.
   * Sets shippingStatus = AWAITING_QUOTE and enqueues admin SLA alert.
   */
  async requestQuote(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        shippingStatus: "AWAITING_QUOTE",
        shippingQuote: {
          requestedAt: new Date(),
          state: "REQUESTED",
        },
      },
      { new: true },
    );
    if (!order) throw new NotFoundException("Order not found");

    const slaHours = this.config.get<number>("shipping.quoteSlaHours", 24);

    // SLA reminder — fires if no quote has been submitted after N hours
    await this.shippingQueue
      .add(
        JOB_SHIPPING_QUOTE_SLA,
        { orderId },
        {
          delay: slaHours * 3600 * 1000,
          attempts: 2,
          backoff: { type: "fixed", delay: 60_000 },
          removeOnComplete: true,
        },
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to enqueue SLA job for ${orderId}: ${err.message}`,
        ),
      );

    // Notify admins that a quote is needed
    await this.notifications
      .sendShippingQuoteRequested(order)
      .catch((err: Error) =>
        this.logger.warn(
          `Quote-requested email failed for ${orderId}: ${err.message}`,
        ),
      );

    return order;
  }

  // ─── Submit quote (admin) ─────────────────────────────────────────────────

  /**
   * Admin sets the shipping fee for a quote-zone order.
   *
   * - Validates the order is in AWAITING_QUOTE state
   * - Validates the submitted currency matches the order's chargeCurrency
   * - Re-locks FX and recomputes chargeTotal inside a Mongo transaction
   * - Advances the order to PENDING_PAYMENT
   * - Enqueues expiry and reminder jobs keyed by orderId + quoteVersion
   * - Enqueues a customer notification email
   */
  async submitQuote(
    orderId: string,
    dto: SubmitQuoteDto,
    actorId: string,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");

    if (order.shippingStatus !== "AWAITING_QUOTE") {
      throw new BadRequestException(
        `Cannot submit a quote on an order with shippingStatus "${order.shippingStatus}". ` +
          `Order must be in AWAITING_QUOTE state.`,
      );
    }

    if (dto.currency !== order.chargeCurrency) {
      throw new BadRequestException(
        `Quote currency "${dto.currency}" does not match the order's charge currency "${order.chargeCurrency}". ` +
          `Submit the amount in ${order.chargeCurrency}.`,
      );
    }

    const validDays = dto.validDays ?? DEFAULT_VALID_DAYS;
    const validUntil = new Date(Date.now() + validDays * MS_PER_DAY);

    const session = await this.connection.startSession();
    let updated: OrderDocument;

    try {
      await session.withTransaction(async () => {
        // dto.amount is in minor units of order.chargeCurrency (e.g. EUR cents).
        // chargeTotal is also in chargeCurrency minor units — add directly.
        const newChargeTotal = (order.chargeTotal ?? 0) + dto.amount;

        // Convert the quote fee back to NGN kobo so shippingFee is stored
        // in a consistent unit (NGN kobo) across all order paths.
        // For NGN orders fxRate=1, so this is a no-op beyond ×100.
        const fxRate = order.fxRate ?? 1;
        const fxBuffer = order.fxBuffer ?? 0;
        // chargeAmount(minor) = ngnKobo × rate × (1+buf/100)
        // → ngnKobo = chargeAmount / (rate × (1+buf/100))
        const shippingFeeNgnKobo =
          fxRate > 0
            ? Math.round(dto.amount / (fxRate * (1 + fxBuffer / 100)))
            : Math.round(dto.amount); // NGN fallback

        updated = (await this.orderModel.findByIdAndUpdate(
          orderId,
          {
            status: "pending_payment",
            shippingStatus: "QUOTED",
            shippingFee: shippingFeeNgnKobo, // stored in NGN kobo (consistent with CALCULATED path)
            shippingFeeSource: "admin_quote",
            chargeTotal: newChargeTotal,
            reservationExpiresAt: validUntil,
            // Replace the whole shippingQuote subdocument in one operation.
            // Using dot-notation on a null field causes a MongoDB error:
            // "Cannot create field 'x' in element {shippingQuote: null}"
            shippingQuote: {
              requestedAt: order.shippingQuote?.requestedAt ?? new Date(),
              quotedAt: new Date(),
              quotedBy: new Types.ObjectId(actorId),
              currency: dto.currency,
              amount: dto.amount,
              carrier: dto.carrier ?? null,
              etaDays: dto.etaDays ?? null,
              note: dto.note ?? null,
              validUntil,
              state: "QUOTED",
            },
          },
          { new: true, session },
        ))!;
      });
    } finally {
      await session.endSession();
    }

    const oid = (order._id as unknown as Types.ObjectId).toString();

    // Extend stock reservations to validUntil (spec §8.2, §4)
    await this.orderModel
      .findByIdAndUpdate(oid, { reservationExpiresAt: validUntil })
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to extend reservation TTL for ${oid}: ${err.message}`,
        ),
      );

    const reminderDelay =
      validUntil.getTime() - Date.now() - REMINDER_BEFORE_MS;

    // Expiry job — fires at validUntil
    await this.shippingQueue
      .add(
        JOB_EXPIRE_SHIPPING_QUOTE,
        { orderId: oid },
        {
          delay: validUntil.getTime() - Date.now(),
          jobId: `expire-quote:${oid}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: true,
        },
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to enqueue expiry job for ${oid}: ${err.message}`,
        ),
      );

    // Reminder job — fires 24 h before expiry (if window is large enough)
    if (reminderDelay > 0) {
      await this.shippingQueue
        .add(
          JOB_SHIPPING_QUOTE_REMINDER,
          { orderId: oid },
          {
            delay: reminderDelay,
            jobId: `remind-quote:${oid}`,
            attempts: 2,
            backoff: { type: "fixed", delay: 60_000 },
            removeOnComplete: true,
          },
        )
        .catch((err: Error) =>
          this.logger.warn(
            `Failed to enqueue reminder job for ${oid}: ${err.message}`,
          ),
        );
    }

    // Notify the customer that the quote is ready and payment is due
    await this.notifications
      .sendShippingQuoteReady(updated!)
      .catch((err: Error) =>
        this.logger.warn(`Quote-ready email failed for ${oid}: ${err.message}`),
      );

    await this.auditLog.log({
      actor: actorId,
      action: "shipping_quote.submit",
      entityType: "order",
      entityId: oid,
      after: {
        shippingFee: dto.amount,
        currency: dto.currency,
        carrier: dto.carrier ?? null,
      },
    });

    return updated!;
  }

  // ─── Invalidate quote

  /**
   * Called when the customer changes their shipping address or cart items
   * while a quote is pending. Marks the current quote SUPERSEDED and resets
   * the order back to AWAITING_QUOTE for admin re-quoting.
   */
  async invalidate(orderId: string, reason: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");

    const hasQuote =
      order.shippingStatus === "QUOTED" ||
      order.shippingStatus === "AWAITING_QUOTE";
    if (!hasQuote) return order; // nothing to invalidate

    // Cancel existing expiry / reminder jobs
    await this.cancelQuoteJobs(orderId);

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        shippingStatus: "AWAITING_QUOTE",
        status: "awaiting_shipping_quote",
        shippingFee: 0,
        shippingFeeSource: null,
        shippingQuote: {
          requestedAt: order.shippingQuote?.requestedAt ?? new Date(),
          state: "SUPERSEDED",
          note: reason,
          quotedAt: null,
          validUntil: null,
        },
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException("Order not found");

    // Re-alert admins
    await this.requestQuote(orderId).catch((err: Error) =>
      this.logger.warn(
        `Could not re-request quote after invalidation for ${orderId}: ${err.message}`,
      ),
    );

    return updated;
  }

  // ─── Expire quote ─────────────────────────────────────────────────────────

  /**
   * Fired by the BullMQ delayed job at validUntil.
   * Releases stock holds and notifies the customer.
   */
  async expire(orderId: string): Promise<void> {
    const order = await this.orderModel.findById(orderId);
    if (!order) return;

    if (
      order.shippingStatus !== "QUOTED" ||
      order.status !== "pending_payment"
    ) {
      return;
    }

    await this.orderModel.findByIdAndUpdate(orderId, {
      shippingStatus: "EXPIRED",
      status: "abandoned",
      shippingQuote: {
        ...((order.shippingQuote as Record<string, unknown>) ?? {}),
        state: "EXPIRED",
      },
    });

    // Release stock holds on expiry (spec §4)
    await this.inventoryService
      .releaseStockBatch(
        order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Stock release failed on quote expiry for ${orderId}: ${err.message}`,
        ),
      );

    this.logger.log(
      `Shipping quote expired and stock released for order ${orderId}`,
    );
  }

  // ─── Override fee (admin — unpaid orders only) ────────────────────────────

  /**
   * Admin can override the calculated or quoted shipping fee on any unpaid
   * order. Recomputes chargeTotal accordingly. Requires a reason.
   */
  async override(
    orderId: string,
    dto: OverrideShippingFeeDto,
    actorId: string,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");

    if (["paid", "fulfilled", "cancelled", "refunded"].includes(order.status)) {
      throw new BadRequestException(
        "Cannot override shipping fee on a paid or closed order.",
      );
    }

    // Adjust chargeTotal: remove old shipping fee, add new one
    const oldFee = order.shippingFee ?? 0;
    const delta = dto.amount - oldFee;
    const newChargeTotal = Math.max(0, (order.chargeTotal ?? 0) + delta);

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        shippingFee: dto.amount,
        shippingFeeSource: "admin_override",
        chargeTotal: newChargeTotal,
        $push: {
          shippingAdjustments: {
            type: "override",
            amount: dto.amount,
            reason: dto.reason,
            createdBy: new Types.ObjectId(actorId),
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException("Order not found");
    await this.auditLog.log({
      actor: actorId,
      action: "shipping_fee.override",
      entityType: "order",
      entityId: orderId,
      before: { shippingFee: oldFee },
      after: { shippingFee: dto.amount, reason: dto.reason },
    });
    return updated;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async cancelQuoteJobs(orderId: string): Promise<void> {
    const oid = orderId.toString();
    const expiryJob = await this.shippingQueue
      .getJob(`expire-quote:${oid}`)
      .catch(() => null);
    await expiryJob?.remove().catch(() => {});

    const reminderJob = await this.shippingQueue
      .getJob(`remind-quote:${oid}`)
      .catch(() => null);
    await reminderJob?.remove().catch(() => {});
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Returns orders by shipping status (defaults to AWAITING_QUOTE + QUOTED), oldest first. */
  async listPendingQuotes(state?: string): Promise<OrderDocument[]> {
    const filter = state
      ? { shippingStatus: state }
      : { shippingStatus: { $in: ["AWAITING_QUOTE", "QUOTED"] } };
    return this.orderModel
      .find(filter)
      .sort({ createdAt: 1 })
      .lean<OrderDocument[]>();
  }
}
