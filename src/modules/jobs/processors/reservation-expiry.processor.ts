import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import { Job } from "bull";
import {
  QUEUE_RESERVATION_EXPIRY,
  JOB_EXPIRE_RESERVATIONS,
  JOB_EXPIRE_SINGLE_RESERVATION,
} from "../jobs.constants";
import { OrderService } from "../../order/order.service";

@Processor(QUEUE_RESERVATION_EXPIRY)
export class ReservationExpiryProcessor {
  private readonly logger = new Logger(ReservationExpiryProcessor.name);

  constructor(private readonly orderService: OrderService) {}

  /**
   * Bulk scan job — runs every 15 minutes as a safety net.
   * Catches any per-order jobs that were missed (e.g. Redis restart).
   */
  @Process(JOB_EXPIRE_RESERVATIONS)
  async expire(_job: Job): Promise<void> {
    const EXPIRE_MINUTES = 30;
    const stale =
      await this.orderService.findStalePendingOrders(EXPIRE_MINUTES);
    if (stale.length === 0) return;
    this.logger.log(`Expiring ${stale.length} abandoned reservation(s)`);

    for (const order of stale) {
      const orderId = (order._id as unknown as Types.ObjectId).toString();
      try {
        await this.orderService.markAbandoned(orderId);
        this.logger.log(`Abandoned + released stock: ${order.orderNumber}`);
      } catch (err) {
        this.logger.error(
          `Error expiring ${order.orderNumber}`,
          (err as Error).message,
        );
      }
    }
  }

  /**
   * Per-order delayed job — enqueued at order creation with delay = 30 min.
   * Releases stock and marks the order abandoned if still pending_payment.
   * A no-op for paid/cancelled/fulfilled orders.
   */
  @Process(JOB_EXPIRE_SINGLE_RESERVATION)
  async expireSingle(job: Job<{ orderId: string }>): Promise<void> {
    const { orderId } = job.data;
    try {
      await this.orderService.markAbandoned(orderId);
      this.logger.log(
        `Price-lock expired — stock released for order ${orderId}`,
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        // Order not found — already deleted or never existed; treat as success
        return;
      }
      // Re-throw so BullMQ can retry
      throw err;
    }
  }
}
