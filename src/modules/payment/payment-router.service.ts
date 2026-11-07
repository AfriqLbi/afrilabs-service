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
 *   NGN  + paystack               → PaymentService.initializePaystack()
 *   NGN  + flutterwave / any      → PaymentService.initializeFlutterwave()
 *   non-NGN + paystack            → PaymentService.initializePaystack()  (multi-currency)
 *   non-NGN + Stripe live         → StripeService.createCheckoutSession()
 *   non-NGN + Stripe off          → PaymentService.initializeFlutterwave() (multi-currency)
 *   any other currency            → PaymentService.initializeFlutterwave() (multi-currency)
 *
 * Paystack supports multi-currency charging (USD, GBP, EUR, GHS, ZAR, KES,
 * etc.) via its international payments feature — the `currency` field in the
 * transaction initialisation payload is all that is needed.
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
   *                   For non-NGN orders the hint is overridden by currency routing.
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
      // Default NGN fallback: flutterwave
      return this.paymentService.initializeFlutterwave(order);
    }

    // ── Non-NGN orders ─────────────────────────────────────────────────────
    // Paystack handles multi-currency natively — honour the hint directly.
    if (provider === "paystack") {
      this.logger.log(
        `Routing ${order.orderNumber} (${currency}) to Paystack multi-currency`,
      );
      return this.paymentService.initializePaystack(order);
    }

    if (PaymentRouter.STRIPE_CURRENCIES.has(currency)) {
      if (stripeEnabled) {
        this.logger.log(`Routing ${order.orderNumber} (${currency}) to Stripe`);
        return this.stripeService.createCheckoutSession(order);
      }
      // Stripe not yet live — fall back to Flutterwave multi-currency
      this.logger.log(
        `Stripe disabled — routing ${order.orderNumber} (${currency}) to Flutterwave multi-currency`,
      );
      return this.paymentService.initializeFlutterwave(order);
    }

    // ── All other currencies (GHS, KES, ZAR, …): Flutterwave multi-currency
    this.logger.log(
      `Routing ${order.orderNumber} (${currency}) to Flutterwave multi-currency`,
    );
    return this.paymentService.initializeFlutterwave(order);
  }
}
