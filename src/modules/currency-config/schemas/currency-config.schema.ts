import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CurrencyConfigDocument = CurrencyConfig & Document;

export class RoundingRule {
  decimals: number;
  mode: "round" | "ceil" | "floor";
}

const DEFAULT_ROUNDING_RULES: Record<string, RoundingRule> = {
  NGN: { decimals: 0, mode: "ceil" },
  USD: { decimals: 2, mode: "ceil" },
  GBP: { decimals: 2, mode: "ceil" },
  EUR: { decimals: 2, mode: "ceil" },
  CAD: { decimals: 2, mode: "ceil" },
  GHS: { decimals: 0, mode: "ceil" },
  KES: { decimals: 0, mode: "ceil" },
  ZAR: { decimals: 0, mode: "ceil" },
};

@Schema({ timestamps: true, collection: "currency_configs" })
export class CurrencyConfig {
  /**
   * Fixed singleton key. Always "global".
   * Use findOne({ configKey: "global" }) to retrieve.
   */
  @Prop({ required: true, unique: true, default: "global" })
  configKey: string;

  /** ISO 4217 currency codes enabled for checkout display and charging. */
  @Prop({
    type: [String],
    default: ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"],
  })
  enabledCurrencies: string[];

  /**
   * ISO 3166-1 alpha-2 → ISO 4217 overrides.
   * Takes precedence over the built-in country→currency map.
   * Example: { "CA": "CAD", "AU": "AUD" }
   */
  @Prop({ type: Object, default: {} })
  countryOverrides: Record<string, string>;

  /**
   * FX buffer percentage added to raw rates to cover volatility.
   * Default: 2 (means 2%). Range 0–20.
   */
  @Prop({ default: 2, min: 0, max: 20 })
  fxBuffer: number;

  /** Per-currency rounding rules for display and charge amounts. */
  @Prop({ type: Object, default: DEFAULT_ROUNDING_RULES })
  roundingRules: Record<string, RoundingRule>;

  /**
   * Minutes before an FxRate entry is considered stale.
   * Default: 240 (4 hours, matching the BullMQ refresh interval).
   */
  @Prop({ default: 240, min: 1 })
  staleRateThresholdMinutes: number;
}

export const CurrencyConfigSchema =
  SchemaFactory.createForClass(CurrencyConfig);
// configKey: unique index already created by unique: true in @Prop
