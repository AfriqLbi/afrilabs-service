/**
 * PaymentRouter — Unit Tests
 *
 * Covers all routing branches (Design Property 4):
 *   NGN + paystack           → PaymentService.initializePaystack()
 *   NGN + flutterwave        → PaymentService.initializeFlutterwave()
 *   non-NGN + paystack        → PaymentService.initializePaystack()  (multi-currency)
 *   non-NGN + Stripe enabled  → StripeService.createCheckoutSession()
 *   non-NGN + Stripe disabled → PaymentService.initializeFlutterwave() (multi-currency)
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
const REFERENCE = "AV-2601-ABCDEF";

const mockPaymentService = {
  initializePaystack: jest
    .fn()
    .mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
  initializeFlutterwave: jest
    .fn()
    .mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
};

const mockStripeService = {
  createCheckoutSession: jest
    .fn()
    .mockResolvedValue({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE }),
};

function mockConfig(stripeEnabled: boolean) {
  return {
    get: jest.fn((key: string) => {
      if (key === "stripe.enabled") return stripeEnabled ? "true" : "false";
      if (key === "payment.chargeCurrencies") return ["NGN", "USD"];
      if (key === "payment.chargeFallbackCurrency") return "USD";
      return stripeEnabled ? "true" : "false";
    }),
  };
}

function makeOrder(
  chargeCurrency: string,
  provider: string = "paystack",
): OrderDocument {
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
    mockConfig(stripeEnabled) as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PaymentRouter.initializePayment() — all branches (Design Property 4)", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Branch 1: NGN + paystack ──────────────────────────────────────────────

  it("routes NGN + paystack → initializePaystack()", async () => {
    const router = buildRouter(false);
    const order = makeOrder("NGN", "paystack");

    const result = await router.initializePayment(order, "paystack");

    expect(mockPaymentService.initializePaystack).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 2: NGN + flutterwave ───────────────────────────────────────────

  it("routes NGN + flutterwave → initializeFlutterwave()", async () => {
    const router = buildRouter(false);
    const order = makeOrder("NGN", "flutterwave");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(
      order,
    );
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 3: USD + Stripe enabled → Stripe ───────────────────────────────

  it("routes USD + STRIPE_ENABLED=true → StripeService.createCheckoutSession()", async () => {
    const router = buildRouter(true);
    const order = makeOrder("USD", "stripe");

    const result = await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
    expect(result.checkoutUrl).toBeTruthy(); // Property 4 core assertion
  });

  it("also routes GBP + STRIPE_ENABLED=true → Stripe", async () => {
    const router = buildRouter(true);
    const order = makeOrder("GBP", "stripe");

    await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
  });

  it("also routes EUR + STRIPE_ENABLED=true → Stripe", async () => {
    const router = buildRouter(true);
    const order = makeOrder("EUR", "stripe");

    await router.initializePayment(order, "stripe");

    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
  });

  // ── Branch 4: USD + Stripe disabled → Flutterwave multi-currency ──────────

  it("routes USD + STRIPE_ENABLED=false → initializeFlutterwave() as fallback", async () => {
    const router = buildRouter(false);
    const order = makeOrder("USD");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(
      order,
    );
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  // ── Branch 5: Other currency (GHS) → Flutterwave multi-currency ──────────

  it("routes GHS (other currency) → initializeFlutterwave() regardless of Stripe flag", async () => {
    const router = buildRouter(true); // Stripe enabled but GHS not in Stripe currencies
    const order = makeOrder("GHS");

    const result = await router.initializePayment(order, "flutterwave");

    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(
      order,
    );
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });

  it("routes KES → initializeFlutterwave()", async () => {
    const router = buildRouter(false);
    const order = makeOrder("KES");
    await router.initializePayment(order);
    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(
      order,
    );
  });

  // ── Branch 6: Non-NGN + paystack → Paystack multi-currency ────────────────

  it("routes USD + paystack → initializePaystack() (multi-currency)", async () => {
    const router = buildRouter(true);
    const order = makeOrder("USD", "paystack");

    const result = await router.initializePayment(order, "paystack");

    expect(mockPaymentService.initializePaystack).toHaveBeenCalledWith(order);
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
    expect(result).toEqual({ checkoutUrl: CHECKOUT_URL, reference: REFERENCE });
  });
  it("routes GBP + paystack -> Stripe when Stripe is enabled (Paystack does not support GBP)", async () => {
    const router = buildRouter(true);
    const order = makeOrder("GBP", "paystack");

    await router.initializePayment(order, "paystack");

    // GBP not in PAYSTACK_CURRENCIES, falls through to Stripe (enabled, GBP is a Stripe currency)
    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(order);
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(mockPaymentService.initializeFlutterwave).not.toHaveBeenCalled();
  });

  it("routes GBP + paystack -> Flutterwave when Stripe is disabled (Paystack does not support GBP)", async () => {
    const router = buildRouter(false);
    const order = makeOrder("GBP", "paystack");

    await router.initializePayment(order, "paystack");

    // GBP not in PAYSTACK_CURRENCIES, falls through to Flutterwave (Stripe disabled)
    expect(mockPaymentService.initializeFlutterwave).toHaveBeenCalledWith(
      order,
    );
    expect(mockPaymentService.initializePaystack).not.toHaveBeenCalled();
    expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
  });
});
