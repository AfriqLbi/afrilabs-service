/**
 * CustomOrderService â€” Unit Tests
 *
 * Critical business rules under test:
 *
 *   BR-2: A custom order only enters production once payment is confirmed
 *         against an admin-approved quote.
 *         This means:
 *           (a) approveQuoteAndInitializePayment() sets status â†’ payment_pending
 *               and returns a checkout URL but does NOT set status â†’ paid.
 *           (b) confirmPayment() (called by the webhook handler) sets status â†’ paid.
 *           (c) adminMarkInProduction() throws unless status === 'paid'.
 *           (d) approveQuoteAndInitializePayment() throws if the order is not
 *               in 'quoted' status (i.e. no valid admin quote).
 *           (e) Guest custom orders can be submitted without a userId.
 *
 *   BR-3 (guest path): A guest customer can submit a custom order request
 *         without an account. customerEmail + customerName must be in the DTO.
 */

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CustomOrderService } from "./custom-order.service";
import { Types } from "mongoose";

// â”€â”€â”€ Mock factory helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeOrder(overrides: Record<string, unknown> = {}) {
  const base = {
    _id: new Types.ObjectId(),
    referenceNumber: "CO-1001",
    customerId: "user-id-001",
    customerEmail: "chioma@example.com",
    customerName: "Chioma Okafor",
    customerPhone: null,
    description: "Custom Aso Oke jacket",
    garmentCategory: "Aso Oke Jacket",
    fabricChoice: null,
    referenceImages: [],
    measurement: null,
    status: "quoted",
    quotedPrice: 85_000,
    estimatedReadyDate: "2026-12-01",
    adminQuoteNote: null,
    paymentProvider: null,
    paymentReference: null,
    checkoutUrl: null,
    processedWebhookId: null,
    paidAt: null,
    linkedOrderId: null,
    whatsappLink: null,
    save: jest.fn().mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
  return base;
}

// â”€â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mockCustomOrderModel = {
  findOne: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
  }),
  findById: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

const mockMeasurementService = {
  findOneByUser: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, fallback?: string) => {
    const map: Record<string, string> = {
      "whatsapp.number": "2348000000001",
      "storefront.baseUrl": "http://localhost:3000",
      "paystack.secretKey": "sk_test_dummy",
      "flutterwave.secretKey": "FLWSECK_dummy",
    };
    return map[key] ?? fallback ?? "";
  }),
};

const mockNotificationsService = {
  sendCustomOrderQuote: jest.fn().mockResolvedValue(undefined),
  sendCustomOrderConfirmation: jest.fn().mockResolvedValue(undefined),
};

