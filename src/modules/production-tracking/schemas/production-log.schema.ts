import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ProductionLogDocument = ProductionLog & Document;

/**
 * Production stages — kept deliberately simple per PRD §1.8:
 * "Start simple. A basic 'Cutting → Sewing → Quality Check → Ready' status bar
 *  delivers most of the customer-facing trust benefit."
 *
 * Photo/note logging deferred to v2.
 */
export type ProductionStage =
  | "cutting"
  | "sewing"
  | "quality_check"
  | "ready"
  | "delivered";

export const PRODUCTION_STAGE_ORDER: ProductionStage[] = [
  "cutting",
  "sewing",
  "quality_check",
  "ready",
  "delivered",
];

/**
 * Append-only log of production stage transitions for an order.
 *
 * Each record captures who moved the order to which stage and when.
 * The current stage is always the most recently created log entry.
 *
 * This design is append-only: stages are never updated in place, so the
 * full history is preserved for admin visibility without needing a separate
 * audit table.
 *
 * Both standard Orders and CustomOrders share this log collection —
 * `orderType` discriminates between them.
 */
@Schema({ timestamps: true, collection: "production_logs" })
export class ProductionLog {
  /** The Order or CustomOrder MongoDB _id. */
  @Prop({ required: true, index: true })
  orderId: string;

  /** "order" for standard catalog orders; "custom_order" for custom orders. */
  @Prop({
    type: String,
    enum: ["order", "custom_order"],
    required: true,
    index: true,
  })
  orderType: "order" | "custom_order";

  /** Human-readable order reference, e.g. "AV-2601" or "CO-1001". */
  @Prop({ required: true })
  orderReference: string;

  @Prop({
    type: String,
    enum: ["cutting", "sewing", "quality_check", "ready", "delivered"],
    required: true,
  })
  stage: ProductionStage;

  /** userId of the staff or admin who made the update. */
  @Prop({ required: true })
  updatedBy: string;

  /** Display name of the updater — denormalized for quick display. */
  @Prop({ type: String, default: null })
  updatedByName: string | null;

  /**
   * Optional admin/staff note. Kept as a single text field (no photo logging at v1).
   * Per PRD §1.8: "photo/note logging adds ongoing admin data-entry time that may go unused."
   */
  @Prop({ type: String, default: null, maxlength: 500 })
  note: string | null;
}

export const ProductionLogSchema = SchemaFactory.createForClass(ProductionLog);

// Fast lookup of all log entries for a given order
ProductionLogSchema.index({ orderId: 1, createdAt: -1 });
// List all orders currently at a given stage
ProductionLogSchema.index({ stage: 1, createdAt: -1 });
