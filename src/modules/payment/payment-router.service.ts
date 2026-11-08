import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentService } from "./payment.service";
import { StripeService } from "./stripe.service";
import { OrderDocument } from "../order/schemas/order.schema";

/**
 * PaymentRouter — selects the correct payment gateway based on the order's
 * chargeCurrency and the requested provider hint.
 *
 * Routing table:
 *
 *   NGN               + paystack    → PaymentService.initializePaystack()
 *   NGN               + flutterwave → PaymentService.initializeFlutterwave()
 *   USD               + paystack    → PaymentService.initializePaystack()   (Paystack supports USD for NG businesses)
 *   GBP/EUR/CAD/other + paystack    → PaymentService.initializeFlutterwave() (Paystack does NOT support these)
 *   USD/GBP/EUR/CAD   + Stripe live → StripeService.createCheckoutSession()
 *   USD/GBP/EUR/CAD   + Stripe off  → PaymentService.initializeFlutterwave()
 *   any other currency              → PaymentService.initializeFlutterwave()
 *
 * Paystack currency support for Nigerian businesses: NGN and USD only.
 * GBP, EUR, CAD and all other currencies must go through Flutterwave.
 *
 * BUSINESS RULE: The webhook handler — not this router — confirms payment.
 * This method only creates a hosted checkout URL; it never marks an order paid.
 */
@Injectable()
export class PaymentRouter {
  private readonly logger = new Logger(PaymentRouter.name);

  /** Currencies routed to Stripe when STRIPE_ENABLED=true. */
  private static readonly STRIPE_CURRENCIES = new Set([
    "USD",
    "GBP",
    "EUR",
    "CAD",
  ]);

  /**
   * Currencies Paystack actually accepts for Nigerian businesses.
   * All other currencies must be handled by Flutterwave.
   */
  private static readonly PAYSTACK_CURRENCIES = new Set(["NGN", "USD"]);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns { checkoutUrl, reference } regardless of which gateway is used.
   *
   * @param order    - The persisted order document (must have chargeCurrency set)
   * @param provider - Client's requested provider hint ("paystack" | "flutterwave" | "stripe").
   *                   Ignored when the requested gateway doesn't support the order currency.
   */
  async initializePayment(
    order: OrderDocument,
    provider?: "paystack" | "flutterwave" | "stripe",
  ): Promise<{ checkoutUrl: string; reference: string }> {
    const currency = order.chargeCurrency ?? "NGN";
    const stripeEnabled = this.config.get<string>("stripe.enabled") === "true";

    // ── NGN orders: honour the provider hint ──────────────────────────────
    if (currency === "NGN") {
      if (provider === "paystack") {
        return this.paymentService.initializePaystack(order);
      }
      return this.paymentService.initializeFlutterwave(order);
    }

    // ── Non-NGN orders ─────────────────────────────────────────────────────

    // Paystack only supports NGN and USD for Nigerian businesses.
    // For any other currency (GBP, EUR, CAD, GHS, …) the Paystack hint
    // is silently overridden — route to Flutterwave or Stripe instead.
    if (provider === "paystack") {
      if (PaymentRouter.PAYSTACK_CURRENCIES.has(currency)) {
        this.logger.log(
          `Routing ${order.orderNumber} (${currency}) to Paystack`,
        );
        return this.paymentService.initializePaystack(order);
      }
      this.logger.warn(
        `Paystack does not support ${currency} — overriding to Flutterwave for ${order.orderNumber}`,
      );
      // Fall through to Stripe / Flutterwave routing below
    }

    if (PaymentRouter.STRIPE_CURRENCIES.has(currency)) {
      if (stripeEnabled) {
        this.logger.log(`Routing ${order.orderNumber} (${currency}) to Stripe`);
        return this.stripeService.createCheckoutSession(order);
      }
      this.logger.log(
        `Stripe disabled — routing ${order.orderNumber} (${currency}) to Flutterwave`,
      );
      return this.paymentService.initializeFlutterwave(order);
    }

    // All other currencies (GHS, KES, ZAR, …): Flutterwave multi-currency
    this.logger.log(
      `Routing ${order.orderNumber} (${currency}) to Flutterwave multi-currency`,
    );
    return this.paymentService.initializeFlutterwave(order);
  }
}
