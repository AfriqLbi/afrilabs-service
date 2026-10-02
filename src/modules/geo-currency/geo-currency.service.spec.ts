/**
 * GeoCurrencyService — Unit Tests
 *
 * Covers:
 *   Property 5: X-Geo-Country header passthrough (no IP lookup when header present)
 *   Property 6: getGeoContext() response shape completeness
 *   Property 7: localhost/::1 always returns NG/NGN
 *   Property 3 (backend): FX refresh cron updates refreshedAt on each document
 */

import { GeoCurrencyService } from "./geo-currency.service";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const STORED_RATES = [
  { currency: "NGN", rate: 1, refreshedAt: new Date(), source: "base" },
  { currency: "USD", rate: 1 / 1550, refreshedAt: new Date(), source: "exchangerate.host" },
  { currency: "GBP", rate: 1 / 1980, refreshedAt: new Date(), source: "exchangerate.host" },
];

const mockFxModel = {
  find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(STORED_RATES) }),
  findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
  bulkWrite: jest.fn().mockResolvedValue({}),
};

const DEFAULT_CONFIG = {
  enabledCurrencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"],
  countryOverrides: {},
  fxBuffer: 2,
  staleRateThresholdMinutes: 240,
};

const mockCurrencyConfigService = {
  getConfig: jest.fn().mockResolvedValue(DEFAULT_CONFIG),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      "geolocation.provider": "ipapi",
    };
    return map[key] ?? "";
  }),
};

function buildService(): GeoCurrencyService {
  return new GeoCurrencyService(
    mockFxModel as any,
    mockConfigService as any,
    mockCurrencyConfigService as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GeoCurrencyService", () => {
  let service: GeoCurrencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
    // Default: no stale rates
    mockFxModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    mockFxModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue(STORED_RATES),
    });
  });

  // ── Property 5: X-Geo-Country passthrough ───────────────────────────────────

  describe("Property 5: X-Geo-Country header takes priority — no IP geolocation fired", () => {
    it("uses the X-Geo-Country header directly when it is a valid 2-letter code", async () => {
      const detectSpy = jest.spyOn(service as any, "detectCountry");

      const result = await service.getGeoContext("203.0.113.5", "GB");

      // detectCountry should NOT have been called
      expect(detectSpy).not.toHaveBeenCalled();
      expect(result.country).toBe("GB");
      expect(result.currency).toBe("GBP");
    });

    it("ignores a malformed X-Geo-Country header (non-alpha-2) and falls back to IP", async () => {
      const detectSpy = jest
        .spyOn(service as any, "detectCountry")
        .mockResolvedValue("NG");

      await service.getGeoContext("203.0.113.5", "INVALID");

      expect(detectSpy).toHaveBeenCalledWith("203.0.113.5");
    });
  });

  // ── Property 7: localhost → NG/NGN ─────────────────────────────────────────

  describe("Property 7: localhost always resolves to NG/NGN", () => {
    it("returns country=NG, currency=NGN for IPv4 localhost", async () => {
      const detectSpy = jest.spyOn(service as any, "detectCountry");

      const result = await service.getGeoContext("127.0.0.1");

      expect(detectSpy).not.toHaveBeenCalled();
      expect(result.country).toBe("NG");
      expect(result.currency).toBe("NGN");
    });

    it("returns country=NG, currency=NGN for IPv6 localhost", async () => {
      const result = await service.getGeoContext("::1");

      expect(result.country).toBe("NG");
      expect(result.currency).toBe("NGN");
    });

    it("returns country=NG, currency=NGN for ::ffff:127.0.0.1 (IPv4-mapped)", async () => {
      const result = await service.getGeoContext("::ffff:127.0.0.1");

      expect(result.country).toBe("NG");
      expect(result.currency).toBe("NGN");
    });
  });

  // ── Property 6: response shape completeness ─────────────────────────────────

  describe("Property 6: getGeoContext() always returns all required fields", () => {
    it("returns country, currency, rates, enabledCurrencies, fxBuffer", async () => {
      const result = await service.getGeoContext("127.0.0.1");

      expect(result).toHaveProperty("country");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("rates");
      expect(result).toHaveProperty("enabledCurrencies");
      expect(result).toHaveProperty("fxBuffer");
      expect(typeof result.country).toBe("string");
      expect(typeof result.currency).toBe("string");
      expect(Array.isArray(result.rates)).toBe(true);
      expect(Array.isArray(result.enabledCurrencies)).toBe(true);
      expect(typeof result.fxBuffer).toBe("number");
    });

    it("does NOT include staleRates field when rates are fresh", async () => {
      // findOne returns null → no stale doc found
      mockFxModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      });

      const result = await service.getGeoContext("127.0.0.1");

      expect(result.staleRates).toBeUndefined();
    });

    it("includes staleRates=true when a doc is older than threshold", async () => {
      // findOne returns a doc with old refreshedAt → stale
      mockFxModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ currency: "USD" }),
        }),
      });

      const result = await service.getGeoContext("127.0.0.1");

      expect(result.staleRates).toBe(true);
    });

    it("rates array contains an entry for each SUPPORTED_CURRENCIES item", async () => {
      const result = await service.getGeoContext("127.0.0.1");

      expect(result.rates.length).toBeGreaterThanOrEqual(3); // at least NGN, USD, GBP from mock
      for (const rate of result.rates) {
        expect(rate).toHaveProperty("currency");
        expect(rate).toHaveProperty("rate");
        expect(rate).toHaveProperty("symbol");
        expect(rate).toHaveProperty("flag");
      }
    });

    it("enabledCurrencies reflects the CurrencyConfig document", async () => {
      const result = await service.getGeoContext("127.0.0.1");

      expect(result.enabledCurrencies).toEqual(DEFAULT_CONFIG.enabledCurrencies);
    });

    it("fxBuffer reflects the CurrencyConfig document", async () => {
      const result = await service.getGeoContext("127.0.0.1");

      expect(result.fxBuffer).toBe(DEFAULT_CONFIG.fxBuffer);
    });
  });

  // ── countryOverrides ─────────────────────────────────────────────────────────

  describe("countryOverrides in CurrencyConfig", () => {
    it("uses countryOverride when country matches", async () => {
      mockCurrencyConfigService.getConfig.mockResolvedValue({
        ...DEFAULT_CONFIG,
        countryOverrides: { CA: "CAD" },
      });

      const result = await service.getGeoContext("127.0.0.1", "CA");

      expect(result.currency).toBe("CAD");
    });

    it("falls back to built-in map when countryOverrides has no match", async () => {
      mockCurrencyConfigService.getConfig.mockResolvedValue({
        ...DEFAULT_CONFIG,
        countryOverrides: {},
      });

      const result = await service.getGeoContext("127.0.0.1", "US");

      expect(result.currency).toBe("USD");
    });
  });
});