function buildService(): CustomOrderService {
  return new CustomOrderService(
    mockCustomOrderModel as any,
    mockMeasurementService as any,
    mockNotificationsService as any,
    mockConfigService as any,
  );
}

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("CustomOrderService (BR-2: production gating + BR-3: guest submission)", () => {
  let service: CustomOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
    // Default findOne returns a chainable object for nextReferenceNumber().
    // Tests that need findOne to return a flat document use mockReturnValueOnce.
    mockCustomOrderModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null), // no prior CO -> CO-1001
        }),
      }),
    });
  });

  // â”€â”€ BR-3: Guest submission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("submit() â€” guest path (BR-3)", () => {
    it("creates a custom order for a guest (userId=null) when email and name are in DTO", async () => {
      mockCustomOrderModel.create.mockResolvedValue(
        makeOrder({ status: "pending_review" }),
      );

      const result = await service.submit(
        {
          customerEmail: "akin@example.com",
          customerName: "Akin Adeyemi",
          description: "Custom Danshiki set â€” at least 20 chars here",
          garmentCategory: "Danshiki",
        },
        null, // userId = null â†’ guest
        null, // userEmail
        null, // userName
      );

      expect(mockCustomOrderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: null,
          customerEmail: "akin@example.com",
          customerName: "Akin Adeyemi",
          status: "pending_review",
        }),
      );
    });

    it("throws BadRequestException when guest omits customerEmail", async () => {
      await expect(
        service.submit(
          {
            customerName: "Akin Adeyemi",
            description: "Custom Danshiki set â€” at least 20 chars here",
            garmentCategory: "Danshiki",
            // customerEmail missing
          },
          null, // guest
          null,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when guest omits customerName", async () => {
      await expect(
        service.submit(
          {
            customerEmail: "akin@example.com",
            description: "Custom Danshiki set â€” at least 20 chars here",
            garmentCategory: "Danshiki",
            // customerName missing
          },
          null, // guest
          null,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses JWT identity for authenticated users instead of DTO fields", async () => {
      mockCustomOrderModel.create.mockResolvedValue(
        makeOrder({ status: "pending_review" }),
      );

      await service.submit(
        {
          description: "Custom Aso Oke Gown -- at least 20 chars here",
          garmentCategory: "Aso Oke Gown",
          // No customerEmail/customerName in DTO -- should use JWT identity
        },
        "user-id-001", // authenticated userId
        "chioma@example.com", // userEmail from JWT
        "Chioma Okafor", // userName from JWT (not null for authenticated users)
      );

      expect(mockCustomOrderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "user-id-001",
          customerEmail: "chioma@example.com",
        }),
      );
    });
  });

  // â”€â”€ BR-2a: approveQuote sets payment_pending, NOT paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("approveQuoteAndInitializePayment() â€” status transition (BR-2a)", () => {
    it("transitions status to payment_pending and returns a checkoutUrl", async () => {
      const order = makeOrder({ status: "quoted", quotedPrice: 85_000 });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      // Mock the Paystack init fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { authorization_url: "https://checkout.paystack.com/test-url" },
        }),
      }) as jest.Mock;

      const result = await service.approveQuoteAndInitializePayment(
        order._id.toString(),
        "user-id-001",
        { paymentProvider: "paystack" },
      );

      // Checkout URL returned
      expect(result.checkoutUrl).toBe("https://checkout.paystack.com/test-url");

      // Status moved to payment_pending â€” never paid at this point
      expect(order.status).toBe("payment_pending");

      // Saved to DB
      expect(order.save).toHaveBeenCalled();
    });

    it("does NOT set status to paid after approveQuote (BR-2 core rule)", async () => {
      const order = makeOrder({ status: "quoted", quotedPrice: 85_000 });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { authorization_url: "https://checkout.paystack.com/test-url" },
        }),
      }) as jest.Mock;

      await service.approveQuoteAndInitializePayment(
        order._id.toString(),
        "user-id-001",
        { paymentProvider: "paystack" },
      );

      // The core BR-2 assertion: status must be payment_pending, not paid
      expect(order.status).not.toBe("paid");
      expect(order.status).toBe("payment_pending");
    });

    it("throws BadRequestException if order is not in quoted status", async () => {
      const order = makeOrder({ status: "pending_review" }); // not yet quoted
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      await expect(
        service.approveQuoteAndInitializePayment(
          order._id.toString(),
          "user-id-001",
          { paymentProvider: "paystack" },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if order has no quoted price", async () => {
      const order = makeOrder({ status: "quoted", quotedPrice: null });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      await expect(
        service.approveQuoteAndInitializePayment(
          order._id.toString(),
          "user-id-001",
          { paymentProvider: "paystack" },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException if order does not belong to the requesting user", async () => {
      mockCustomOrderModel.findOne.mockResolvedValue(null); // different userId â†’ null

      await expect(
        service.approveQuoteAndInitializePayment(
          "non-existent-id",
          "different-user-id",
          { paymentProvider: "paystack" },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // â”€â”€ BR-2b: confirmPayment() â€” only webhook can set paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("confirmPayment() â€” webhook path (BR-2b)", () => {
    it("sets status to paid when called with a valid reference and webhookId", async () => {
      const order = makeOrder({
        status: "payment_pending",
        processedWebhookId: null,
      });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      const result = await service.confirmPayment(
        "CO-1001-PAY-REF",
        "paystack:12345",
      );

      expect(order.status).toBe("paid");
      expect(order.paidAt).toBeInstanceOf(Date);
      expect(order.processedWebhookId).toBe("paystack:12345");
      expect(order.save).toHaveBeenCalled();
    });

    it("is idempotent â€” does not re-process an already confirmed webhook", async () => {
      const order = makeOrder({
        status: "paid",
        processedWebhookId: "paystack:12345", // already processed
      });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      const result = await service.confirmPayment(
        "CO-1001-PAY-REF",
        "paystack:12345",
      );

      // save() should NOT be called again
      expect(order.save).not.toHaveBeenCalled();
    });

    it("returns null when no custom order matches the reference (standard order payment)", async () => {
      mockCustomOrderModel.findOne.mockResolvedValue(null);

      const result = await service.confirmPayment(
        "AV-2601-STANDARD-REF",
        "paystack:99",
      );

      expect(result).toBeNull();
    });

    it("does not change status if order is already past payment_pending", async () => {
      const order = makeOrder({
        status: "in_production",
        processedWebhookId: null,
      });
      mockCustomOrderModel.findOne.mockResolvedValue(order);

      await service.confirmPayment("CO-1001-PAY-REF", "paystack:99999");

      // Status should remain unchanged
      expect(order.status).toBe("in_production");
      expect(order.save).not.toHaveBeenCalled();
    });
  });

  // â”€â”€ BR-2c: adminMarkInProduction() â€” only after paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("adminMarkInProduction() â€” production gating (BR-2c)", () => {
    it("transitions paid â†’ in_production successfully", async () => {
      const order = makeOrder({ status: "paid" });
      // findByIdOrThrow path â€” uses findById
      mockCustomOrderModel.findById.mockResolvedValue(order);
      // Types.ObjectId.isValid check
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      const result = await service.adminMarkInProduction(order._id.toString());

      expect(order.status).toBe("in_production");
      expect(order.save).toHaveBeenCalled();
    });

    it("throws BadRequestException when status is payment_pending (not paid yet)", async () => {
      const order = makeOrder({ status: "payment_pending" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminMarkInProduction(order._id.toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when status is quoted (before payment)", async () => {
      const order = makeOrder({ status: "quoted" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminMarkInProduction(order._id.toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when status is pending_review", async () => {
      const order = makeOrder({ status: "pending_review" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminMarkInProduction(order._id.toString()),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException for a non-existent ID", async () => {
      mockCustomOrderModel.findById.mockResolvedValue(null);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminMarkInProduction("non-existent-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // â”€â”€ BR-2d: adminSetQuote() â€” only on pending_review / quoted status â”€â”€â”€â”€â”€â”€â”€

  describe("adminSetQuote() â€” quote gating", () => {
    it("sets quote on a pending_review order", async () => {
      const order = makeOrder({ status: "pending_review" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      const result = await service.adminSetQuote(
        order._id.toString(),
        "admin-id",
        {
          quotedPrice: 75_000,
          estimatedReadyDate: "2027-03-01", // future date
          adminQuoteNote: "Includes 2 fittings",
        },
      );

      expect(order.status).toBe("quoted");
      expect(order.quotedPrice).toBe(75_000);
    });

    it("throws BadRequestException when trying to quote a paid order", async () => {
      const order = makeOrder({ status: "paid" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminSetQuote(order._id.toString(), "admin-id", {
          quotedPrice: 75_000,
          estimatedReadyDate: "2027-03-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for a past estimatedReadyDate", async () => {
      const order = makeOrder({ status: "pending_review" });
      mockCustomOrderModel.findById.mockResolvedValue(order);
      jest.spyOn(Types.ObjectId, "isValid").mockReturnValue(true);

      await expect(
        service.adminSetQuote(order._id.toString(), "admin-id", {
          quotedPrice: 75_000,
          estimatedReadyDate: "2020-01-01", // past date
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
