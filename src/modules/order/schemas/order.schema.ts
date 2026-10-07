import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type OrderStatus =
  | "awaiting_shipping_quote"
  | "pending_payment"
  | "paid"
  | "failed"
  | "abandoned"
  | "fulfilled"
  | "cancelled"
  | "refunded";

export type ShippingStatus =
  | "NOT_CALCULATED"
  | "CALCULATED"
  | "AWAITING_QUOTE"
  | "QUOTED"
  | "PAID"
  | "PICKUP"
  | "EXPIRED";

export type PaymentProvider = "paystack" | "flutterwave" | "stripe";
export type OrderDocument = Order & Document;

export class OrderLineEmbedded {
  @Prop({ required: true }) productId: string;
  @Prop({ required: true }) sku: string;
  @Prop({ required: true }) title: string;
  @Prop({ required: true }) image: string;
  @Prop({ required: true, min: 1 }) qty: number;
  @Prop({ required: true, min: 0 }) unitPrice: number;
}

export class AddressEmbedded {
  @Prop({ required: true }) fullName: string;
  @Prop({ required: true }) phone: string;
  @Prop({ required: true }) line1: string;
  @Prop({ default: "" }) line2: string;
  @Prop({ required: true }) city: string;
  @Prop({ required: true }) state: string;
  @Prop({ default: "Nigeria" }) country: string;
}

@Schema({ timestamps: true, collection: "orders" })
export class Order {
  @Prop({ required: true, unique: true })
  orderNumber: string;

