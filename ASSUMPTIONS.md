# Labi Backend — Assumptions, Decisions & Trade-offs

This document records every assumption made during the Labi extension of the Alphavista
backend, every place a decision was made that a stakeholder should be able to see, and
every trade-off taken when extending an existing codebase rather than building fresh.

---

## 1. Codebase baseline

The Labi fashion modules were built on top of an existing Alphavista Electronics NestJS
backend. The following conventions were inherited without change:

| Convention | Detail |
|---|---|
| Database | MongoDB (Mongoose via `@nestjs/mongoose`) |
| Authentication | JWT (access token 15 min, refresh token 7 days, `bcryptjs` hashing) |
| Authorization | `JwtAuthGuard` + `OptionalJwtAuthGuard` + `RolesGuard` via `@Roles()` decorator |
| Response envelope | `{ success: true, data: ... }` via `TransformInterceptor` |
| Error envelope | `{ success: false, statusCode, message, path }` via `HttpExceptionFilter` |
| API versioning | URI versioning, all routes under `/v1/` |
| Validation | `class-validator` + `class-transformer`, global `ValidationPipe` with `whitelist: true` |
| Documentation | Swagger (`@nestjs/swagger`), served at `/docs` |
| Background jobs | BullMQ + Redis |
| Email | Resend |
| Image hosting | Cloudinary |

---

## 2. Roles

**Assumption:** The existing `UserRole` type (`super_admin`, `merchandiser`, `support_agent`,
`customer`) was extended with a new `staff` role for production/ops personnel.

**Trade-off:** The User schema enum was updated to include `staff`. Existing Mongoose
documents with the old enum values are unaffected (Mongoose is permissive at the document
level). No migration is required, but the enum change in `user.schema.ts` should be
deployed before any staff accounts are created.

---

## 3. Measurement system

**Decision (from PRD §1.8):** Schema-driven, flexible measurement fields — NOT hardcoded
per garment type.

**Implementation:** `MeasurementProfile` stores a `measurements: MeasurementField[]` array
where each entry has `{ key, label, value }`. Any garment type can define any fields
without a schema migration.

**Validation:** Values must be `> 0` and `<= 400 cm`. The `@Min(1)` / `@Max(400)` DTO
decorators enforce this at the HTTP layer. `MeasurementProfileService.validateFields()` is
a static method that enforces the same rules programmatically, used as a second line of
defence when measurements are submitted inline with a custom order.

**Assumption:** All measurements are in centimetres. If the business later needs inches,
a `unit` field can be added to `MeasurementField` without a breaking change.

**Trade-off (extending vs fresh):** The existing `CategorySchema` does not have a `type`
field (`category` vs `section`). Rather than migrate the schema, the Labi seeder writes
a `type` field that Mongoose ignores by default (strict mode only throws if explicitly
set to `"throw"`). When the `CatalogModule` is updated for Labi, add
`@Prop({ type: String, default: 'category' }) type: string` to `CategorySchema`.

---

## 4. Custom orders

**Decision:** A separate `CustomOrder` collection with its own 9-stage lifecycle
(`pending_review → quoted → approved → payment_pending → paid → in_production →
completed → cancelled → refunded`).

**Rationale:** Custom orders have fundamentally different business rules from standard
catalog orders (admin quote, customer approval, no SKU/inventory decrement). Merging them
into the existing `Order` schema would complicate every query and introduce status enum
collisions.

**Business rules enforced in the service layer:**

1. `approveQuoteAndInitializePayment()` sets status to `payment_pending` and returns a
   checkout URL. Status becomes `paid` ONLY via `confirmPayment()`, which is called
   exclusively from the payment webhook handlers — never from the HTTP redirect.

2. `adminMarkInProduction()` throws `BadRequestException` unless `status === 'paid'`.
   This is the gate that prevents production starting before payment is confirmed.

3. A guest (no JWT) can submit a custom order if they provide `customerEmail` and
   `customerName` in the request body. These are validated at the service layer.

4. Inline measurements submitted with a custom order are validated by the same
   `MeasurementProfileService.validateFields()` static method used by the profile
   module — no duplication of validation logic.

**Trade-off:** Payment initialization for custom orders is handled inside
`CustomOrderService` (direct `fetch` calls) rather than delegating to `PaymentService`.
This avoids a circular dependency (`PaymentModule` imports `CustomOrderModule` which
would need to import `PaymentModule`). If the payment initialization logic grows, extract
it to a shared `PaymentInitializerService` that neither module owns.

---

## 5. Production tracking

**Decision (from PRD §1.8):** Simple, text-only stages. No photo/note logging for v1.

**Implementation:** Append-only `ProductionLog` collection. Each record captures
`(orderId, orderType, stage, updatedBy, timestamp)`. The current stage is always the
latest log entry — no mutable "current stage" field is updated in place.

**Forward-only enforcement:** `updateStage()` rejects any stage that is not strictly
ahead of the current stage in the `PRODUCTION_STAGE_ORDER` array. Skipping stages is
allowed (e.g. `cutting → ready` for in-stock items). Regression is blocked.

**Denormalized field:** `Order.productionStage` stores the current stage for fast reads
on the order detail page. The source of truth is the `production_logs` collection. When
`updateStage()` is called, the calling controller is responsible for also updating
`Order.productionStage` if desired for the standard catalog flow — this was intentionally
left as a controller concern so the `ProductionTrackingModule` has no dependency on
`OrderModule`.

**Trade-off:** The `ProductionLog` `orderId` field is a plain `string`, not a Mongoose
`ObjectId` reference. This allows it to point to either an `Order` or a `CustomOrder`
without a polymorphic reference, at the cost of no built-in referential integrity.

