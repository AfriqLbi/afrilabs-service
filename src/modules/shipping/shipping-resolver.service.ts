import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  ShippingZone,
  ShippingZoneDocument,
} from "./schemas/shipping-zone.schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartLineWeight {
  weightGrams: number;
  dims: { l: number; w: number; h: number }; // cm
  qty: number;
}

export type EstimateStatus =
  | "CALCULATED"
  | "QUOTE_REQUIRED"
  | "PICKUP"
  | "NO_ZONE";

export interface EstimateResult {
  status: EstimateStatus;
  zone?: ShippingZoneDocument;
  /** Fee in NGN kobo. Only present when status === "CALCULATED" or "PICKUP". */
  feeNgn?: number;
  /** How the fee was determined. */
  source?: "rate_card" | "flat_fee" | "free_threshold" | "pickup";
  /** Chargeable weight used for the calculation. */
  chargeableWeightGrams?: number;
  /** Estimate range for quote-mode zones (kobo). */
  estimateRange?: { minNgn: number; maxNgn: number };
  /** Estimated delivery window in days. */
  etaDays?: [number, number];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ShippingResolverService {
  constructor(
    @InjectModel(ShippingZone.name)
    private readonly zones: Model<ShippingZoneDocument>,
  ) {}

  // ─── Zone matching ────────────────────────────────────────────────────────

  /**
   * Finds the best-matching active shipping zone for the given address.
   *
   * Matching priority (higher is better):
   *   3 — zone.countries includes country AND zone.states includes state
   *   2 — zone.countries includes country AND zone.states is empty (whole country)
   *   1 — isFallback
   *  -1 — disqualified (country-level zone whose states list excludes this state)
   *
   * Among equal priority scores, the zone with the higher `priority` field wins.
   */
  async findZone(
    country: string,
    state?: string,
  ): Promise<ShippingZoneDocument | null> {
    const candidates = await this.zones
      .find({
        isActive: true,
        $or: [{ countries: country }, { isFallback: true }],
      })
      .lean<ShippingZoneDocument[]>();

    const score = (z: ShippingZoneDocument): number => {
      if (z.isFallback) return 1;
      // Specific-country zone
      if (z.states?.length) {
        // Has state restrictions — only matches if state is listed
        return state && z.states.includes(state) ? 3 : -1;
      }
      // Whole-country zone
      return 2;
    };

    const valid = candidates
      .filter((z) => score(z) >= 0)
      .sort((a, b) => score(b) - score(a) || b.priority - a.priority);

    return valid[0] ?? null;
  }

  // ─── Weight calculation ───────────────────────────────────────────────────

  /**
   * Returns the chargeable weight in grams: max(actual, volumetric).
   * Volumetric weight formula: (L × W × H cm³) / 5000 × 1000 g per item.
   * Both sides are summed across all cart lines.
   */
  chargeableWeightGrams(items: CartLineWeight[]): number {
    const actual = items.reduce((s, i) => s + i.weightGrams * i.qty, 0);
    const volumetric = items.reduce(
      (s, i) =>
        s + ((i.dims.l * i.dims.w * i.dims.h) / 5000) * 1000 * i.qty,
      0,
    );
    return Math.ceil(Math.max(actual, volumetric));
  }

  // ─── Estimate ─────────────────────────────────────────────────────────────

  /**
   * The main entry point called by the shipping estimate endpoint.
   *
   * Returns one of:
   *   CALCULATED    — fee computed from the rate card
   *   QUOTE_REQUIRED — zone is quote-mode, or weight is outside all bands
   *   PICKUP        — customer selected pickup and zone allows it
   *   NO_ZONE       — no zone matches and no fallback configured
   *
   * All monetary values are in NGN kobo.
   */
  async estimate(input: {
    country: string;
    state?: string;
    items: CartLineWeight[];
    /** Cart items subtotal in NGN kobo — used for free-over threshold check. */
    subtotalNgn: number;
    pickup?: boolean;
  }): Promise<EstimateResult> {
    const zone = await this.findZone(input.country, input.state);

    if (!zone) {
      return { status: "NO_ZONE" };
    }

    // Pickup shortcut — trumps everything else
    if (input.pickup && zone.pickupAvailable) {
      return {
        status: "PICKUP",
        zone,
        feeNgn: 0,
        source: "pickup",
        etaDays: zone.etaMinDays != null && zone.etaMaxDays != null
          ? [zone.etaMinDays, zone.etaMaxDays]
          : undefined,
      };
    }

    // Quote-mode zone — no automatic fee
    if (zone.mode === "quote") {
      return {
        status: "QUOTE_REQUIRED",
        zone,
        estimateRange: zone.estimateRange
          ? { minNgn: zone.estimateRange.minNgn, maxNgn: zone.estimateRange.maxNgn }
          : undefined,
        etaDays: zone.etaMinDays != null && zone.etaMaxDays != null
          ? [zone.etaMinDays, zone.etaMaxDays]
          : undefined,
      };
    }

    // Fixed-mode zone — compute fee
    const grams = this.chargeableWeightGrams(input.items);

    // Check free-over threshold first (compare item subtotal, excluding shipping)
    if (zone.freeOverNgn != null && input.subtotalNgn >= zone.freeOverNgn) {
      return {
        status: "CALCULATED",
        zone,
        feeNgn: 0,
        source: "free_threshold",
        chargeableWeightGrams: grams,
        etaDays: zone.etaMinDays != null && zone.etaMaxDays != null
          ? [zone.etaMinDays, zone.etaMaxDays]
          : undefined,
      };
    }

    // Find matching weight band (minGrams inclusive, maxGrams exclusive)
    const band = zone.rates.find(
      (r) => grams >= r.minGrams && grams < r.maxGrams,
    );

    const feeNgn = band?.feeNgn ?? zone.flatFeeNgn;

    // Safety net: if no band and no flat fee, fall back to quote
    if (feeNgn == null) {
      return {
        status: "QUOTE_REQUIRED",
        zone,
        estimateRange: zone.estimateRange
          ? { minNgn: zone.estimateRange.minNgn, maxNgn: zone.estimateRange.maxNgn }
          : undefined,
        etaDays: zone.etaMinDays != null && zone.etaMaxDays != null
          ? [zone.etaMinDays, zone.etaMaxDays]
          : undefined,
      };
    }

    return {
      status: "CALCULATED",
      zone,
      feeNgn,
      source: band ? "rate_card" : "flat_fee",
      chargeableWeightGrams: grams,
      etaDays: zone.etaMinDays != null && zone.etaMaxDays != null
        ? [zone.etaMinDays, zone.etaMaxDays]
        : undefined,
    };
  }
}
