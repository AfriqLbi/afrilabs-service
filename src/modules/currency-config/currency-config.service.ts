import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  CurrencyConfig,
  CurrencyConfigDocument,
} from "./schemas/currency-config.schema";
import { UpdateCurrencyConfigDto } from "./dto/update-currency-config.dto";

/** The full set of currencies the system supports at the API level. */
export const SUPPORTED_CURRENCIES = [
  "NGN",
  "USD",
  "GBP",
  "EUR",
  "GHS",
  "KES",
  "ZAR",
] as const;

@Injectable()
export class CurrencyConfigService {
  private readonly logger = new Logger(CurrencyConfigService.name);

  // ── 60-second in-memory cache ──────────────────────────────────────────────
  private cachedConfig: CurrencyConfig | null = null;
  private cacheExpiresAt = 0;
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectModel(CurrencyConfig.name)
    private readonly configModel: Model<CurrencyConfigDocument>,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns the global CurrencyConfig document.
   * Cached for 60 seconds; auto-seeds default on first call.
   */
  async getConfig(): Promise<CurrencyConfig> {
    if (this.cachedConfig && Date.now() < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    let doc = await this.configModel
      .findOne({ configKey: "global" })
      .lean<CurrencyConfig>();

    if (!doc) {
      this.logger.log("No CurrencyConfig found — seeding default");
      doc = await this.seedDefault();
    }

    this.cachedConfig = doc;
    this.cacheExpiresAt = Date.now() + this.CACHE_TTL_MS;
    return doc;
  }

  /**
   * Applies a partial update to the singleton config document.
   * Invalidates the in-memory cache after every successful save.
   */
  async updateConfig(patch: UpdateCurrencyConfigDto): Promise<CurrencyConfig> {
    const updated = await this.configModel
      .findOneAndUpdate(
        { configKey: "global" },
        { $set: patch },
        { new: true, upsert: false },
      )
      .lean<CurrencyConfig>();

    if (!updated) {
      // Seed first then update
      await this.seedDefault();
      return this.updateConfig(patch);
    }

    // Invalidate cache
    this.cachedConfig = null;
    this.cacheExpiresAt = 0;

    return updated;
  }

  /**
   * Idempotently seeds the default config document.
   * Uses $setOnInsert so re-running never overwrites admin changes.
   */
  async seedDefault(): Promise<CurrencyConfig> {
    const doc = await this.configModel
      .findOneAndUpdate(
        { configKey: "global" },
        {
          $setOnInsert: {
            configKey: "global",
            enabledCurrencies: [
              "NGN",
              "USD",
              "GBP",
              "EUR",
              "GHS",
              "KES",
              "ZAR",
            ],
            countryOverrides: {},
            fxBuffer: 2,
            roundingRules: {
              NGN: { decimals: 0, mode: "ceil" },
              USD: { decimals: 2, mode: "ceil" },
              GBP: { decimals: 2, mode: "ceil" },
              EUR: { decimals: 2, mode: "ceil" },
              CAD: { decimals: 2, mode: "ceil" },
              GHS: { decimals: 0, mode: "ceil" },
              KES: { decimals: 0, mode: "ceil" },
              ZAR: { decimals: 0, mode: "ceil" },
            },
            staleRateThresholdMinutes: 240,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<CurrencyConfig>();

    return doc!;
  }
}
