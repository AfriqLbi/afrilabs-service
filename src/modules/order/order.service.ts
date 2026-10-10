import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { Model, Connection, Types } from "mongoose";
import {
  Order,
  OrderDocument,
  OrderStatus,
  ShippingStatus,
} from "./schemas/order.schema";
import { Cart, CartDocument } from "../cart/schemas/cart.schema";
import { InventoryService } from "../inventory/inventory.service";
import { ProductionTrackingService } from "../production-tracking/production-tracking.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { ShippingQuoteService } from "../shipping/shipping-quote.service";
import {
  ShippingResolverService,
  CartLineWeight,
} from "../shipping/shipping-resolver.service";
import { toIsoAlpha2 } from "../../common/utils/country-codes";
import {
  createLinkToken,
  verifyLinkToken,
} from "../../common/utils/link-token";
import { PaymentRouter } from "../payment/payment-router.service";
import { PaymentService } from "../payment/payment.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { PaginationDto, paginate } from "../../common/dto/pagination.dto";
import {
  QUEUE_RESERVATION_EXPIRY,
  JOB_EXPIRE_SINGLE_RESERVATION,
} from "../jobs/jobs.constants";

/** Price lock duration: 30 minutes in milliseconds. */
const PRICE_LOCK_MS = 30 * 60 * 1000;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventoryService: InventoryService,
    private readonly productionTracking: ProductionTrackingService,
    private readonly shippingQuoteService: ShippingQuoteService,
    private readonly shippingResolver: ShippingResolverService,
    @Inject(forwardRef(() => PaymentRouter))
    private readonly paymentRouter: PaymentRouter,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_RESERVATION_EXPIRY)
    private readonly reservationQueue: Queue,
  ) {}

  // â”€â”€â”€ Create order + reserve stock atomically â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async createOrder(
    dto: CreateOrderDto,
    userId: string | null,
  ): Promise<OrderDocument> {
    // 1. Resolve cart
    let cart: CartDocument | null = null;
    if (dto.cartId) {
      cart = await this.cartModel.findById(dto.cartId);
    } else if (userId) {
      cart = await this.cartModel.findOne({ userId });
    }
    if (!cart || cart.lines.length === 0) {
      throw new BadRequestException("Cart is empty or not found");
    }

    // 2. Build order items from cart lines
    const items = cart.lines.map((l) => ({
      productId: l.productId,
      sku: l.sku,
      title: l.title,
      image: l.image,
      qty: l.quantity,
      unitPrice: l.unitPrice,
    }));
    const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const discount = cart.discountAmount ?? 0;

    // ── Server-side shipping fee computation (spec §10: client-sent amounts
    //    are ignored — fees are computed only on the server) ──────────────────
    const cartLineWeights: CartLineWeight[] = cart.lines.map((l) => ({
      weightGrams: l.weightGrams ?? 0,
      dims: l.dims ?? { l: 0, w: 0, h: 0 },
      qty: l.quantity,
    }));
    const subtotalNgnKobo = Math.round(subtotal * 100);

    const estimate = await this.shippingResolver
      .estimate({
        country: toIsoAlpha2(dto.shippingAddress.country),
        state: dto.shippingAddress.state,
        items: cartLineWeights,
        subtotalNgn: subtotalNgnKobo,
        pickup: dto.pickup,
      })
      .catch(() => null);

    let shippingFee = 0;
    let shippingFeeSource: string | null = null;
    let isQuoteZone = false;
    let shippingStatus: ShippingStatus;
    let shippingZoneId: Types.ObjectId | null = null;
    let shippingZoneName: string | null = null;
    let chargeableWeightGrams: number | null = null;

    if (dto.pickup && estimate?.status === "PICKUP") {
      shippingFee = 0;
      shippingFeeSource = "pickup";
      shippingStatus = "PICKUP";
    } else if (estimate?.status === "CALCULATED" && estimate.feeNgn != null) {
      // feeNgn is NGN kobo; convert to naira for the NGN-denominated total.
      // shippingFee is stored in NGN naira — same unit as subtotal/total.
      shippingFee = estimate.feeNgn / 100;
      shippingFeeSource = estimate.source ?? "rate_card";
      shippingStatus = "CALCULATED";
      chargeableWeightGrams = estimate.chargeableWeightGrams ?? null;
    } else if (estimate?.status === "NO_ZONE") {
      throw new BadRequestException(
        "Shipping to this destination is not yet configured. " +
          "Please contact us via WhatsApp for a shipping quote.",
      );
    } else {
      // QUOTE_REQUIRED (or estimate failed / weight outside bands)
      isQuoteZone = true;
      shippingStatus = "AWAITING_QUOTE";
    }

    if (estimate?.zone) {
      shippingZoneId =
        (estimate.zone as unknown as { _id: Types.ObjectId })._id ?? null;
      shippingZoneName = estimate.zone.name ?? null;
    }

    const total = Math.max(0, subtotal - discount + shippingFee);

    // 3. Resolve multi-currency values
    const chargeCurrency = dto.chargeCurrency ?? "NGN";
    const isNgn = chargeCurrency === "NGN";

    if (!isNgn && !dto.fxRateSnapshot) {
      throw new BadRequestException(
        "fxRateSnapshot is required for non-NGN orders. " +
          "The frontend must supply the rate and buffer from the CurrencyProvider context.",
      );
    }

    // ngnTotal in kobo (100 kobo = â‚¦1)
    const ngnTotal = Math.round(total * 100);

    let chargeTotal: number;
    let fxRate = 1;
    let fxBuffer = 0;

    if (isNgn) {
      chargeTotal = ngnTotal;
    } else {
      // Use the client-provided snapshot â€” never re-fetch rates here
      const { rate, buffer } = dto.fxRateSnapshot!;
      fxRate = rate;
      fxBuffer = buffer;
      chargeTotal = Math.ceil(ngnTotal * rate * (1 + buffer / 100));
    }

    const reservationExpiresAt = new Date(Date.now() + PRICE_LOCK_MS);

    // 4. Reserve stock + create order in a single Mongo transaction
    const session = await this.connection.startSession();
    let order: OrderDocument;
    try {
      await session.withTransaction(async () => {
        for (const item of items) {
          await this.inventoryService.reserveStock(
            item.productId,
            item.qty,
            session,
          );
        }

        const orderNumber = await this.nextOrderNumber();
        const paymentReference = this.generateReference(orderNumber);

        [order] = await this.orderModel.create(
          [
            {
              orderNumber,
              customerId: userId,
              customerEmail: dto.customerEmail ?? null,
              customerName: dto.customerName ?? null,
              items,
              subtotal,
              promoCode: cart!.promoCode ?? null,
              discountAmount: discount,
              total,
              // Legacy field kept in sync with chargeCurrency
              currency: chargeCurrency,
              // Multi-currency fields
              chargeCurrency,
              ngnTotal,
              chargeTotal,
              fxRate,
              fxBuffer,
              reservationExpiresAt,
              paymentProvider: dto.paymentProvider,
              paymentReference,
              shippingAddress: dto.shippingAddress,
              // Shipping fields (server-computed — spec §10)
              shippingFee,
              shippingFeeSource,
              shippingZoneName,
              shippingZoneId,
              chargeableWeightGrams,
              shippingStatus,
              status: isQuoteZone
                ? "awaiting_shipping_quote"
                : "pending_payment",
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    // 5. Enqueue per-order delayed expiry job (outside the transaction)
    try {
      const job = await this.reservationQueue.add(
        JOB_EXPIRE_SINGLE_RESERVATION,
        { orderId: (order!._id as unknown as Types.ObjectId).toString() },
        {
          delay: PRICE_LOCK_MS,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      // Persist job ID so markPaid() can cancel it
      await this.orderModel.findByIdAndUpdate(order!._id, {
        expiryJobId: job.id?.toString() ?? null,
      });
    } catch {
      // Non-fatal: the bulk reservation-expiry scan is a safety net
    }

    // 6. For quote-zone orders: trigger the admin quote flow
    if (isQuoteZone) {
      const oid = (order!._id as unknown as Types.ObjectId).toString();
      await this.shippingQuoteService
        .requestQuote(oid)
        .catch((err: Error) =>
          this.logger.warn(
            `Failed to enqueue quote request for ${oid}: ${err.message}`,
          ),
        );
    }

    return order!;
  }

  // â”€â”€â”€ State transitions (called by PaymentModule webhook handler) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // ── Pay (quote-order payment entry point — spec §7.1) ──────────────────────

  async payOrder(
    orderId: string,
    userId: string | null,
    provider?: "paystack" | "flutterwave" | "stripe",
    linkToken?: string,
  ): Promise<{ checkoutUrl: string; reference: string }> {
    const order = await this.findById(orderId);

    if (userId && order.customerId && order.customerId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    if (!userId || !order.customerId) {
      if (!linkToken)
        throw new ForbiddenException(
          "Signed link token required for guest checkout",
        );
      const secret = this.config.get<string>("shipping.orderLinkSecret")!;
      const payload = verifyLinkToken(linkToken, secret);
      if (payload.orderId !== orderId)
        throw new ForbiddenException("Link token does not match this order");
    }

    if (order.status !== "pending_payment") {
      throw new BadRequestException(
        `Order is not ready for payment (status: ${order.status})`,
      );
    }

    if (
      order.shippingStatus === "QUOTED" &&
      order.shippingQuote?.validUntil &&
      new Date(order.shippingQuote.validUntil) < new Date()
    ) {
      throw new BadRequestException(
        "Shipping quote has expired. Please request a new quote.",
      );
    }

    return this.paymentRouter.initializePayment(order, provider);
  }

  generatePayLink(orderId: string, quoteVersion?: number): string {
    const secret = this.config.get<string>("shipping.orderLinkSecret")!;
    return createLinkToken({ orderId, quoteVersion }, secret);
  }

  // ── Re-quote (spec §7.1) ───────────────────────────────────────────────────

  async requestRequote(
    orderId: string,
    userId: string | null,
  ): Promise<OrderDocument> {
    const order = await this.findById(orderId);
    if (userId && order.customerId && order.customerId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    if (order.shippingStatus !== "EXPIRED") {
      throw new BadRequestException(
        "Can only request a requote on an expired quote",
      );
    }
    return this.shippingQuoteService.requestQuote(orderId);
  }

  // ── Update shipping address (invalidates existing quote — spec §7.1) ─────

  async updateShippingAddress(
    orderId: string,
    address: {
      fullName: string;
      phone: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      country?: string;
    },
    userId: string | null,
  ): Promise<OrderDocument> {
    const order = await this.findById(orderId);
    if (userId && order.customerId && order.customerId !== userId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    if (["paid", "fulfilled", "cancelled", "refunded"].includes(order.status)) {
      throw new BadRequestException(
        "Cannot change shipping address on a paid or closed order",
      );
    }
    if (
      order.shippingStatus === "QUOTED" ||
      order.shippingStatus === "AWAITING_QUOTE"
    ) {
      await this.shippingQuoteService.invalidate(
        orderId,
        "Shipping address changed by customer",
      );
    }
    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      { shippingAddress: address },
      { new: true },
    );
    if (!updated) throw new NotFoundException("Order not found");
    return updated;
  }

  // ── Shipping adjustment (post-payment — spec §8.4) ───────────────────────

  async createShippingAdjustment(
    orderId: string,
    dto: { type: "refund" | "extra_charge"; amount: number; reason: string },
    actorId: string,
  ): Promise<OrderDocument> {
    const order = await this.findById(orderId);
    if (!["paid", "fulfilled"].includes(order.status)) {
      throw new BadRequestException(
        "Shipping adjustments can only be made on paid or fulfilled orders",
      );
    }

    if (dto.type === "refund") {
      // Initiate the refund through the original gateway
      await this.paymentService
        .refundOrder(order, dto.amount, dto.reason)
        .catch((err: Error) =>
          this.logger.warn(`Refund failed for ${orderId}: ${err.message}`),
        );
    }

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $push: {
          shippingAdjustments: {
            type: dto.type,
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

    await this.notifications
      .sendShippingAdjustment(updated, dto.type, dto.amount, dto.reason)
      .catch((err: Error) =>
        this.logger.warn(
          `Adjustment email failed for ${orderId}: ${err.message}`,
        ),
      );

    await this.auditLog.log({
      actor: actorId,
      action: "shipping_adjustment.create",
      entityType: "order",
      entityId: orderId,
      after: { type: dto.type, amount: dto.amount, reason: dto.reason },
    });

    return updated;
  }

  async markPaid(
    orderId: string,
    webhookId: string,
    session?: unknown,
  ): Promise<OrderDocument> {
    const order = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        status: "paid",
        paidAt: new Date(),
        processedWebhookId: webhookId,
      },
      { new: true },
    );
    if (!order) throw new NotFoundException("Order not found");

    // Cancel the price-lock expiry job â€” it's no longer needed
    if (order.expiryJobId) {
      const job = await this.reservationQueue
        .getJob(order.expiryJobId)
        .catch(() => null);
      await job?.remove().catch(() => {
        // Already processed or removed â€” safe to ignore
      });
    }

    return order;
  }

  async markFailed(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "pending_payment") return order;

    for (const item of order.items) {
      await this.inventoryService.releaseStock(item.productId, item.qty);
    }

    order.status = "failed";
    return order.save();
  }

  async markAbandoned(orderId: string): Promise<void> {
    const order = await this.orderModel.findById(orderId);
    if (!order || order.status !== "pending_payment") return;
    await this.inventoryService.releaseStockBatch(
      order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
    );
    order.status = "abandoned";
    await order.save();
  }

  async markFulfilled(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        status: "fulfilled",
        fulfilledAt: new Date(),
        productionStage: "ready",
      },
      { new: true },
    );
    if (!order) throw new NotFoundException("Order not found");

    await this.productionTracking
      .updateStage(
        {
          orderId,
          orderType: "order",
          orderReference: order.orderNumber,
          updatedBy: "system",
          updatedByName: "System (auto on fulfil)",
        },
        { stage: "ready" },
      )
      .catch(() => {});

    return order;
  }

  async updateProductionStage(
    orderId: string,
    stage: "cutting" | "sewing" | "quality_check" | "ready" | "delivered",
    actorId: string,
    actorEmail: string,
    note?: string,
  ): Promise<OrderDocument> {
    const order = await this.findById(orderId);

    await this.productionTracking.updateStage(
      {
        orderId,
        orderType: "order",
        orderReference: order.orderNumber,
        updatedBy: actorId,
        updatedByName: actorEmail,
      },
      { stage, note },
    );

    const updated = await this.orderModel.findByIdAndUpdate(
      orderId,
      { productionStage: stage },
      { new: true },
    );
    return updated!;
  }

  async markCancelled(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (["paid", "fulfilled"].includes(order.status)) {
      throw new BadRequestException(
        "Cannot cancel a paid or fulfilled order â€” issue a refund instead",
      );
    }
    if (order.status === "pending_payment") {
      await this.inventoryService.releaseStockBatch(
        order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      );
    }
    order.status = "cancelled";
    return order.save();
  }

  // â”€â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async findByReference(ref: string): Promise<OrderDocument | null> {
    return this.orderModel.findOne({ paymentReference: ref });
  }

  async findById(id: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async findByCustomer(userId: string, pagination: PaginationDto) {
    const filter = { customerId: userId };
    const [items, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit ?? 20)
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);
    return paginate(items, total, pagination);
  }

  async findAll(pagination: PaginationDto, status?: OrderStatus) {
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit ?? 20)
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);
    return paginate(items, total, pagination);
  }

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async nextOrderNumber(): Promise<string> {
    const last = await this.orderModel
      .findOne()
      .sort({ createdAt: -1 })
      .select("orderNumber")
      .lean();
    const lastNum = last
      ? parseInt(last.orderNumber.replace("AV-", ""), 10)
      : 2600;
    return `AV-${lastNum + 1}`;
  }

  private generateReference(orderNumber: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    return `${orderNumber}-${ts}`;
  }

  async findStalePendingOrders(
    olderThanMinutes: number,
  ): Promise<OrderDocument[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return this.orderModel.find({
      status: "pending_payment",
      $or: [
        { reservationExpiresAt: { $lt: new Date() } },
        { reservationExpiresAt: null, createdAt: { $lt: cutoff } },
      ],
    });
  }

  async markRefunded(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findByIdAndUpdate(
      orderId,
      { status: "refunded" },
      { new: true },
    );
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async flagPayment(orderId: string, reason: string): Promise<void> {
    await this.orderModel.findByIdAndUpdate(orderId, {
      paymentFlagged: true,
      paymentFlagReason: reason,
    });
    this.logger.warn(`Payment flagged for order ${orderId}: ${reason}`);
  }
}
