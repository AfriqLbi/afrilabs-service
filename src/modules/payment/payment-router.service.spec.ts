/**
 * PaymentRouter — Unit Tests
 *
 * Covers all 5 routing branches (Design Property 4):
 *   NGN + paystack           → PaymentService.initializePaystack()
 *   NGN + flutterwave        → PaymentService.initializeFlutterwave()
 *   USD + Stripe enabled     → StripeService.createCheckoutSession()
 *   USD + Stripe disabled    → PaymentService.initializeFlutterwave()
 *   GHS (other currency)     → PaymentService.initializeFlutterwave()
 *
 * Property 4: PaymentRouter always returns { checkoutUrl, reference }
 * regardless of which branch fires.
 */

import { PaymentRouter } from "./payment-router.service";
import { OrderDocument } from "../order/schemas/order.schema";
import { Types } from "mongoose";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const CHECKOUT_URL = "https://checkout.example.com/pay";
const REFERENCE    = "AV-2601-ABCDEF";

const mockPaymentService = {
  initializePaystack:    jest.fn().mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
  initializeFlutterwave: jest.fn().mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
};

const mockStripeService = {
  createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
};

function mockConfig(stripeEnabled: string) {
  return { get: jest.fn().mockReturnValue(stripeEnabled) };
}

function makeOrder(chargeCurrency: string, provider: string = "paystack"): OrderDocument {
  return {
    _id: new Types.ObjectId(),
    chargeCurrency,
    chargeTotal: 100_00,
    paymentProvider: provider,
    paymentReference: REFERENCE,
    orderNumber: "AV-2601",
    customerEmail: "test@labi.ng",
  } as unknown as OrderDocument;
}

function buildRouter(stripeEnabled: boolean): PaymentRouter {
  return new PaymentRouter(
    mockPaymentService as any,
    mockStripeService as any,
    mockConfig(stripeEnabled ? "true" : "false") as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PaymentRouter.initializePayment() — all branches (Design Property 4)", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Branch 1: NGN + paystack ──────────────────────────────────────────────

  it("routes NGN + paystack → initializePaystack()", async () => {
    const router = buildRouter(false);
    const order  = makeOrder("NGN", "paystack");

    const result = await router.initializePayment(order, "paystack");

    expect(mockPaymentService.initializePaystack).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 2: NGN + flutterwave ───────────────────────────────────────────

  it("routes NGN + flutterwave → initializeFlutterwave()", async () => {
    const router = buildRouter(false);
    const order  = makeOrder("NGN", "flutterwave");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 3: USD + Stripe enabled → Stripe ───────────────────────────────

  it("routes USD + STRIPE_ENABLED=true → StripeService.createCheckoutSession()", async () => {
    const router = buildRouter(true);
    const order  = makeOrder("USD", "stripe");

    const result = await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
    expect(result.checkoutUrl).toBeTruthy(); // Property 4 core assertion
  });

  it("also routes GBP + STRIPE_ENABLED=true → Stripe", async () => {
    const router = buildRouter(true);
    const order  = makeOrder("GBP", "stripe");

    await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
  });

  it("also routes EUR + STRIPE_ENABLED=true → Stripe", async () => {
    const router = buildRouter(true);
    const order  = makeOrder("EUR", "stripe");

    await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
  });

  // ── Branch 4: USD + Stripe disabled → Flutterwave multi-currency ──────────

  it("routes USD + STRIPE_ENABLED=false → initializeFlutterwave() as fallback", async () => {
    const router = buildRouter(false);
    const order  = makeOrder("USD");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(order);
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 5: Other currency (GHS) → Flutterwave multi-currency ──────────

  it("routes GHS (other currency) → initializeFlutterwave() regardless of Stripe flag", async () => {
    const router = buildRouter(true); // Stripe enabled but GHS not in Stripe currencies
    const order  = makeOrder("GHS");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(order);
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  it("routes KES → initializeFlutterwave()", async () => {
    const router = buildRouter(false);
    const order  = makeOrder("KES");
    await router.initializePayment(order);
    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(order);
  });

  // ── Property 4: always returns { checkoutUrl, reference } ─────────────────

  it("(Property 4) always returns a non-empty checkoutUrl for any valid order", async () => {
    const currencies = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"];
    const router     = buildRouter(true);

    for (const currency of currencies) {
      jest.clearAllMocks();
      mockPaymentService.initializePaystack.mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
      mockPaymentService.initializeFlutterwave.mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
      mockStripeService.createCheckoutSession.mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });

      const order  = makeOrder(currency);
      const result = await router.initializePayment(order, currency === "NGN" ? "paystack" : "stripe");

      expect(result.checkoutUrl).toBeTruthy();
      expect(typeof result.checkoutUrl).toBe("string");
      expect(result.checkoutUrl.length).toBeGreaterThan(0);
    }
  });

  // ── Gateway error propagation ─────────────────────────────────────────────

  it("propagates gateway errors without swallowing them", async () => {
    const router = buildRouter(false);
    const order  = makeOrder("NGN", "paystack");
    mockPaymentService.initializePaystack.mockRejectedValue(new Error("Paystack is down"));

    await expect(router.initializePayment(order, "paystack")).rejects.toThrow("Paystack is down");
  });
});
