/**
 * Labi Fashion — Shipping Zone Seed Script
 *
 * Seeds the initial shipping zones per spec §5.5 (illustrative rate bands —
 * client replaces these with real values in the admin dashboard).
 * Idempotent — safe to run multiple times.
 *
 * Run:  npx ts-node -r tsconfig-paths/register scripts/seed-shipping-zones.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import mongoose from "mongoose";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI =
  process.env.MONGODB_URI ?? "mongodb://localhost:27017/alphavista";

import { ShippingZoneSchema } from "../src/modules/shipping/schemas/shipping-zone.schema";

// ── Seed data ─────────────────────────────────────────────────────────────────
// All monetary values in NGN kobo (100 kobo = ₦1).
// Weight values in grams.
// Client sets real values; these are safe illustrative defaults.

const zones = [
  // ── Lagos (state-level, fixed, weight bands) ─────────────────────────────
  {
    name: "Lagos",
    mode: "fixed" as const,
    countries: ["NG"],
    states: ["Lagos", "LA"],
    priority: 20,
    isFallback: false,
    isActive: true,
    rates: [
      { minGrams: 0, maxGrams: 500, feeNgn: 150000 },     // ₦1,500
      { minGrams: 500, maxGrams: 2000, feeNgn: 250000 },   // ₦2,500
      { minGrams: 2000, maxGrams: 5000, feeNgn: 400000 },  // ₦4,000
    ],
    flatFeeNgn: 600000,          // ₦6,000 catch-all for heavier items
    freeOverNgn: 10000000,       // Free over ₦100,000 subtotal
    etaMinDays: 1,
    etaMaxDays: 3,
    pickupAvailable: false,
    customerNote: undefined,
  },

  // ── Other Nigerian States (whole country except Lagos) ───────────────────
  {
    name: "Other Nigerian States",
    mode: "fixed" as const,
    countries: ["NG"],
    states: [],               // no state restriction = all of NG
    priority: 10,             // lower than Lagos — Lagos state match wins
    isFallback: false,
    isActive: true,
    rates: [
      { minGrams: 0, maxGrams: 500, feeNgn: 250000 },
      { minGrams: 500, maxGrams: 2000, feeNgn: 400000 },
      { minGrams: 2000, maxGrams: 5000, feeNgn: 600000 },
    ],
    flatFeeNgn: 900000,          // ₦9,000 catch-all
    freeOverNgn: 15000000,       // Free over ₦150,000 subtotal
    etaMinDays: 2,
    etaMaxDays: 5,
    pickupAvailable: false,
    customerNote: undefined,
  },

  // ── Canada ────────────────────────────────────────────────────────────────
  {
    name: "Canada",
    mode: "quote" as const,
    countries: ["CA"],
    states: [],
    priority: 5,
    isFallback: false,
    isActive: true,
    rates: [],
    estimateRange: { minNgn: 4500000, maxNgn: 9000000 }, // ₦45,000 – ₦90,000
    etaMinDays: 7,
    etaMaxDays: 14,
    pickupAvailable: false,
    customerNote: "Import duties and taxes are payable by the recipient on delivery.",
  },

  // ── United Kingdom ────────────────────────────────────────────────────────
  {
    name: "United Kingdom",
    mode: "quote" as const,
    countries: ["GB"],
    states: [],
    priority: 5,
    isFallback: false,
    isActive: true,
    rates: [],
    estimateRange: { minNgn: 4000000, maxNgn: 8000000 },
    etaMinDays: 5,
    etaMaxDays: 10,
    pickupAvailable: false,
    customerNote: "Import duties and taxes are payable by the recipient on delivery.",
  },

  // ── United States ─────────────────────────────────────────────────────────
  {
    name: "United States",
    mode: "quote" as const,
    countries: ["US"],
    states: [],
    priority: 5,
    isFallback: false,
    isActive: true,
    rates: [],
    estimateRange: { minNgn: 5000000, maxNgn: 10000000 },
    etaMinDays: 7,
    etaMaxDays: 14,
    pickupAvailable: false,
    customerNote: "Import duties and taxes are payable by the recipient on delivery.",
  },

  // ── Rest of World (fallback) ──────────────────────────────────────────────
  {
    name: "Rest of World",
    mode: "quote" as const,
    countries: [],
    states: [],
    priority: 0,
    isFallback: true,
    isActive: true,
    rates: [],
    etaMinDays: 10,
    etaMaxDays: 21,
    pickupAvailable: false,
    customerNote:
      "International shipping is quoted per order. " +
      "Import duties and taxes are payable by the recipient on delivery.",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✓ Connected to MongoDB");

  const ShippingZone = mongoose.model("ShippingZone", ShippingZoneSchema);

  let created = 0;
  let skipped = 0;

  for (const zone of zones) {
    const existing = await ShippingZone.findOne({ name: zone.name });
    if (existing) {
      console.log(`  ↷ Skipping existing zone: ${zone.name}`);
      skipped++;
      continue;
    }
    await ShippingZone.create(zone);
    console.log(`  ✓ Created zone: ${zone.name}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}  Skipped (already exists): ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
