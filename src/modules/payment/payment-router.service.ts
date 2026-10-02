import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentService } from "./payment.service";
import { StripeService } from "./stripe.service";
import { OrderDocument } from "../order/schemas/order.schema";

/**
 * PaymentRouter — selects the correct payment gateway based on the order's
 * chargeCurrency and the requested provider hint.
 *
 * Routing table (PRD §1.10.3 and Design §7):
 *
 *   NGN  + paystack               → PaymentService.initializePaystack()
 *   NGN  + flutterwave / any      → PaymentService.initializeFlutterwave()
 *   USD/GBP/EUR/CAD + Stripe live → StripeService.createCheckoutSession()
 *   USD/GBP/EUR/CAD + Stripe off  → PaymentService.initializeFlutterwave()  (multi-currency)
 *   any other currency             → PaymentService.initializeFlutterwave()  (multi-currency)
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
    const stripeEnabled =
      this.config.get<string>("stripe.enabled") === "true";

    // ── NGN orders: honour the provider hint ──────────────────────────────
    if (currency === "NGN") {
      if (provider === "paystack") {
        return this.paymentService.initializePaystack(order);
      }
      // Default NGN fallback: flutterwave
      return this.paymentService.initializeFlutterwave(order);
    }

    // ── Non-NGN orders: route by currency ─────────────────────────────────
    if (PaymentRouter.STRIPE_CURRENCIES.has(currency)) {
      if (stripeEnabled) {
        this.logger.log(
          `Routing ${order.orderNumber} (${currency}) to Stripe`,
        );
        return this.stripeService.createCheckoutSession(order);
      }
      // Stripe not yet live — use Flutterwave multi-currency as fallback
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
