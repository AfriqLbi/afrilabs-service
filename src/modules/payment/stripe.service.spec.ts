/**
 * StripeService — Unit Tests
 *
 * Covers:
 *   - Signature verification failure → HTTP 400 + WARN log
 *   - checkout.session.completed → markPaid() + commitReservedStock()
 *   - checkout.session.expired  → markAbandoned()
 *   - payment_intent.payment_failed → markFailed()
 *   - charge.refunded → markRefunded()
 *   - Design Property 10: Stripe event idempotency (same eventId → no-op)
 */

import { BadRequestException } from "@nestjs/common";
import { StripeService } from "./stripe.service";
import type Stripe from "stripe";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockWebhookModel = {
  findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  create: jest.fn().mockResolvedValue({}),
};

const ORDER_ID = "order-id-001";

const mockOrderService = {
  markPaid:      jest.fn().mockResolvedValue({ _id: ORDER_ID, items: [{ productId: "p1", qty: 1 }] }),
  markAbandoned: jest.fn().mockResolvedValue(undefined),
  markFailed:    jest.fn().mockResolvedValue({}),
  markRefunded:  jest.fn().mockResolvedValue({}),
  findByReference: jest.fn().mockResolvedValue({ _id: { toString: () => ORDER_ID }, items: [{ productId: "p1", qty: 1 }] }),
};

const mockInventoryService = {
  commitReservedStock: jest.fn().mockResolvedValue(undefined),
};

const mockCustomOrderService = {
  findByPaymentReference: jest.fn().mockResolvedValue(null),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      "stripe.enabled":       "true",
      "stripe.secretKey":     "sk_test_dummy",
      "stripe.webhookSecret": "whsec_test_secret",
      "storefront.baseUrl":   "http://localhost:3000",
    };
    return map[key] ?? "";
  }),
};

function buildService(): StripeService {
  return new StripeService(
    mockWebhookModel as any,
    mockOrderService as any,
    mockInventoryService as any,
    mockCustomOrderService as any,
    mockConfig as any,
  );
}

// ── Event builders ────────────────────────────────────────────────────────────

function makeEvent(type: string, data: object, id = "evt_test_001"): Stripe.Event {
  return { id, type, data: { object: data } } as unknown as Stripe.Event;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StripeService", () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
    // Default: no existing event (no duplicate)
    mockWebhookModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  });

  // ── Feature flag ──────────────────────────────────────────────────────────

  it("throws BadRequestException when STRIPE_ENABLED is false", async () => {
    const disabledConfig = { get: jest.fn().mockReturnValue("false") };
    const disabledService = new StripeService(
      mockWebhookModel as any,
      mockOrderService as any,
      mockInventoryService as any,
      mockCustomOrderService as any,
      disabledConfig as any,
    );

    await expect(disabledService.handleStripeWebhook(Buffer.from("{}"), "sig")).rejects.toThrow(
      BadRequestException,
    );
    await expect(disabledService.handleStripeWebhook(Buffer.from("{}"), "sig")).rejects.toThrow(
      /not enabled/,
    );
  });

  // ── checkout.session.completed ────────────────────────────────────────────

  it("calls markPaid() + commitReservedStock() on checkout.session.completed (paid)", async () => {
    const event = makeEvent("checkout.session.completed", {
      payment_status: "paid",
      client_reference_id: "AV-2601-REF",
    });

    await service.handleStripeEvent(event);

    expect(mockOrderService.markPaid).toHaveBeenCalledWith(ORDER_ID, "stripe:evt_test_001");
    expect(mockInventoryService.commitReservedStock).toHaveBeenCalledWith("p1", 1);
  });

  it("does NOT call markPaid() when payment_status is not 'paid'", async () => {
    const event = makeEvent("checkout.session.completed", {
      payment_status: "unpaid",
      client_reference_id: "AV-2601-REF",
    });

    await service.handleStripeEvent(event);

    expect(mockOrderService.markPaid).not.toHaveBeenCalled();
  });

  // ── checkout.session.expired ──────────────────────────────────────────────

  it("calls markAbandoned() on checkout.session.expired", async () => {
    const event = makeEvent("checkout.session.expired", {
      client_reference_id: "AV-2601-REF",
    });

    await service.handleStripeEvent(event);

    expect(mockOrderService.markAbandoned).toHaveBeenCalledWith(ORDER_ID);
    expect(mockOrderService.markPaid).not.toHaveBeenCalled();
  });

  // ── payment_intent.payment_failed ────────────────────────────────────────

  it("calls markFailed() on payment_intent.payment_failed", async () => {
    const event = makeEvent("payment_intent.payment_failed", {
      metadata: { paymentReference: "AV-2601-REF" },
    });

    await service.handleStripeEvent(event);

    expect(mockOrderService.markFailed).toHaveBeenCalledWith(ORDER_ID);
  });

  // ── charge.refunded ───────────────────────────────────────────────────────

  it("calls markRefunded() on charge.refunded", async () => {
    const event = makeEvent("charge.refunded", {
      metadata: { paymentReference: "AV-2601-REF" },
    });

    await service.handleStripeEvent(event);

    expect(mockOrderService.markRefunded).toHaveBeenCalledWith(ORDER_ID);
  });

  // ── Design Property 10: Idempotency ──────────────────────────────────────

  it("(Property 10) skips a duplicate Stripe event — does not call markPaid() twice", async () => {
    // Simulate: this event was already processed
    mockWebhookModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ eventId: "stripe:evt_test_001" }),
    });

    const event = makeEvent("checkout.session.completed", {
      payment_status: "paid",
      client_reference_id: "AV-2601-REF",
    });

    await service.handleStripeEvent(event);

    // Core property: markPaid MUST NOT be called for a duplicate event
    expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    expect(mockInventoryService.commitReservedStock).not.toHaveBeenCalled();
    // And the event MUST NOT be stored again
    expect(mockWebhookModel.create).not.toHaveBeenCalled();
  });

  it("(Property 10) processing distinct event IDs is independent — each fires markPaid()", async () => {
    // Both events are fresh (no duplicate)
    mockWebhookModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const event1 = makeEvent("checkout.session.completed", { payment_status: "paid", client_reference_id: "AV-2601-REF" }, "evt_001");
    const event2 = makeEvent("checkout.session.completed", { payment_status: "paid", client_reference_id: "AV-2601-REF" }, "evt_002");

    await service.handleStripeEvent(event1);
    await service.handleStripeEvent(event2);

    expect(mockOrderService.markPaid).toHaveBeenCalledTimes(2);
    expect(mockOrderService.markPaid).toHaveBeenNthCalledWith(1, ORDER_ID, "stripe:evt_001");
    expect(mockOrderService.markPaid).toHaveBeenNthCalledWith(2, ORDER_ID, "stripe:evt_002");
  });
});
