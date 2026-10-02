import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FxRate, FxRateDocument } from "./schemas/fx-rate.schema";
import { CurrencyConfigService } from "../currency-config/currency-config.service";
import { GeoContextDto } from "./dto/geo-context.dto";

const SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"];

/** Hardcoded fallback rates relative to NGN (1 NGN = X currency). */
const FALLBACK_RATES: Record<string, number> = {
  NGN: 1,
  USD: 1 / 1550,
  GBP: 1 / 1980,
  EUR: 1 / 1700,
  GHS: 1 / 118,
  KES: 1 / 12,
  ZAR: 1 / 85,
};

@Injectable()
export class GeoCurrencyService {
  private readonly logger = new Logger(GeoCurrencyService.name);

  constructor(
    @InjectModel(FxRate.name)
    private readonly fxModel: Model<FxRateDocument>,
    private readonly config: ConfigService,
    private readonly currencyConfigService: CurrencyConfigService,
  ) {}

  // ─── Geo-Context (single-call endpoint) ────────────────────────────────────

  /**
   * Returns country, suggested currency, all FX rates, enabled currencies,
   * FX buffer, and a staleRates flag — everything the CurrencyProvider needs.
   *
   * Priority order for country resolution:
   * 1. xGeoCountry header (CDN-injected, e.g. Vercel x-vercel-ip-country)
   * 2. IP geolocation via configured provider
   * 3. Default "NG" on any failure or localhost
   *
   * Raw IPs are never stored. Only the detected country code is used.
   */
  async getGeoContext(
    ip: string,
    xGeoCountry?: string,
  ): Promise<GeoContextDto> {
    // 1. Determine country
    let country: string;
    if (xGeoCountry && /^[A-Z]{2}$/.test(xGeoCountry.toUpperCase())) {
      country = xGeoCountry.toUpperCase();
    } else if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1"
    ) {
      country = "NG";
    } else {
      country = await this.detectCountry(ip);
    }

    // 2. Map country → currency (overrides first, then built-in map)
    const currencyConfig = await this.currencyConfigService.getConfig();
    const currency =
      currencyConfig.countryOverrides[country] ??
      this.countryToCurrency(country);

    // 3. Fetch all rates
    const rates = await this.getRates();

    // 4. Stale-rate check
    const thresholdMs = currencyConfig.staleRateThresholdMinutes * 60_000;
    const cutoff = new Date(Date.now() - thresholdMs);
    const staleDoc = await this.fxModel
      .findOne({ refreshedAt: { $lt: cutoff } })
      .select("_id")
      .lean();
    const staleRates = !!staleDoc;

    const response: GeoContextDto = {
      country,
      currency,
      rates,
      enabledCurrencies: currencyConfig.enabledCurrencies,
      fxBuffer: currencyConfig.fxBuffer,
    };

    if (staleRates) response.staleRates = true;

