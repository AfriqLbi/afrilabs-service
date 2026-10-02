/**
 * Labi Fashion — Database Seed Script
 *
 * Seeds categories, one staff user, and sample custom-order data for Labi.
 * Idempotent — safe to run multiple times (upsert throughout).
 *
 * Run:  npx ts-node -r tsconfig-paths/register scripts/seed-labi.ts
 *
 * Seeding order:
 *   1. Labi categories (fashion garment types as per PRD)
 *   2. Staff user (production/ops role)
 *   3. Sample measurement profiles
 *   4. Sample custom order requests
 */

import * as dotenv from "dotenv";
import * as path from "path";
import mongoose, { Connection, Types } from "mongoose";
import * as bcrypt from "bcryptjs";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGO_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/alphavista";
const SALT = 12;

// ── Schema imports ────────────────────────────────────────────────────────────
import { UserSchema } from "../src/modules/auth/schemas/user.schema";
import { CategorySchema } from "../src/modules/catalog/schemas/category.schema";
import {
  MeasurementProfileSchema,
} from "../src/modules/measurement-profile/schemas/measurement-profile.schema";
import {
  CustomOrderSchema,
} from "../src/modules/custom-order/schemas/custom-order.schema";

// ── Helper ────────────────────────────────────────────────────────────────────