  /** null for guest checkout — explicit type required to avoid CannotDetermineTypeError */
  @Prop({ type: String, default: null, index: true })
  customerId: string | null;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: String, default: null })
  customerName: string | null;

  @Prop({ type: [Object], default: [] })
  items: OrderLineEmbedded[];

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ type: String, default: null })
  promoCode: string | null;

  @Prop({ default: 0 })
  discountAmount: number;

  /**
   * Shipping fee in minor units of chargeCurrency.
   * 0 until calculated or quoted. Included in chargeTotal.
   */
  @Prop({ default: 0, min: 0 })
  shippingFee: number;

  /**
   * How the shipping fee was determined.
   * null until the fee is set.
   */
  @Prop({
    type: String,
    enum: [
      "rate_card",
      "admin_quote",
      "admin_override",
      "free_threshold",
      "pickup",
      null,
    ],
    default: null,
  })
  shippingFeeSource: string | null;

  /** Snapshot of the matched zone name (for display without a join). */
  @Prop({ type: String, default: null })
  shippingZoneName: string | null;

  /** Reference to the matched ShippingZone document. */
  @Prop({ type: Types.ObjectId, ref: "ShippingZone", default: null })
  shippingZoneId: Types.ObjectId | null;

  /** Chargeable weight used when the fee was calculated (grams). */
  @Prop({ type: Number, default: null })
  chargeableWeightGrams: number | null;

  @Prop({
    type: String,
    enum: [
      "NOT_CALCULATED",
      "CALCULATED",
      "AWAITING_QUOTE",
      "QUOTED",
      "PAID",
      "PICKUP",
      "EXPIRED",
    ],
    default: "NOT_CALCULATED",
  })
  shippingStatus: ShippingStatus;

  /** Embedded shipping quote — populated when zone mode is "quote". */
  @Prop({ type: Object, default: null })
  shippingQuote: {
    requestedAt?: Date;
    quotedAt?: Date;
    quotedBy?: Types.ObjectId;
    currency?: string;
    amount?: number;
    carrier?: string;
    etaDays?: number;
    note?: string;
    validUntil?: Date;
    state: "REQUESTED" | "QUOTED" | "EXPIRED" | "ACCEPTED" | "SUPERSEDED";
  } | null;

  /** Post-payment shipping adjustments (refund or extra charge). */
  @Prop({ type: [Object], default: [] })
  shippingAdjustments: {
    type: "refund" | "extra_charge" | "override";
    amount: number;
    reason: string;
    createdBy: Types.ObjectId;
    paymentId?: Types.ObjectId;
    createdAt: Date;
  }[];

  @Prop({ required: true, min: 0 })
  total: number;

  @Prop({ default: "NGN" })
  currency: string;

  @Prop({
    type: String,
    enum: [
      "awaiting_shipping_quote",
      "pending_payment",
      "paid",
      "failed",
      "abandoned",
      "fulfilled",
      "cancelled",
      "refunded",
    ],
    default: "pending_payment",
  })
  status: OrderStatus;

  @Prop({
    type: String,
    enum: ["paystack", "flutterwave", "stripe"],
    required: true,
  })
  paymentProvider: PaymentProvider;

  @Prop({ required: true, index: true })
  paymentReference: string;

  @Prop({ type: String, default: null })
  checkoutUrl: string | null;

  @Prop({ type: Object, required: true })
  shippingAddress: AddressEmbedded;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  @Prop({ type: Date, default: null })
  fulfilledAt: Date | null;

  @Prop({ type: String, default: null })
  processedWebhookId: string | null;

  /**
   * Set when a webhook amount/currency does not match the order snapshot.
   * The order stays in `pending_payment` and admins are alerted (spec §7.3).
   */
  @Prop({ type: Boolean, default: false })
  paymentFlagged: boolean;

  @Prop({ type: String, default: null })
  paymentFlagReason: string | null;

  // ── Multi-currency fields (Req 4 — added in multi-currency-geo feature) ─────

  /**
   * NGN total in kobo (100 kobo = ₦1). Set once at order creation, never mutated.
   * Source of truth for all accounting; all other currency amounts derive from this.
   */
  @Prop({ type: Number, default: null })
  ngnTotal: number | null;

  /**
   * Charge amount in the minor unit of chargeCurrency (e.g. cents for USD).
   * Computed once: Math.ceil(ngnTotal × fxRate × (1 + fxBuffer/100)).
   * Webhook handlers MUST use this value — never recompute from current rates.
   */
  @Prop({ type: Number, default: null })
  chargeTotal: number | null;

  /**
   * Exchange rate locked at order creation: 1 NGN = fxRate units of chargeCurrency.
   * Always 1 for NGN orders.
   */
  @Prop({ type: Number, default: 1 })
  fxRate: number;

  /**
   * FX buffer percentage applied at order creation (e.g. 2 = 2%).
   * Always 0 for NGN orders.
   */
  @Prop({ type: Number, default: 0 })
  fxBuffer: number;

  /**
   * ISO 4217 currency in which the customer is billed.
   * Defaults to "NGN". Mirrors the existing `currency` field (kept for compat).
   */
  @Prop({ type: String, default: "NGN" })
  chargeCurrency: string;

  /**
   * Timestamp when the price lock expires (order creation + 30 min).
   * A BullMQ delayed job releases stock if the order is still pending_payment
   * when this timestamp is reached.
   */
  @Prop({ type: Date, default: null })
  reservationExpiresAt: Date | null;

  /**
   * BullMQ job ID for the per-order expiry job.
   * Stored so the job can be cancelled immediately when payment is confirmed.
   */
  @Prop({ type: String, default: null })
  expiryJobId: string | null;

  /**
   * Denormalized current production stage — mirrors the latest ProductionLog entry.
   * Written here for fast reads (order detail + customer order status page) without
   * requiring a join to production_logs.
   * Source of truth remains the append-only production_logs collection.
   */
  @Prop({
    type: String,
    enum: ["cutting", "sewing", "quality_check", "ready", "delivered", null],
    default: null,
  })
  productionStage:
    "cutting" | "sewing" | "quality_check" | "ready" | "delivered" | null;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
// orderNumber   — unique index already created by unique: true in @Prop
// paymentReference — index already created by index: true in @Prop
// customerId    — index already created by index: true in @Prop
// These compound indexes are not expressible via @Prop, so they stay here:
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ shippingStatus: 1, createdAt: 1 }); // quotes queue — oldest first
