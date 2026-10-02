import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { Model, Connection, Types } from "mongoose";
import { Order, OrderDocument, OrderStatus } from "./schemas/order.schema";
import { Cart, CartDocument } from "../cart/schemas/cart.schema";
import { InventoryService } from "../inventory/inventory.service";
import { ProductionTrackingService } from "../production-tracking/production-tracking.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { PaginationDto, paginate } from "../../common/dto/pagination.dto";
import {
  QUEUE_RESERVATION_EXPIRY,
  JOB_EXPIRE_SINGLE_RESERVATION,
} from "../jobs/jobs.constants";

/** Price lock duration: 30 minutes in milliseconds. */
const PRICE_LOCK_MS = 30 * 60 * 1000;

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventoryService: InventoryService,
    private readonly productionTracking: ProductionTrackingService,
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
    const total = Math.max(0, subtotal - discount);

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
              status: "pending_payment",
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

    return order!;
  }

  // â”€â”€â”€ State transitions (called by PaymentModule webhook handler) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      createdAt: { $lt: cutoff },
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
}