function sl(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function up(
  M: mongoose.Model<any>,
  filter: Record<string, unknown>,
  doc: Record<string, unknown>,
): Promise<{ _id: Types.ObjectId; [key: string]: unknown }> {
  return (await M.findOneAndUpdate(
    filter,
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )) as { _id: Types.ObjectId; [key: string]: unknown };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧵  Labi Fashion seed starting…");
  console.log(`   DB: ${MONGO_URI.replace(/\/\/[^@]+@/, "//***@")}\n`);

  const conn: Connection = mongoose.createConnection(MONGO_URI, {
    serverSelectionTimeoutMS: 30_000,
  });
  await conn.asPromise();
  console.log("✅  Connected\n");

  const Users = conn.model("User", UserSchema, "users");
  const Cats = conn.model("Category", CategorySchema, "categories");
  const Measurements = conn.model("MeasurementProfile", MeasurementProfileSchema, "measurement_profiles");
  const CustomOrders = conn.model("CustomOrder", CustomOrderSchema, "custom_orders");

  // ════════════════════════════════════════════════════════════════════════════
  // 1. CATEGORIES
  //    All product categories listed in the PRD, plus the audience groupings.
  //    Type "category" = standard browseable category
  //    Type "section"  = curated storefront section (e.g. New Arrivals)
  //    Upsert key: slug (unique index).
  // ════════════════════════════════════════════════════════════════════════════
  console.log("── 1. Categories");

  const labiCategories = [
    // ── Audience groupings ──────────────────────────────────────────────────
    {
      name: "Men",
      slug: "men",
      type: "category",
      sortOrder: 1,
      blurb: "Bespoke and ready-to-wear fashion for men.",
    },
    {
      name: "Women",
      slug: "women",
      type: "category",
      sortOrder: 2,
      blurb: "Made-to-order and catalog fashion for women.",
    },
    {
      name: "Children",
      slug: "children",
      type: "category",
      sortOrder: 3,
      blurb: "Custom-fitted children's wear in premium fabrics.",
    },

    // ── Fabric / material ───────────────────────────────────────────────────
    {
      name: "Aso Oke Material",
      slug: "aso-oke-material",
      type: "category",
      sortOrder: 10,
      blurb: "Hand-woven and machine-woven Aso Oke fabric sold by the yard.",
    },

    // ── Garment types (the core made-to-order catalogue) ───────────────────
    {
      name: "Ayinde Aso Oke Padded Jacket",
      slug: "ayinde-aso-oke-padded-jacket",
      type: "category",
      sortOrder: 20,
      blurb: "The signature Ayinde Aso Oke padded jacket — single and double-sided.",
    },
    {
      name: "Cargo Pants",
      slug: "cargo-pants",
      type: "category",
      sortOrder: 21,
      blurb: "Tailored cargo trousers with side pockets and custom fit.",
    },
    {
      name: "Office Pants",
      slug: "office-pants",
      type: "category",
      sortOrder: 22,
      blurb: "Smart office trousers cut to your measurements.",
    },
    {
      name: "Aso Oke Jacket",
      slug: "aso-oke-jacket",
      type: "category",
      sortOrder: 23,
      blurb: "Classic Aso Oke jackets for ceremonies and formal occasions.",
    },
    {
      name: "Crop Top Jacket for Ladies",
      slug: "crop-top-jacket-ladies",
      type: "category",
      sortOrder: 24,
      blurb: "Short Aso Oke crop-top jacket — perfect for Aso-Ebi occasions.",
    },
    {
      name: "Aso Oke Trench Coat",
      slug: "aso-oke-trench-coat",
      type: "category",
      sortOrder: 25,
      blurb: "Full-length Aso Oke trench coat — statement piece for any occasion.",
    },
    {
      name: "Aso Oke Hoodie Both Side",
      slug: "aso-oke-hoodie-both-side",
      type: "category",
      sortOrder: 26,
      blurb: "Double-sided Aso Oke hoodie — wear either side out.",
    },
    {
      name: "Aso Oke Padded Jacket Double Side",
      slug: "aso-oke-padded-jacket-double-side",
      type: "category",
      sortOrder: 27,
      blurb: "Double-sided padded jacket in Aso Oke fabric.",
    },
    {
      name: "Straight Pants",
      slug: "straight-pants",
      type: "category",
      sortOrder: 28,
      blurb: "Straight-leg trousers cut to measure in your choice of fabric.",
    },
    {
      name: "Danshiki",
      slug: "danshiki",
      type: "category",
      sortOrder: 29,
      blurb: "Traditional Danshiki tops and sets in bold African prints.",
    },
    {
      name: "Aso Oke Gown",
      slug: "aso-oke-gown",
      type: "category",
      sortOrder: 30,
      blurb: "Floor-length Aso Oke gowns for bridal, owambe, and formal events.",
    },

    // ── Curated sections ────────────────────────────────────────────────────
    {
      name: "New Arrivals",
      slug: "new-arrivals",
      type: "section",
      sortOrder: 100,
      blurb: "Freshly added pieces.",
    },
    {
      name: "Bridal",
      slug: "bridal",
      type: "section",
      sortOrder: 101,
      blurb: "Bespoke pieces for the big day.",
    },
    {
      name: "Aso-Ebi",
      slug: "aso-ebi",
      type: "section",
      sortOrder: 102,
      blurb: "Coordinated family and group attire.",
    },
  ];

  const categoryMap: Record<string, Types.ObjectId> = {};

  for (const c of labiCategories) {
    const doc = await up(
      Cats,
      { slug: c.slug },
      {
        name: c.name,
        slug: c.slug,
        blurb: c.blurb,
        sortOrder: c.sortOrder,
        parentId: null,
        subcategories: [],
        // Non-standard field: "type" is not in the existing CategorySchema.
        // We store it in the document anyway — Mongoose ignores unknown fields
        // by default unless strict mode is explicitly set to throw.
        // When the CategorySchema is extended for Labi, add: @Prop() type: string
        type: c.type,
      },
    );
    categoryMap[c.slug] = doc._id;
  }

  console.log(`   ✓ ${labiCategories.length} categories/sections seeded`);

  // ════════════════════════════════════════════════════════════════════════════
  // 2. STAFF USER (production / ops role)
  //    Upsert key: email.
  // ════════════════════════════════════════════════════════════════════════════
  console.log("── 2. Staff user");

  const staffHash = await bcrypt.hash("Staff@Labi!2026", SALT);
  const staffUser = await up(
    Users,
    { email: "tailor@labi.ng" },
    {
      name: "Ife Adeyemi",
      email: "tailor@labi.ng",
      passwordHash: staffHash,
      role: "staff",
      active: true,
      phone: "+2348012345678",
    },
  );

  // Also ensure a super_admin exists for Labi
  const adminHash = await bcrypt.hash("Admin@Labi!2026", SALT);
  const adminUser = await up(
    Users,
    { email: "admin@labi.ng" },
    {
      name: "Labi Admin",
      email: "admin@labi.ng",
      passwordHash: adminHash,
      role: "super_admin",
      active: true,
      phone: "+2348099000001",
    },
  );

  // Customer for sample orders
  const custHash = await bcrypt.hash("Chioma@Pass!2026", SALT);
  const custUser = await up(
    Users,
    { email: "chioma@example.com" },
    {
      name: "Chioma Okafor",
      email: "chioma@example.com",
      passwordHash: custHash,
      role: "customer",
      active: true,
      phone: "+2348033445566",
    },
  );

  console.log("   ✓ staff (tailor@labi.ng), super_admin (admin@labi.ng), customer (chioma@example.com)");

  // ════════════════════════════════════════════════════════════════════════════
  // 3. MEASUREMENT PROFILES
  //    One profile per (userId, garmentType). Schema-driven — flexible fields.
  //    Demonstrates the core differentiator: different garment types have
  //    completely different measurement sets.
  // ════════════════════════════════════════════════════════════════════════════
  console.log("── 3. Measurement profiles");

  const custId = custUser._id.toString();

  await up(
    Measurements,
    { userId: custId, garmentType: "aso-oke-jacket" },
    {
      userId: custId,
      garmentType: "aso-oke-jacket",
      garmentLabel: "Aso Oke Jacket",
      measurements: [
        { key: "chest", label: "Chest (cm)", value: 96 },
        { key: "shoulder", label: "Shoulder (cm)", value: 44 },
        { key: "sleeve", label: "Sleeve Length (cm)", value: 62 },
        { key: "length", label: "Jacket Length (cm)", value: 74 },
        { key: "waist", label: "Waist (cm)", value: 82 },
      ],
      notes: "Prefer a slightly relaxed fit around the chest.",
    },
  );

  await up(
    Measurements,
    { userId: custId, garmentType: "straight-pants" },
    {
      userId: custId,
      garmentType: "straight-pants",
      garmentLabel: "Straight Pants",
      measurements: [
        { key: "waist", label: "Waist (cm)", value: 82 },
        { key: "hip", label: "Hip (cm)", value: 100 },
        { key: "thigh", label: "Thigh (cm)", value: 56 },
        { key: "inseam", label: "Inseam Length (cm)", value: 78 },
        { key: "outseam", label: "Outseam Length (cm)", value: 102 },
      ],
      notes: null,
    },
  );

  await up(
    Measurements,
    { userId: custId, garmentType: "aso-oke-gown" },
    {
      userId: custId,
      garmentType: "aso-oke-gown",
      garmentLabel: "Aso Oke Gown",
      measurements: [
        { key: "bust", label: "Bust (cm)", value: 94 },
        { key: "waist", label: "Waist (cm)", value: 76 },
        { key: "hip", label: "Hip (cm)", value: 102 },
        { key: "length", label: "Gown Length (cm)", value: 152 },
        { key: "shoulder", label: "Shoulder (cm)", value: 40 },
        { key: "sleeve", label: "Sleeve Length (cm)", value: 58 },
      ],
      notes: "Floor-length preferred. No train.",
    },
  );

  console.log("   ✓ 3 measurement profiles for chioma@example.com");

  // ════════════════════════════════════════════════════════════════════════════
  // 4. CUSTOM ORDERS — sample data covering each status
  // ════════════════════════════════════════════════════════════════════════════
  console.log("── 4. Custom orders");

  const whatsappLink =
    "https://wa.me/2348000000001?text=Hi%2C%20I%20submitted%20a%20custom%20order%20and%20would%20like%20to%20follow%20up.";

  // CO-1001: pending_review — just submitted by Chioma
  await up(
    CustomOrders,
    { referenceNumber: "CO-1001" },
    {
      customerId: custId,
      customerEmail: "chioma@example.com",
      customerName: "Chioma Okafor",
      customerPhone: "+2348033445566",
      referenceNumber: "CO-1001",
      description:
        "I need a custom Aso Oke jacket for my brother's wedding. Navy blue base with gold trim, padded shoulders, double-breasted.",
      garmentCategory: "Aso Oke Jacket",
      fabricChoice: "Aso Oke — navy and gold",
      referenceImages: [],
      measurement: {
        profileId: null,
        garmentType: "aso-oke-jacket",
        garmentLabel: "Aso Oke Jacket",
        fields: [
          { key: "chest", label: "Chest (cm)", value: 96 },
          { key: "shoulder", label: "Shoulder (cm)", value: 44 },
          { key: "sleeve", label: "Sleeve Length (cm)", value: 62 },
          { key: "length", label: "Jacket Length (cm)", value: 74 },
          { key: "waist", label: "Waist (cm)", value: 82 },
        ],
      },
      status: "pending_review",
      quotedPrice: null,
      estimatedReadyDate: null,
      adminQuoteNote: null,
      quotedBy: null,
      quotedAt: null,
      paymentProvider: null,
      paymentReference: null,
      checkoutUrl: null,
      processedWebhookId: null,
      paidAt: null,
      linkedOrderId: null,
      whatsappLink,
    },
  );

  // CO-1002: quoted — admin has reviewed and set a price
  await up(
    CustomOrders,
    { referenceNumber: "CO-1002" },
    {
      customerId: custId,
      customerEmail: "chioma@example.com",
      customerName: "Chioma Okafor",
      customerPhone: "+2348033445566",
      referenceNumber: "CO-1002",
      description:
        "Aso Oke trench coat in burgundy and cream. Full-length with belt. Event: December 2026.",
      garmentCategory: "Aso Oke Trench Coat",
      fabricChoice: "Aso Oke — burgundy and cream",
      referenceImages: [],
      measurement: {
        profileId: null,
        garmentType: "aso-oke-trench-coat",
        garmentLabel: "Aso Oke Trench Coat",
        fields: [
          { key: "bust", label: "Bust (cm)", value: 94 },
          { key: "waist", label: "Waist (cm)", value: 76 },
          { key: "hip", label: "Hip (cm)", value: 102 },
          { key: "length", label: "Coat Length (cm)", value: 130 },
          { key: "shoulder", label: "Shoulder (cm)", value: 40 },
          { key: "sleeve", label: "Sleeve Length (cm)", value: 60 },
        ],
      },
      status: "quoted",
      quotedPrice: 120_000,
      estimatedReadyDate: "2026-11-28",
      adminQuoteNote:
        "Price includes sourcing Aso Oke fabric, 2 fittings, and 30-day free alterations.",
      quotedBy: adminUser._id.toString(),
      quotedAt: new Date("2026-09-05T11:00:00Z"),
      paymentProvider: null,
      paymentReference: null,
      checkoutUrl: null,
      processedWebhookId: null,
      paidAt: null,
      linkedOrderId: null,
      whatsappLink,
    },
  );

  // CO-1003: paid + in_production — fully confirmed, currently being made
  await up(
    CustomOrders,
    { referenceNumber: "CO-1003" },
    {
      customerId: null, // guest order — tests the guest custom order path
      customerEmail: "akin@example.com",
      customerName: "Akin Adeyemi",
      customerPhone: "+2348077665544",
      referenceNumber: "CO-1003",
      description:
        "2 matching Aso Oke Danshiki sets for myself and my son. Ages: me (adult), son (7 years).",
      garmentCategory: "Danshiki",
      fabricChoice: "Ankara print — red and white",
      referenceImages: [],
      measurement: {
        profileId: null,
        garmentType: "danshiki",
        garmentLabel: "Danshiki",
        fields: [
          { key: "chest", label: "Chest (cm)", value: 104 },
          { key: "length", label: "Length (cm)", value: 80 },
          { key: "shoulder", label: "Shoulder (cm)", value: 48 },
        ],
      },
      status: "in_production",
      quotedPrice: 65_000,
      estimatedReadyDate: "2026-09-30",
      adminQuoteNote: "Includes fabric for 2 sets (adult + child).",
      quotedBy: adminUser._id.toString(),
      quotedAt: new Date("2026-09-01T09:00:00Z"),
      paymentProvider: "paystack",
      paymentReference: "CO-1003-SEED-PAY",
      checkoutUrl: null,
      processedWebhookId: "paystack:seed-99001",
      paidAt: new Date("2026-09-02T14:30:00Z"),
      linkedOrderId: null,
      whatsappLink,
    },
  );

  console.log("   ✓ 3 custom orders (pending_review, quoted, in_production)");

  // ── Done ──────────────────────────────────────────────────────────────────
  await conn.close();
  console.log("\n🎉  Labi seed complete!\n");
  console.log("   Credentials:");
  console.log("   admin@labi.ng       / Admin@Labi!2026   (super_admin)");
  console.log("   tailor@labi.ng      / Staff@Labi!2026   (staff)");
  console.log("   chioma@example.com  / Chioma@Pass!2026  (customer)");
  console.log("");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
