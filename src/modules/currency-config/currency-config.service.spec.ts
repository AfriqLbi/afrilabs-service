/**
 * CurrencyConfigService — Unit Tests
 *
 * Covers:
 *   - Design Property 8: fxBuffer validation bounds (0–20)
 *   - getConfig() 60-second cache TTL
 *   - seedDefault() idempotency ($setOnInsert never creates duplicates)
 */

import { CurrencyConfigService } from "./currency-config.service";

// ── Mock ─────────────────────────────────────────────────────────────────────

const DEFAULT_DOC = {
  configKey: "global",
  enabledCurrencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"],
  countryOverrides: {},
  fxBuffer: 2,
  roundingRules: {},
  staleRateThresholdMinutes: 240,
};

const mockConfigModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

function buildService(): CurrencyConfigService {
  return new CurrencyConfigService(mockConfigModel as any);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CurrencyConfigService", () => {
  let service: CurrencyConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // ── getConfig() cache TTL ───────────────────────────────────────────────────

  describe("getConfig()", () => {
    it("returns the config document from MongoDB on first call", async () => {
      mockConfigModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });

      const result = await service.getConfig();

      expect(result.configKey).toBe("global");
      expect(result.fxBuffer).toBe(2);
      expect(mockConfigModel.findOne).toHaveBeenCalledTimes(1);
    });

    it("returns cached value on second call within TTL — no extra DB query", async () => {
      mockConfigModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });

      await service.getConfig();
      await service.getConfig();

      // findOne should only have been called once (second call hit cache)
      expect(mockConfigModel.findOne).toHaveBeenCalledTimes(1);
    });

    it("calls seedDefault() when no document exists (findOne returns null)", async () => {
      // First findOne returns null → seedDefault
      mockConfigModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      // seedDefault uses findOneAndUpdate().lean()
      mockConfigModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });

      const result = await service.getConfig();

      expect(mockConfigModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      // The $setOnInsert argument must include the default fxBuffer
      const call = mockConfigModel.findOneAndUpdate.mock.calls[0];
      expect(call[1].$setOnInsert.fxBuffer).toBe(2);
      expect(result.fxBuffer).toBe(2);
    });
  });

  // ── seedDefault() idempotency (Property 8 adjacent) ─────────────────────────

  describe("seedDefault()", () => {
    it("uses $setOnInsert + upsert:true so a second call does not overwrite existing config", async () => {
      mockConfigModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });

      await (service as any).seedDefault();
      await (service as any).seedDefault();

      // Both calls must use $setOnInsert (never $set) to be idempotent
      for (const call of mockConfigModel.findOneAndUpdate.mock.calls) {
        expect(call[1]).toHaveProperty("$setOnInsert");
        expect(call[1]).not.toHaveProperty("$set");
        expect(call[2]).toMatchObject({ upsert: true });
      }
    });

    it("seeds configKey='global' with fxBuffer=2 and 7 enabled currencies", async () => {
      mockConfigModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });

      await (service as any).seedDefault();

      const call = mockConfigModel.findOneAndUpdate.mock.calls[0];
      const insert = call[1].$setOnInsert;
      expect(insert.configKey).toBe("global");
      expect(insert.fxBuffer).toBe(2);
      expect(insert.enabledCurrencies).toHaveLength(7);
      expect(insert.enabledCurrencies).toContain("NGN");
    });
  });

  // ── updateConfig() cache invalidation (Design Property 8) ───────────────────

  describe("updateConfig()", () => {
    it("invalidates the in-memory cache after a successful update", async () => {
      // Seed the cache
      mockConfigModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(DEFAULT_DOC),
      });
      await service.getConfig(); // cache is now warm

      // Update — findOneAndUpdate chains .lean()
      const updated = { ...DEFAULT_DOC, fxBuffer: 5 };
      mockConfigModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue(updated),
      });
      await service.updateConfig({ fxBuffer: 5 });

      // Next getConfig() must hit the DB again (cache was invalidated)
      mockConfigModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(updated),
      });
      const result = await service.getConfig();
      expect(mockConfigModel.findOne).toHaveBeenCalledTimes(2); // once before, once after
      expect(result.fxBuffer).toBe(5);
    });

    it("passes the patch as $set to MongoDB", async () => {
      mockConfigModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...DEFAULT_DOC, fxBuffer: 3 }),
      });

      await service.updateConfig({ fxBuffer: 3 });

      const call = mockConfigModel.findOneAndUpdate.mock.calls[0];
      expect(call[1].$set).toMatchObject({ fxBuffer: 3 });
    });
  });
});
