/**
 * Unit tests for ShippingResolverService
 *
 * Tests all zone-matching logic, chargeable-weight calculation, and the full
 * estimate() flow including band edges, free-over threshold, and fallback
 * behaviour (spec §13 acceptance criteria A1–A3, A9).
 */

import { ShippingResolverService, CartLineWeight } from "./shipping-resolver.service";
import { ShippingZoneDocument } from "./schemas/shipping-zone.schema";
import { getModelToken } from "@nestjs/mongoose";
import { Test } from "@nestjs/testing";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeZone(
  overrides: Partial<ShippingZoneDocument>,
): ShippingZoneDocument {
  return {
    _id: "zone-id",
    name: "Test Zone",
    mode: "fixed",
    countries: ["NG"],
    states: [],
    priority: 0,
    isFallback: false,
    isActive: true,
    rates: [],
    flatFeeNgn: undefined,
    freeOverNgn: undefined,
    estimateRange: undefined,
    etaMinDays: undefined,
    etaMaxDays: undefined,
    pickupAvailable: false,
    customerNote: undefined,
    ...overrides,
  } as unknown as ShippingZoneDocument;
}

function item(weightGrams: number, l: number, w: number, h: number, qty = 1): CartLineWeight {
  return { weightGrams, dims: { l, w, h }, qty };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ShippingResolverService", () => {
  let service: ShippingResolverService;
  let mockFind: jest.Mock;

  beforeEach(async () => {
    mockFind = jest.fn();

    const mockZoneModel = {
      find: jest.fn().mockReturnValue({
        lean: mockFind,
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        ShippingResolverService,
        { provide: getModelToken("ShippingZone"), useValue: mockZoneModel },
      ],
    }).compile();

    service = module.get<ShippingResolverService>(ShippingResolverService);
  });

  // ── chargeableWeightGrams ────────────────────────────────────────────────

  describe("chargeableWeightGrams()", () => {
    it("returns actual weight when larger than volumetric", () => {
      // actual = 2000g; volumetric = (10×10×10/5000)×1000 = 20g → actual wins
      expect(service.chargeableWeightGrams([item(2000, 10, 10, 10, 1)])).toBe(2000);
    });

    it("returns volumetric weight when larger than actual", () => {
      // actual = 10g; volumetric = (50×50×50/5000)×1000 = 25000g → volumetric wins
      expect(service.chargeableWeightGrams([item(10, 50, 50, 50, 1)])).toBe(25000);
    });

    it("sums across multiple cart items and quantities", () => {
      // item1: actual 500×2=1000g, vol=(10×10×10/5000)×1000×2=40g
      // item2: actual 200×3=600g, vol=(20×10×5/5000)×1000×3=600g
      // total actual=1600g, total vol=640g → actual=1600 wins
      const items = [item(500, 10, 10, 10, 2), item(200, 20, 10, 5, 3)];
      expect(service.chargeableWeightGrams(items)).toBe(1600);
    });

    it("returns 0 for an empty cart", () => {
      expect(service.chargeableWeightGrams([])).toBe(0);
    });

    it("ceils the result to a whole gram", () => {
      // volumetric = (7×7×7/5000)×1000 = 68.6 → ceil = 69
      expect(service.chargeableWeightGrams([item(1, 7, 7, 7, 1)])).toBe(69);
    });
  });

  // ── findZone ─────────────────────────────────────────────────────────────

  describe("findZone()", () => {
    it("returns null when no zones exist", async () => {
      mockFind.mockResolvedValue([]);
      expect(await service.findZone("NG")).toBeNull();
    });

    it("matches a whole-country zone (no states restriction)", async () => {
      const z = makeZone({ countries: ["NG"], states: [] });
      mockFind.mockResolvedValue([z]);
      expect(await service.findZone("NG")).toBe(z);
    });

    it("matches a state-level zone when state is provided", async () => {
      const stateless = makeZone({ name: "NG whole", countries: ["NG"], states: [], priority: 0 });
      const lagos = makeZone({ name: "Lagos", countries: ["NG"], states: ["Lagos"], priority: 0 });
      mockFind.mockResolvedValue([stateless, lagos]);
      // Lagos-state zone should win (score 3 > 2)
      expect(await service.findZone("NG", "Lagos")).toBe(lagos);
    });

    it("falls back to country-level zone when state is not in the state-list", async () => {
      const country = makeZone({ name: "NG whole", countries: ["NG"], states: [], priority: 0 });
      const lagos = makeZone({ name: "Lagos", countries: ["NG"], states: ["Lagos"], priority: 0 });
      mockFind.mockResolvedValue([country, lagos]);
      // Kano state: Lagos zone is disqualified (score -1), country zone wins (score 2)
      expect(await service.findZone("NG", "Kano")).toBe(country);
    });

    it("uses the fallback zone when no country match exists", async () => {
      const fallback = makeZone({ name: "Rest of World", countries: [], isFallback: true, priority: 0 });
      mockFind.mockResolvedValue([fallback]);
      expect(await service.findZone("ZZ")).toBe(fallback);
    });

    it("prefers a specific zone over the fallback", async () => {
      const fallback = makeZone({ name: "Fallback", countries: [], isFallback: true, priority: 0 });
      const us = makeZone({ name: "US", countries: ["US"], states: [], priority: 5 });
      mockFind.mockResolvedValue([fallback, us]);
      expect(await service.findZone("US")).toBe(us);
    });

    it("breaks ties by priority (higher wins)", async () => {
      const low = makeZone({ name: "Low", countries: ["CA"], states: [], priority: 1 });
      const high = makeZone({ name: "High", countries: ["CA"], states: [], priority: 10 });
      mockFind.mockResolvedValue([low, high]);
      expect(await service.findZone("CA")).toBe(high);
    });
  });

  // ── estimate() ───────────────────────────────────────────────────────────

  describe("estimate()", () => {
    const baseInput = {
      country: "NG",
      state: "Kano",
      items: [item(300, 10, 10, 10, 1)], // 300g actual, 20g vol → 300g chargeable
      subtotalNgn: 5000000, // ₦50,000 in kobo
    };

    it("returns NO_ZONE when no zone matches", async () => {
      mockFind.mockResolvedValue([]);
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("NO_ZONE");
    });

    it("returns PICKUP with fee 0 when pickup is selected and zone allows it", async () => {
      const z = makeZone({ countries: ["NG"], states: [], pickupAvailable: true });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate({ ...baseInput, pickup: true });
      expect(result.status).toBe("PICKUP");
      expect(result.feeNgn).toBe(0);
      expect(result.source).toBe("pickup");
    });

    it("ignores pickup if zone does not allow it", async () => {
      const z = makeZone({ countries: ["NG"], states: [], mode: "fixed", flatFeeNgn: 200000, pickupAvailable: false });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate({ ...baseInput, pickup: true });
      expect(result.status).toBe("CALCULATED");
      expect(result.feeNgn).toBe(200000);
    });

    it("returns QUOTE_REQUIRED for a quote-mode zone", async () => {
      const z = makeZone({ countries: ["NG"], states: [], mode: "quote" });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("QUOTE_REQUIRED");
    });

    it("returns QUOTE_REQUIRED estimate range when configured", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "quote",
        estimateRange: { minNgn: 1000000, maxNgn: 3000000 },
      });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("QUOTE_REQUIRED");
      if (result.status === "QUOTE_REQUIRED") {
        expect(result.estimateRange).toEqual({ minNgn: 1000000, maxNgn: 3000000 });
      }
    });

    // Weight band edge tests (spec A1, A3)

    it("uses the rate-card band — minGrams is inclusive", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 300, maxGrams: 1000, feeNgn: 250000 }],
      });
      mockFind.mockResolvedValue([z]);
      // 300g cart is exactly at minGrams=300 → should match
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      expect(result.feeNgn).toBe(250000);
      expect(result.source).toBe("rate_card");
    });

    it("uses the rate-card band — maxGrams is exclusive", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 300, feeNgn: 150000 }],
      });
      mockFind.mockResolvedValue([z]);
      // 300g cart equals maxGrams=300 → should NOT match (exclusive upper bound)
      const result = await service.estimate(baseInput);
      // Falls back to QUOTE_REQUIRED since no band covers 300g and no flatFee
      expect(result.status).toBe("QUOTE_REQUIRED");
    });

    it("falls back to flatFeeNgn when no band covers the weight (A3)", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 100, feeNgn: 100000 }],
        flatFeeNgn: 600000,
      });
      mockFind.mockResolvedValue([z]);
      // 300g is outside the only band → flatFee kicks in, not zero
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      expect(result.feeNgn).toBe(600000);
      expect(result.source).toBe("flat_fee");
    });

    it("routes to QUOTE_REQUIRED when weight is outside all bands and no flatFee (A3)", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 100, feeNgn: 100000 }],
        flatFeeNgn: undefined,
      });
      mockFind.mockResolvedValue([z]);
      // 300g outside band, no flat fee → must not charge 0
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("QUOTE_REQUIRED");
    });

    // Free-over threshold (spec A1)

    it("applies free-over threshold when subtotal exceeds it", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 1000, feeNgn: 250000 }],
        freeOverNgn: 4000000, // free over ₦40,000 (in kobo)
      });
      mockFind.mockResolvedValue([z]);
      // subtotalNgn=5_000_000 (₦50,000) > freeOverNgn=4_000_000 → free
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      expect(result.feeNgn).toBe(0);
      expect(result.source).toBe("free_threshold");
    });

    it("does not apply free-over threshold when subtotal is below it", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 1000, feeNgn: 250000 }],
        freeOverNgn: 10000000, // free over ₦100,000
      });
      mockFind.mockResolvedValue([z]);
      // subtotalNgn=5_000_000 < 10_000_000 → normal fee applies
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      expect(result.feeNgn).toBe(250000);
    });

    // ETA range

    it("includes etaDays when zone has both min and max", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 1000, feeNgn: 100000 }],
        etaMinDays: 2,
        etaMaxDays: 4,
      });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      if (result.status === "CALCULATED") {
        expect(result.etaDays).toEqual([2, 4]);
      }
    });

    it("omits etaDays when zone only has one bound", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        flatFeeNgn: 100000,
        etaMinDays: 2,
        etaMaxDays: undefined,
      });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate(baseInput);
      if (result.status === "CALCULATED") {
        expect(result.etaDays).toBeUndefined();
      }
    });

    it("snapshots chargeableWeightGrams on the result", async () => {
      const z = makeZone({
        countries: ["NG"], states: [], mode: "fixed",
        rates: [{ minGrams: 0, maxGrams: 1000, feeNgn: 200000 }],
      });
      mockFind.mockResolvedValue([z]);
      const result = await service.estimate(baseInput);
      expect(result.status).toBe("CALCULATED");
      if (result.status === "CALCULATED") {
        expect(result.chargeableWeightGrams).toBe(300);
      }
    });
  });
});
