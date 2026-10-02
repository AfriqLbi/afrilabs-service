/**
 * PaymentService — Unit Tests
 *
 * Critical business rule under test:
 *   BR-1: An order is only confirmed after a verified payment gateway webhook —
 *         never on the redirect alone.
 *
 * This means:
 *   (a) A valid Paystack webhook with a matching HMAC signature and event
 *       "charge.success" must call OrderService.markPaid().
 *   (b) An invalid HMAC signature must throw UnauthorizedException — the order
 *       status must never be updated.
 *   (c) A Flutterwave webhook with verif-hash mismatch must throw
 *       UnauthorizedException.
 *   (d) A duplicate webhook (already stored in webhook_events) is skipped
 *       idempotently — markPaid() is NOT called a second time.
 *
 * Additional rule under test:
 *   BR-2 (custom-order variant): Custom order confirmPayment() is called only
 *         via the webhook path — not from the approveQuote endpoint.
 */

import { UnauthorizedException } from "@nestjs/common";
import * as crypto from "crypto";
import { PaymentService } from "./payment.service";

// ─── Minimal mocks ─────────────────────────────────────────────────────────────

const mockWebhookModel = {
  findOne: jest
    .fn()
    .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  create: jest.fn(),
};

const mockOrderService = {
  findByReference: jest.fn(),
  markPaid: jest.fn(),
  markFailed: jest.fn(),
};

const mockInventoryService = {
  commitReservedStock: jest.fn(),
};

const mockCustomOrderService = {
  findByPaymentReference: jest.fn(),
  confirmPayment: jest.fn(),
  handlePaymentFailed: jest.fn(),
};

const PAYSTACK_SECRET = "test-paystack-webhook-secret";
const FLUTTERWAVE_SECRET = "test-flutterwave-secret-key";

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      "paystack.webhookSecret": PAYSTACK_SECRET,
      "flutterwave.secretKey": FLUTTERWAVE_SECRET,
    };
    return map[key] ?? "";
  }),
};

// ─── Factory ──────────────────────────────────────────────────────────────────