    return response;
  }

  // ─── FX rates ─────────────────────────────────────────────────────────────

  /** Returns all supported currency rates — frontend caches in localStorage. */
  async getRates(): Promise<
    { currency: string; rate: number; symbol: string; flag: string }[]
  > {
    const stored = await this.fxModel.find().lean();
    const rateMap: Record<string, number> = {};
    for (const r of stored) rateMap[r.currency] = r.rate;

    return SUPPORTED_CURRENCIES.map((code) => ({
      currency: code,
      rate: rateMap[code] ?? FALLBACK_RATES[code] ?? 1,
      symbol: this.symbolFor(code),
      flag: this.flagFor(code),
    }));
  }

  /** Scheduled every 4 hours — refreshes rates from exchangerate.host */
  @Cron(CronExpression.EVERY_4_HOURS)
  async refreshRates(): Promise<void> {
    this.logger.log("Refreshing FX rates…");
    try {
      const res = await fetch(
        "https://api.exchangerate.host/latest?base=NGN&symbols=" +
          SUPPORTED_CURRENCIES.filter((c) => c !== "NGN").join(","),
      );
      if (!res.ok) throw new Error("exchangerate.host returned non-200");

      const data = (await res.json()) as {
        success: boolean;
        rates: Record<string, number>;
      };

      if (!data.success) throw new Error("exchangerate.host: success=false");

      const now = new Date();
      const ops = Object.entries(data.rates).map(([currency, rate]) => ({
        updateOne: {
          filter: { currency },
          update: {
            $set: { rate, refreshedAt: now, source: "exchangerate.host" },
          },
          upsert: true,
        },
      }));
      // Always ensure NGN = 1
      ops.push({
        updateOne: {
          filter: { currency: "NGN" },
          update: { $set: { rate: 1, refreshedAt: now, source: "base" } },
          upsert: true,
        },
      });

      await this.fxModel.bulkWrite(ops);
      this.logger.log(`FX rates refreshed — ${ops.length} currencies`);
    } catch (err) {
      this.logger.error(
        `FX refresh failed, keeping existing rates: ${(err as Error).message}`,
      );
    }
  }

  // ─── Geolocation helpers ───────────────────────────────────────────────────

  /**
   * Detects the country from an IP address.
   * Returns ISO 3166-1 alpha-2 code; defaults to "NG" on any failure.
   * The raw IP is never stored or logged at INFO level.
   */
  async detectCountry(ip: string): Promise<string> {
    if (ip === "127.0.0.1" || ip === "::1") return "NG";
    try {
      const provider = this.config.get<string>("geolocation.provider", "ipapi");
      if (provider === "ipinfo") {
        const token = this.config.get<string>("geolocation.ipinfoToken");
        const res = await fetch(`https://ipinfo.io/${ip}?token=${token}`);
        const data = (await res.json()) as { country?: string };
        return data.country?.toUpperCase() ?? "NG";
      }
      // Default: ipapi.co (1000 req/day free tier)
      const res = await fetch(`https://ipapi.co/${ip}/json/`);
      const data = (await res.json()) as { country_code?: string };
      return data.country_code?.toUpperCase() ?? "NG";
    } catch {
      return "NG";
    }
  }

  /**
   * Legacy method: detects currency from IP (kept for backward compatibility
   * with the existing GET /v1/fx/detect endpoint).
   */
  async detectCurrency(ip: string): Promise<string> {
    const country = await this.detectCountry(ip);
    return this.countryToCurrency(country);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private countryToCurrency(country: string): string {
    const map: Record<string, string> = {
      NG: "NGN",
      US: "USD",
      CA: "CAD",
      GB: "GBP",
      GH: "GHS",
      KE: "KES",
      ZA: "ZAR",
      DE: "EUR",
      FR: "EUR",
      IT: "EUR",
      ES: "EUR",
      NL: "EUR",
      BE: "EUR",
      AT: "EUR",
      PT: "EUR",
      IE: "EUR",
      FI: "EUR",
      GR: "EUR",
      LU: "EUR",
      SK: "EUR",
      SI: "EUR",
      CY: "EUR",
      MT: "EUR",
      EE: "EUR",
      LV: "EUR",
      LT: "EUR",
      HR: "EUR",
    };
    return map[country] ?? "USD";
  }

  private symbolFor(code: string): string {
    const map: Record<string, string> = {
      NGN: "₦",
      USD: "$",
      GBP: "£",
      EUR: "€",
      GHS: "GH₵",
      KES: "KSh",
      ZAR: "R",
      CAD: "CA$",
    };
    return map[code] ?? code;
  }

  private flagFor(code: string): string {
    const map: Record<string, string> = {
      NGN: "🇳🇬",
      USD: "🇺🇸",
      GBP: "🇬🇧",
      EUR: "🇪🇺",
      GHS: "🇬🇭",
      KES: "🇰🇪",
      ZAR: "🇿🇦",
      CAD: "🇨🇦",
    };
    return map[code] ?? "🏳";
  }
}
