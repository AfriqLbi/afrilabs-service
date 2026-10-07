import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type ShippingMode = "fixed" | "quote";
export type ShippingZoneDocument = ShippingZone & Document;

// ─── RateBand ─────────────────────────────────────────────────────────────────
// Defines a fee tier for a weight range within a fixed-mode zone.
// minGrams is inclusive, maxGrams is exclusive (standard interval notation).

@Schema({ _id: false })
export class RateBand {
  @Prop({ required: true, min: 0 }) minGrams: number;
  @Prop({ required: true, min: 0 }) maxGrams: number; // exclusive
  @Prop({ required: true, min: 0 }) feeNgn: number; // kobo
}

export const RateBandSchema = SchemaFactory.createForClass(RateBand);

// ─── EstimateRange ────────────────────────────────────────────────────────────
// Optional display range shown to customers for quote-mode zones.
// Values are NGN minor units (kobo).

@Schema({ _id: false })
export class EstimateRange {
  @Prop({ required: true, min: 0 }) minNgn: number;
  @Prop({ required: true, min: 0 }) maxNgn: number;
}

export const EstimateRangeSchema = SchemaFactory.createForClass(EstimateRange);

// ─── ShippingZone ─────────────────────────────────────────────────────────────

@Schema({ timestamps: true, collection: "shippingzones" })
export class ShippingZone {
  /** Human-readable name, e.g. "Lagos", "Canada", "Rest of world" */
  @Prop({ required: true, trim: true })
  name: string;

  /** "fixed" = automatic rate card; "quote" = admin sets fee per order */
  @Prop({ type: String, enum: ["fixed", "quote"], default: "quote" })
  mode: ShippingMode;

  /**
   * ISO 3166-1 alpha-2 country codes this zone covers.
   * Empty array on the fallback zone (matched via isFallback).
   */
  @Prop({ type: [String], default: [], index: true })
  countries: string[];

  /**
   * State / region codes within the listed countries.
   * Empty = entire country. E.g. ["LA"] for Lagos state (NG).
   */
  @Prop({ type: [String], default: [] })
  states: string[];

  /** Higher number wins when multiple zones match the same address. */
  @Prop({ default: 0 })
  priority: number;

  /**
   * Only one zone should be flagged as the fallback.
   * It matches any address that has no more-specific zone.
   */
  @Prop({ default: false, index: true })
  isFallback: boolean;

  @Prop({ default: true })
  isActive: boolean;

  // ── Fixed-mode rate card ───────────────────────────────────────────────────

  /** Weight-based fee bands (NGN kobo per weight range). */
  @Prop({ type: [RateBandSchema], default: [] })
  rates: RateBand[];

  /**
   * Flat fee used when there are no bands or no band covers the cart weight.
   * If undefined and no band matches, the zone falls back to quote mode.
   */
  @Prop({ type: Number })
  flatFeeNgn?: number;

  /**
   * Item-subtotal threshold (NGN kobo) above which shipping is free.
   * Only applies to fixed-mode zones.
   */
  @Prop({ type: Number })
  freeOverNgn?: number;

  // ── Presentation ───────────────────────────────────────────────────────────

  /** Informational estimate range shown for quote-mode zones (kobo). */
  @Prop({ type: EstimateRangeSchema })
  estimateRange?: EstimateRange;

  /** Delivery estimate shown to customer (inclusive range in days). */
  @Prop({ type: Number })
  etaMinDays?: number;

  @Prop({ type: Number })
  etaMaxDays?: number;

  /** Whether in-store / warehouse pickup is available for this zone. */
  @Prop({ default: false })
  pickupAvailable: boolean;

  /**
   * Optional note shown to the customer at checkout (e.g. duties disclaimer).
   * Raw text; the frontend renders it verbatim.
   */
  @Prop({ type: String })
  customerNote?: string;
}

export const ShippingZoneSchema = SchemaFactory.createForClass(ShippingZone);

ShippingZoneSchema.index({ countries: 1, isActive: 1 });
ShippingZoneSchema.index({ isFallback: 1, isActive: 1 });