function buildService(): PaymentService {
  return new PaymentService(
    mockWebhookModel as any,
    mockOrderService as any,
    mockInventoryService as any,
    mockCustomOrderService as any,
    mockConfigService as any,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPaystackBody(eventType: string, reference: string, id = 12345) {
  return Buffer.from(
    JSON.stringify({
      event: eventType,
      data: { id, reference, status: "success" },
    }),
  );
}

function validPaystackSig(body: Buffer): string {
  return crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(body)
    .digest("hex");
}

function buildFlutterwaveBody(
  eventType: string,
  txRef: string,
  status: string,
  id = 99999,
) {
  return Buffer.from(
    JSON.stringify({
      event: eventType,
      data: { id, tx_ref: txRef, status },
    }),
  );
}

function validFlutterSig(body: Buffer): string {
  return crypto
    .createHmac("sha256", FLUTTERWAVE_SECRET)
    .update(body)
    .digest("hex");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PaymentService — Webhook signature verification (BR-1)", () => {
  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
    // Default: no duplicate webhook in store (chained .lean() returns null)
    mockWebhookModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    mockWebhookModel.create.mockResolvedValue({});
    // Default: no matching order or custom order
    mockOrderService.findByReference.mockResolvedValue(null);
    mockCustomOrderService.findByPaymentReference.mockResolvedValue(null);
  });

  // ── Paystack ───────────────────────────────────────────────────────────────

  describe("Paystack", () => {
    it("accepts a valid HMAC signature and processes the event", async () => {
      const body = buildPaystackBody("charge.success", "AV-2603-ZQPV2M");
      const sig = validPaystackSig(body);

      await service.handlePaystackWebhook(body, sig);

      // Webhook was stored — confirms it was processed, not rejected
      expect(mockWebhookModel.create).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid HMAC signature with UnauthorizedException", async () => {
      const body = buildPaystackBody("charge.success", "AV-2603-ZQPV2M");
      const badSig = "0".repeat(128); // wrong sig, same length

      await expect(service.handlePaystackWebhook(body, badSig)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("does NOT call markPaid when the signature is invalid", async () => {
      const body = buildPaystackBody("charge.success", "AV-2603-ZQPV2M");
      const badSig = "ff".repeat(64);

      await expect(service.handlePaystackWebhook(body, badSig)).rejects.toThrow(
        UnauthorizedException,
      );
      // BR-1 core assertion: markPaid must never be called on an invalid webhook
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it("calls markPaid on a matched standard order when webhook is valid (charge.success)", async () => {
      const order = {
        _id: { toString: () => "order-id-001" },
        items: [{ productId: "prod-001", qty: 1 }],
      };
      mockOrderService.findByReference.mockResolvedValue(order);

      const body = buildPaystackBody("charge.success", "AV-2601-REF");
      const sig = validPaystackSig(body);

      await service.handlePaystackWebhook(body, sig);

      expect(mockOrderService.markPaid).toHaveBeenCalledWith(
        "order-id-001",
        "paystack:12345",
      );
      expect(mockInventoryService.commitReservedStock).toHaveBeenCalledWith(
        "prod-001",
        1,
      );
    });

    it("calls markFailed on a matched order when webhook event is charge.failed", async () => {
      const order = { _id: { toString: () => "order-id-002" }, items: [] };
      mockOrderService.findByReference.mockResolvedValue(order);

      const body = buildPaystackBody("charge.failed", "AV-FAIL-REF");
      const sig = validPaystackSig(body);

      await service.handlePaystackWebhook(body, sig);

      expect(mockOrderService.markFailed).toHaveBeenCalledWith("order-id-002");
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it("skips processing a duplicate webhook idempotently (BR-1 -- no double confirmation)", async () => {
      // Simulate: webhook already processed
      mockWebhookModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ eventId: "paystack:12345" }),
      });

      const body = buildPaystackBody("charge.success", "AV-2603-ZQPV2M");
      const sig = validPaystackSig(body);

      await service.handlePaystackWebhook(body, sig);

      // markPaid must NOT be called on a duplicate
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
      expect(mockWebhookModel.create).not.toHaveBeenCalled();
    });

    it("routes a custom-order payment reference to CustomOrderService, not OrderService (BR-2)", async () => {
      // Standard order lookup returns null — this is a custom order reference
      mockOrderService.findByReference.mockResolvedValue(null);
      const customOrder = { _id: { toString: () => "co-id-001" } };
      mockCustomOrderService.findByPaymentReference.mockResolvedValue(
        customOrder,
      );

      const body = buildPaystackBody("charge.success", "CO-1001-SEED-PAY");
      const sig = validPaystackSig(body);

      await service.handlePaystackWebhook(body, sig);

      // BR-2 core assertion: custom order confirmed via webhook — never via redirect
      expect(mockCustomOrderService.confirmPayment).toHaveBeenCalledWith(
        "CO-1001-SEED-PAY",
        "paystack:12345",
      );
      // Standard order path must NOT be called
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });
  });

  // ── Flutterwave ────────────────────────────────────────────────────────────

  describe("Flutterwave", () => {
    it("accepts a valid signature and processes the event", async () => {
      const body = buildFlutterwaveBody(
        "charge.completed",
        "AV-2602-LWMN4Q",
        "successful",
      );
      const sig = validFlutterSig(body);

      await service.handleFlutterwaveWebhook(body, sig);

      expect(mockWebhookModel.create).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid signature with UnauthorizedException", async () => {
      const body = buildFlutterwaveBody(
        "charge.completed",
        "AV-2602-LWMN4Q",
        "successful",
      );
      const badSig = "invalid-signature";

      await expect(
        service.handleFlutterwaveWebhook(body, badSig),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("does NOT call markPaid when the Flutterwave signature is invalid", async () => {
      const body = buildFlutterwaveBody(
        "charge.completed",
        "AV-2602-LWMN4Q",
        "successful",
      );
      const badSig = "bad-sig";

      await expect(
        service.handleFlutterwaveWebhook(body, badSig),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it("calls markPaid for a matched order on a successful Flutterwave event", async () => {
      const order = {
        _id: { toString: () => "order-id-fw-001" },
        items: [{ productId: "prod-fw-001", qty: 2 }],
      };
      mockOrderService.findByReference.mockResolvedValue(order);

      const body = buildFlutterwaveBody(
        "charge.completed",
        "AV-FW-REF",
        "successful",
      );
      const sig = validFlutterSig(body);

      await service.handleFlutterwaveWebhook(body, sig);

      expect(mockOrderService.markPaid).toHaveBeenCalledWith(
        "order-id-fw-001",
        "flutterwave:99999",
      );
      expect(mockInventoryService.commitReservedStock).toHaveBeenCalledWith(
        "prod-fw-001",
        2,
      );
    });

    it("skips a duplicate Flutterwave webhook idempotently", async () => {
      mockWebhookModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ eventId: "flutterwave:99999" }),
      });

      const body = buildFlutterwaveBody(
        "charge.completed",
        "AV-FW-DUP",
        "successful",
      );
      const sig = validFlutterSig(body);

      await service.handleFlutterwaveWebhook(body, sig);

      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it("routes a custom-order Flutterwave payment to CustomOrderService", async () => {
      mockOrderService.findByReference.mockResolvedValue(null);
      const customOrder = { _id: { toString: () => "co-id-fw-001" } };
      mockCustomOrderService.findByPaymentReference.mockResolvedValue(
        customOrder,
      );

      const body = buildFlutterwaveBody(
        "charge.completed",
        "CO-1003-FW-PAY",
        "successful",
      );
      const sig = validFlutterSig(body);

      await service.handleFlutterwaveWebhook(body, sig);

      expect(mockCustomOrderService.confirmPayment).toHaveBeenCalledWith(
        "CO-1003-FW-PAY",
        "flutterwave:99999",
      );
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });
  });
});