---

## 6. Payment webhook routing

**Decision:** The existing `PaymentService.handlePaystackWebhook()` and
`handleFlutterwaveWebhook()` were extended to route custom-order payment references
to `CustomOrderService.confirmPayment()`.

**Routing logic:** A payment reference is checked against `Order.paymentReference` first.
If that returns null, it's checked against `CustomOrder.paymentReference`. This two-step
lookup adds one extra DB query per webhook event (amortized cost is negligible at the
expected volume).

**Idempotency:** `CustomOrder.processedWebhookId` mirrors the pattern in `Order` —
if a webhook with the same `eventId` has already been processed, `confirmPayment()`
returns early without calling `save()`.

**Trade-off:** `PaymentModule` now imports `CustomOrderModule`. This creates a
one-way dependency that is fine at this scale. If the modules are ever split into
separate services, extract webhook routing into a dedicated `WebhookRouterService`.

---

## 7. WhatsApp integration

**Decision (from PRD §1.8):** Click-to-chat only at launch. No Business API.

**Implementation:** A `wa.me` link is generated at custom order submission time using
the `WHATSAPP_NUMBER` environment variable and stored on the `CustomOrder` document.
The link is returned in all custom order API responses and should be included in email
confirmations.

**Environment variable:** `WHATSAPP_NUMBER` — international format without `+`, e.g.
`2348012345678`. If not set, `whatsappLink` is `null` (graceful fallback).

**Path to upgrade:** When order volume makes manual status updates a burden, replace
the click-to-chat link with a BSP integration (360dialog or Twilio). Add BSP credentials
to `configuration.ts` under a `whatsapp.bsp` key and wire up a `WhatsAppService` that
calls the Business API. No existing data migration is needed.

---

## 8. Stripe

**Not built.** Stripe was explicitly deferred to Phase 2 per PRD §1.8 (requires a
foreign-registered entity for NGN payouts). The `PaymentProvider` type in `order.schema.ts`
currently allows `"paystack" | "flutterwave"`. To add Stripe later, extend this enum and
add a third branch in `PaymentService`.

---

## 9. Seeding

Two seed scripts exist:

| Script | Command | Description |
|---|---|---|
| `scripts/seed.ts` | `npm run seed` | Original Alphavista Electronics seed |
| `scripts/seed-labi.ts` | `npm run seed:labi` | Labi fashion categories, staff user, sample data |

Both scripts are idempotent (upsert throughout). Run `seed:labi` after `seed` on a fresh
database, or independently on a Labi-only deployment.

**Note on CategorySchema:** The Labi seeder writes a `type` field (`category` vs
`section`) to category documents. The existing `CategorySchema` does not declare this
field. Mongoose silently ignores it unless strict mode is set to `"throw"`. Add
`@Prop({ type: String, enum: ['category', 'section'], default: 'category' }) type: string`
to `CategorySchema` to make the field queryable.

---

## 10. Tests

All 88 tests are unit tests (no live DB or HTTP server required). The existing codebase
had zero test files — this implementation adds the first test suite.

Test files and the business rules they cover:

| File | Business rules |
|---|---|
| `payment.service.spec.ts` | BR-1: Webhook-gated order confirmation; HMAC signature validation for both gateways; duplicate webhook idempotency; custom-order routing via webhook |
| `custom-order.service.spec.ts` | BR-2: Custom order enters production only after paid webhook; BR-3: Guest submission without account |
| `inventory.service.spec.ts` | BR-4: Out-of-stock checkout blocking at API level; stock status reporting |
| `measurement-profile.service.spec.ts` | BR-5: Measurement value validation (zero, negative, > 400 cm rejected); duplicate key detection |
| `production-tracking.service.spec.ts` | Forward-only stage enforcement; stage skip allowed; regression blocked |

**Known gap:** There are no e2e tests (no live DB). The `@nestjs/testing` / `supertest`
integration test suite is the natural next step. The business-rule unit tests above are
the highest-value first pass; e2e tests would add coverage for the full HTTP stack
(guard enforcement, response envelope, Swagger shape).

---

## 11. Things not built (explicitly deferred)

| Item | Reason deferred | Path to add |
|---|---|---|
| Stripe payment gateway | Requires foreign entity for NGN payout | Extend `PaymentProvider` enum, add Stripe branch in `PaymentService` |
| WhatsApp Business API | Near-zero incremental order volume at launch | Add BSP config + `WhatsAppService`, wire into `NotificationsService` |
| Photo/note logging in production tracking | PRD §1.8: simple is better at v1 | Add `mediaUrls: string[]` and `note: string` to `ProductionLog`; admin UI to upload via existing `MediaModule` |
| Two-factor auth | Fields exist on User schema (`twoFactorEnabled`, `twoFactorSecret`) but no controller logic was found in the existing codebase | Implement TOTP in `AuthService`, add `POST /v1/auth/2fa/setup` and `POST /v1/auth/2fa/verify` |
| Custom order guest-to-user linking | When a guest who submitted a custom order later registers, their `customerId` remains null | Add a background job or a `POST /v1/custom-orders/claim` endpoint that links by email match |
| Email notifications for custom order events | `NotificationsService` only handles standard order emails | Add `sendCustomOrderQuote()`, `sendCustomOrderConfirmation()`, `sendProductionUpdate()` to `NotificationsService` |
| Meilisearch indexing for custom orders | Only standard `Product` documents are indexed | Add a `CustomOrderSearchService` or reuse existing `SearchModule` with a custom-orders index |
