import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ShippingSettingsDocument = ShippingSettings & Document;

/**
 * Single-document collection holding runtime-configurable shipping settings.
 * Falls back to environment variables when no override document exists.
 */
@Schema({ collection: "shipping_settings" })
export class ShippingSettings {
  /** Hours within which an admin must submit a quote */
  @Prop({ type: Number, default: 24 })
  quoteSlaHours: number;

  /** Default validity window (days) for a submitted quote */
  @Prop({ type: Number, default: 7 })
  quoteValidDays: number;

  /** Comma-separated admin emails for quote alerts */
  @Prop({ type: String, default: "" })
  adminAlertEmails: string;

  /** Upper limit on a single quote amount (NGN kobo) — catches typos */
  @Prop({ type: Number, default: 50000000 })
  quoteAmountCapNgn: number;
}

export const ShippingSettingsSchema = SchemaFactory.createForClass(ShippingSettings);
