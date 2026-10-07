import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Job } from "bull";
import { ShippingQuoteService } from "./shipping-quote.service";
import { NotificationsService } from "../notifications/notifications.service";
import { Order, OrderDocument } from "../order/schemas/order.schema";
import {
  QUEUE_SHIPPING,
  JOB_EXPIRE_SHIPPING_QUOTE,
  JOB_SHIPPING_QUOTE_REMINDER,
  JOB_SHIPPING_QUOTE_SLA,
} from "./shipping.constants";

@Processor(QUEUE_SHIPPING)
export class ShippingProcessor {
  private readonly logger = new Logger(ShippingProcessor.name);

  constructor(
    private readonly quoteService: ShippingQuoteService,
    private readonly notifications: NotificationsService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  /**
   * Fires at quote.validUntil — marks the quote EXPIRED and releases stock.
   */
  @Process(JOB_EXPIRE_SHIPPING_QUOTE)
  async handleExpiry(job: Job<{ orderId: string }>): Promise<void> {
    const { orderId } = job.data;
    this.logger.log(`Processing expiry for order ${orderId}`);
    try {
      await this.quoteService.expire(orderId);
      const order = await this.orderModel
        .findById(orderId)
        .lean<OrderDocument>();
      if (order) {
        await this.notifications.sendShippingQuoteExpired(
          order as OrderDocument,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to expire shipping quote for ${orderId}`, err);
      throw err; // rethrow so BullMQ retries
    }
  }

  /**
   * Fires 24 h before quote.validUntil — reminds the customer to pay.
   */
  @Process(JOB_SHIPPING_QUOTE_REMINDER)
  async handleReminder(job: Job<{ orderId: string }>): Promise<void> {
    const { orderId } = job.data;
    this.logger.log(`Sending expiry reminder for order ${orderId}`);
    try {
      const order = await this.orderModel
        .findById(orderId)
        .lean<OrderDocument>();
      if (order && order.shippingStatus === "QUOTED") {
        await this.notifications.sendShippingQuoteExpiring(
          order as OrderDocument,
        );
      }
    } catch (err) {
      // Reminders are best-effort — log and swallow
      this.logger.warn(
        `Reminder email failed for ${orderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Fires after the SLA window — alerts admins a quote request is overdue.
   */
  @Process(JOB_SHIPPING_QUOTE_SLA)
  async handleSlaMiss(job: Job<{ orderId: string }>): Promise<void> {
    const { orderId } = job.data;
    this.logger.warn(`Shipping quote SLA missed for order ${orderId}`);
    try {
      const order = await this.orderModel
        .findById(orderId)
        .lean<OrderDocument>();
      if (order && order.shippingStatus === "AWAITING_QUOTE") {
        await this.notifications.sendShippingQuoteSlaAlert(
          order as OrderDocument,
        );
      }
    } catch (err) {
      this.logger.warn(
        `SLA alert email failed for ${orderId}: ${(err as Error).message}`,
      );
    }
  }
}
