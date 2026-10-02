import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type MeasurementProfileDocument = MeasurementProfile & Document;

/**
 * A single named measurement field within a profile entry.
 * key   — machine-readable field name, e.g. "bust", "waist", "sleeve_length"
 * label — human-readable display label, e.g. "Bust (cm)"
 * value — numeric measurement in centimetres
 *
 * Validation constraints (enforced at the service layer, not the DB layer):
 *  - value > 0
 *  - value <= 400 (no realistic human measurement exceeds this in cm)
 */
export class MeasurementField {
  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ required: true, trim: true })
  label: string;

  /** Centimetres. Service-layer validation: > 0 and <= 400. */
  @Prop({ required: true, type: Number })
  value: number;
}

/**
 * Schema-driven measurement profile.
 *
 * A profile belongs to one user and covers one garment type.
 * The `measurements` array is a flexible key/label/value list — any garment
 * category can define whatever fields it needs (bust/waist/hip for a dress,
 * neck/shoulder/sleeve for a shirt) without a schema migration.
 *
 * This is the architectural decision recorded in the PRD (section 1.8):
 *   "Go schema-driven — hardcoded fields get expensive to retrofit every time
 *    a new garment category launches."
 *
 * A user may have multiple profiles (one per garment type). The unique
 * compound index on (userId, garmentType) enforces one profile per type per user.
 */
@Schema({ timestamps: true, collection: "measurement_profiles" })
export class MeasurementProfile {
  /** References auth `users._id`. Stored as string to avoid populate overhead. */
  @Prop({ required: true, index: true })
  userId: string;

  /**
   * Free-form garment type that matches the category/section name.
   * Examples: "dress", "shirt", "aso-oke-jacket", "cargo-pants"
   * Stored lowercase-trimmed for consistent lookup.
   */
  @Prop({ required: true, trim: true, lowercase: true })
  garmentType: string;

  /** Optional human-readable label for the garment type shown in the UI. */
  @Prop({ type: String, default: null })
  garmentLabel: string | null;

  /**
   * Flexible array of measurement fields — no fixed columns.
   * Sorting by key is the client's responsibility.
   */
  @Prop({ type: [Object], default: [] })
  measurements: MeasurementField[];

  /** Optional free-text note from the customer ("prefer a little extra room"). */
  @Prop({ type: String, default: null, maxlength: 500 })
  notes: string | null;
}

export const MeasurementProfileSchema =
  SchemaFactory.createForClass(MeasurementProfile);

// One profile per garment type per user
MeasurementProfileSchema.index({ userId: 1, garmentType: 1 }, { unique: true });
