import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { OrderDocument } from "../order/schemas/order.schema";
import { CustomOrderDocument } from "../custom-order/schemas/custom-order.schema";

// ─── Price formatting ─────────────────────────────────────────────────────────

/**
 * Format an amount in the minor unit of a currency (kobo for NGN, cents for USD, etc.)
 * into a human-readable string.
 *
 * Special case: NGN is stored in naira (not kobo) throughout the orders collection,
 * so we pass it through directly.
 */
function fmtMinor(amountMinor: number, currency: string): string {
  // For NGN we store naira (not kobo), so no division needed.
  // For all other ISO currencies, amounts are already in major units
  // (chargeTotal / 100 has already been done by the caller where needed).
  const fmt = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "NGN" ? 0 : 2,
    maximumFractionDigits: currency === "NGN" ? 0 : 2,
  });
  return fmt.format(amountMinor);
}

/**
 * Format an NGN amount (plain naira, not kobo) for display.
 */
function fmtNGN(naira: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(naira);
}

/**
 * Format an order's total for customer-facing display.
 * For multi-currency orders shows the charge currency amount;
 * for NGN orders shows the naira total.
 */
function fmtOrderTotal(order: OrderDocument): string {
  if (
    order.chargeTotal != null &&
    order.chargeCurrency &&
    order.chargeCurrency !== "NGN"
  ) {
    // chargeTotal is in minor units (e.g. cents). Divide by 100 for major units.
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: order.chargeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(order.chargeTotal / 100);
  }
  return fmtNGN(order.total);
}

// ─── HTML layout primitives ───────────────────────────────────────────────────

const LOGO_URL = "https://labiafrica.com/icon-512.png";

/** Full email shell: dark background, gold wordmark with inline logo image. */
function labiShell(content: string, storefrontUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>LABI</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'DM Sans',Arial,sans-serif;color:#e8e8e8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#111111;border:1px solid #222;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #222;text-align:center;">
              <a href="${storefrontUrl}" style="text-decoration:none;">
                <img src="${LOGO_URL}" alt="LABI" width="52" height="52"
                     style="display:block;margin:0 auto 12px;border-radius:4px;" />
                <span style="display:block;font-size:24px;font-weight:800;letter-spacing:0.35em;
                             color:#FED700;font-family:'DM Sans',Arial,sans-serif;">
                  LABI
                </span>
              </a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #222;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;color:#555;letter-spacing:0.1em;
                        text-transform:uppercase;">
                Labi Africa &mdash; Lagos &bull; Ilorin, Nigeria
              </p>
              <p style="margin:0;font-size:11px;color:#555;">
                Questions? Reply to this email or
                <a href="https://wa.me/2349019825348" style="color:#FED700;text-decoration:none;">
                  chat on WhatsApp
                </a>
              </p>
              <p style="margin:8px 0 0;font-size:10px;color:#3a3a3a;">
                &copy; ${new Date().getFullYear()} Labi Africa. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Gold CTA button. */
function goldBtn(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
    <tr>
      <td>
        <a href="${href}"
           style="display:inline-block;background:#FED700;color:#000000;padding:14px 32px;
                  text-decoration:none;font-size:11px;letter-spacing:0.2em;
                  text-transform:uppercase;font-weight:700;font-family:'DM Sans',Arial,sans-serif;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Secondary outline button. */
function outlineBtn(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
    <tr>
      <td>
        <a href="${href}"
           style="display:inline-block;background:transparent;color:#FED700;
                  border:1px solid #FED700;padding:14px 32px;
                  text-decoration:none;font-size:11px;letter-spacing:0.2em;
                  text-transform:uppercase;font-weight:700;font-family:'DM Sans',Arial,sans-serif;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Styled info box. */
function infoBox(rows: string, borderColor = "#2a2a2a"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#191919;border:1px solid ${borderColor};margin:20px 0;">
    <tr><td style="padding:20px 24px;">${rows}</td></tr>
  </table>`;
}

/** A single row inside an info box. */
function infoRow(label: string, value: string, highlight = false): string {
  return `<p style="margin:0 0 10px;font-size:13px;color:#999;font-family:'DM Sans',Arial,sans-serif;">
    <span style="display:inline-block;min-width:140px;color:#666;">${label}</span>
    <strong style="color:${highlight ? "#FED700" : "#e8e8e8"};">${value}</strong>
  </p>`;
}

/** Section heading inside the body. */
function heading(text: string): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;font-weight:300;color:#ffffff;
                     font-family:'DM Sans',Arial,sans-serif;letter-spacing:0.05em;">
    ${text}
  </h1>`;
}

/** Muted subtitle. */
function sub(text: string): string {
  return `<p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;
                    font-family:'DM Sans',Arial,sans-serif;">
    ${text}
  </p>`;
}

/** Divider. */
const divider = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="border-top:1px solid #222;"></td></tr>
  </table>`;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly storefrontUrl: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.get<string>("resend.apiKey"));
    this.fromEmail = this.config.get<string>(
      "resend.fromEmail",
      "orders@labiafrica.com",
    );
    this.storefrontUrl = this.config
      .get<string>("storefront.baseUrl", "https://labiafrica.com")
      .replace(/\/$/, "");
  }

  // ─── Order confirmation (catalog order) ───────────────────────────────────

  async sendOrderConfirmation(order: OrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const currency = order.chargeCurrency ?? "NGN";
    const isMultiCurrency = currency !== "NGN" && order.chargeTotal != null;

    // Build item rows
    const itemRows = order.items
      .map((i) => {
        const lineTotal = isMultiCurrency
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency,
              minimumFractionDigits: 2,
            }).format((i.unitPrice * i.qty * (order.fxRate ?? 1)) / 100)
          : fmtNGN(i.unitPrice * i.qty);

        return `<tr>
          <td style="padding:12px 0;border-bottom:1px solid #222;font-size:13px;color:#ccc;">
            ${i.title}
            <span style="display:block;font-size:11px;color:#666;letter-spacing:0.08em;
                         text-transform:uppercase;margin-top:2px;">
              Qty ${i.qty} &middot; ${i.sku}
            </span>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #222;text-align:right;
                     font-size:13px;color:#e8e8e8;white-space:nowrap;">
            ${lineTotal}
          </td>
        </tr>`;
      })
      .join("");

    const totalDisplay = fmtOrderTotal(order);
    const ngnNote = isMultiCurrency
      ? `<p style="margin:4px 0 0;font-size:11px;color:#555;">≈ ${fmtNGN(order.total)} NGN equivalent</p>`
      : "";

    const body = `
      ${heading("Order Confirmed")}
      ${sub(`Hi ${order.customerName ?? "there"}, your payment has been received and your order is confirmed.`)}

      ${infoBox(
        infoRow("Order number", order.orderNumber) +
          infoRow("Status", "Confirmed &amp; paid", true),
      )}

      <p style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;
                color:#555;margin:0 0 12px;font-family:'DM Sans',Arial,sans-serif;">
        Items in this order
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr>
            <th style="text-align:left;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;
                       color:#555;padding-bottom:10px;border-bottom:1px solid #2a2a2a;
                       font-weight:400;">Item</th>
            <th style="text-align:right;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;
                       color:#555;padding-bottom:10px;border-bottom:1px solid #2a2a2a;
                       font-weight:400;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td style="padding-top:14px;font-size:13px;color:#888;">Total</td>
            <td style="padding-top:14px;text-align:right;">
              <span style="font-size:18px;font-weight:700;color:#FED700;">${totalDisplay}</span>
              ${ngnNote}
            </td>
          </tr>
        </tfoot>
      </table>

      ${divider}
      ${goldBtn(orderUrl, "Track My Order")}
    `;

    await this.send(
      to,
      `Order confirmed — ${order.orderNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Order status update ──────────────────────────────────────────────────

  async sendOrderStatusUpdate(
    order: OrderDocument,
    _previousStatus: string,
  ): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;

    const config: Record<
      string,
      { subject: string; headline: string; message: string; btnLabel: string }
    > = {
      fulfilled: {
        subject: `Your order is on its way — ${order.orderNumber}`,
        headline: "Your order has been dispatched",
        message:
          "Great news! Your order has left our facility and is on its way to you. You'll receive it within the estimated delivery window.",
        btnLabel: "Track My Order",
      },
      cancelled: {
        subject: `Order cancelled — ${order.orderNumber}`,
        headline: "Your order has been cancelled",
        message:
          "Your order has been cancelled. If you did not request this, please get in touch with us immediately.",
        btnLabel: "Contact Us",
      },
      refunded: {
        subject: `Refund processed — ${order.orderNumber}`,
        headline: "Your refund is on the way",
        message:
          "Your refund has been processed and should appear in your account within 3–5 business days, depending on your payment provider.",
        btnLabel: "View Order",
      },
    };

    const cfg = config[order.status];
    if (!cfg) return;

    const body = `
      ${heading(cfg.headline)}
      ${sub(`Hi ${order.customerName ?? "there"},`)}
      <p style="font-size:15px;color:#ccc;line-height:1.7;margin:0 0 24px;
                font-family:'DM Sans',Arial,sans-serif;">
        ${cfg.message}
      </p>
      ${infoBox(infoRow("Order number", order.orderNumber))}
      ${goldBtn(orderUrl, cfg.btnLabel)}
    `;

    await this.send(to, cfg.subject, labiShell(body, this.storefrontUrl));
  }

  // ─── Back-in-stock alert ──────────────────────────────────────────────────

  async sendBackInStockAlert(
    to: string,
    productTitle: string,
    productSlug: string,
  ): Promise<void> {
    const productUrl = `${this.storefrontUrl}/shop/${productSlug}`;

    const body = `
      ${heading("Back in Stock")}
      ${sub("Good news — an item you were watching is available again.")}
      ${infoBox(infoRow("Item", productTitle, true))}
      <p style="font-size:14px;color:#888;line-height:1.6;margin:0 0 4px;
                font-family:'DM Sans',Arial,sans-serif;">
        Stock levels can move quickly. We recommend completing your purchase soon.
      </p>
      ${goldBtn(productUrl, "Shop Now")}
    `;

    await this.send(
      to,
      `Back in stock: ${productTitle}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Custom order: quote ready ────────────────────────────────────────────

  async sendCustomOrderQuote(order: CustomOrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const approveUrl = `${this.storefrontUrl}/account`;
    const quotedFormatted = fmtNGN(order.quotedPrice ?? 0);

    const body = `
      ${heading("Your quote is ready")}
      ${sub(`Hi ${order.customerName ?? "there"}, we have reviewed your request and prepared a price for you.`)}

      ${infoBox(
        infoRow("Reference", order.referenceNumber) +
          infoRow("Garment", order.garmentCategory) +
          infoRow("Quoted price", quotedFormatted, true) +
          (order.estimatedReadyDate
            ? infoRow("Est. ready date", order.estimatedReadyDate)
            : "") +
          (order.adminQuoteNote
            ? `<p style="margin:12px 0 0;font-size:13px;color:#888;border-top:1px solid #2a2a2a;
                       padding-top:12px;font-style:italic;">
               "${order.adminQuoteNote}"
             </p>`
            : ""),
      )}

      <p style="font-size:14px;color:#888;line-height:1.7;margin:0 0 4px;
                font-family:'DM Sans',Arial,sans-serif;">
        To proceed, approve the quote and complete payment. Your piece enters production
        only after payment is confirmed.
      </p>

      ${goldBtn(approveUrl, "Approve Quote &amp; Pay")}
      ${order.whatsappLink ? outlineBtn(order.whatsappLink, "Chat on WhatsApp") : ""}
    `;

    await this.send(
      to,
      `Your Labi quote is ready — ${order.referenceNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Custom order: payment confirmed ──────────────────────────────────────

  async sendCustomOrderConfirmation(order: CustomOrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const trackUrl = `${this.storefrontUrl}/account`;
    const amountFormatted = fmtNGN(order.quotedPrice ?? 0);

    const body = `
      ${heading("Payment confirmed")}
      ${sub(`Hi ${order.customerName ?? "there"}, we have received your payment and your custom piece is now in our production queue.`)}

      ${infoBox(
        infoRow("Reference", order.referenceNumber) +
          infoRow("Garment", order.garmentCategory) +
          infoRow("Amount paid", amountFormatted, true) +
          (order.estimatedReadyDate
            ? infoRow("Est. ready date", order.estimatedReadyDate)
            : ""),
      )}

      <p style="font-size:14px;color:#888;line-height:1.7;margin:0 0 4px;
                font-family:'DM Sans',Arial,sans-serif;">
        We will notify you as your piece moves through each stage — fabric cutting,
        sewing, and quality check. You can also track progress from your account.
      </p>

      ${goldBtn(trackUrl, "Track My Order")}
      ${order.whatsappLink ? outlineBtn(order.whatsappLink, "Chat on WhatsApp") : ""}
    `;

    await this.send(
      to,
      `Custom order confirmed — ${order.referenceNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Production stage update ──────────────────────────────────────────────

  async sendProductionUpdate(
    order: CustomOrderDocument,
    newStage: string,
    stageLabel: string,
  ): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const trackUrl = `${this.storefrontUrl}/account`;

    const stageMessages: Record<string, string> = {
      cutting:
        "Your fabric has been selected and precision-cut by our artisans. Your piece is now taking shape.",
      sewing:
        "Our craftspeople are now hand-assembling your garment to your measurements.",
      quality_check:
        "Your piece is undergoing a final quality inspection — almost done!",
      ready:
        "Your order has passed quality check and is ready for delivery or collection.",
      delivered:
        "Your order is on its way! We hope you love your piece — please let us know if there is anything you need.",
    };

    const message =
      stageMessages[newStage] ??
      `Your order has moved to the ${stageLabel} stage.`;

    const isReadyOrDelivered = newStage === "ready" || newStage === "delivered";

    const subjects: Record<string, string> = {
      cutting: `Production started — ${order.referenceNumber}`,
      sewing: `Now being crafted — ${order.referenceNumber}`,
      quality_check: `Quality check in progress — ${order.referenceNumber}`,
      ready: `Your piece is ready — ${order.referenceNumber}`,
      delivered: `Order delivered — ${order.referenceNumber}`,
    };

    const body = `
      ${heading(`${isReadyOrDelivered ? "✦ " : ""}${stageLabel}`)}
      ${sub(`Hi ${order.customerName ?? "there"}, here is an update on your custom order.`)}

      <p style="font-size:15px;color:#ccc;line-height:1.7;margin:0 0 24px;
                font-family:'DM Sans',Arial,sans-serif;">
        ${message}
      </p>

      ${infoBox(
        infoRow("Order", order.referenceNumber) +
          infoRow("Current stage", stageLabel, true) +
          (order.estimatedReadyDate
            ? infoRow("Est. ready date", order.estimatedReadyDate)
            : ""),
        isReadyOrDelivered ? "#3d3200" : "#2a2a2a",
      )}

      ${isReadyOrDelivered ? goldBtn(trackUrl, "View Order") : outlineBtn(trackUrl, "View Order")}
      ${
        order.whatsappLink
          ? `<p style="margin-top:16px;font-size:13px;color:#666;font-family:'DM Sans',Arial,sans-serif;">
             Have a question? <a href="${order.whatsappLink}" style="color:#FED700;text-decoration:none;">Chat with us on WhatsApp</a>
           </p>`
          : ""
      }
    `;

    await this.send(
      to,
      subjects[newStage] ?? `Production update — ${order.referenceNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Shipping: quote requested (admin alert) ──────────────────────────────

  async sendShippingQuoteRequested(order: OrderDocument): Promise<void> {
    const adminEmails = this.config
      .get<string>("shipping.adminAlertEmails", "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!adminEmails.length) {
      this.logger.warn(
        "No ADMIN_ALERT_EMAILS configured — skipping quote-requested alert",
      );
      return;
    }

    const quotesUrl = `${this.storefrontUrl}/admin/shipping/quotes`;

    const body = `
      ${heading("Shipping quote needed")}
      ${sub("A new order is waiting for a shipping fee quote.")}

      ${infoBox(
        infoRow("Order", order.orderNumber) +
          infoRow(
            "Customer",
            `${order.customerName ?? "Guest"} (${order.customerEmail ?? "—"})`,
          ) +
          infoRow(
            "Destination",
            [order.shippingAddress?.city, order.shippingAddress?.country]
              .filter(Boolean)
              .join(", ") || "—",
          ) +
          infoRow("Zone", order.shippingZoneName ?? "—") +
          infoRow("Order total", fmtNGN(order.total), true),
        "#2a2a00",
      )}

      ${goldBtn(quotesUrl, "Go to Quotes Queue")}
    `;

    for (const to of adminEmails) {
      await this.send(
        to,
        `Quote needed — Order ${order.orderNumber}`,
        labiShell(body, this.storefrontUrl),
      );
    }
  }

  // ─── Shipping: SLA overdue (admin alert) ──────────────────────────────────

  async sendShippingQuoteSlaAlert(order: OrderDocument): Promise<void> {
    const adminEmails = this.config
      .get<string>("shipping.adminAlertEmails", "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!adminEmails.length) return;

    const quotesUrl = `${this.storefrontUrl}/admin/shipping/quotes`;
    const requestedAt = order.shippingQuote?.requestedAt
      ? new Date(order.shippingQuote.requestedAt).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

    const body = `
      ${heading("⚠ Shipping quote overdue")}
      ${sub("The SLA window has passed. Please submit a quote as soon as possible.")}

      ${infoBox(
        infoRow("Order", order.orderNumber) +
          infoRow("Customer", order.customerName ?? "Guest") +
          infoRow("Requested at", requestedAt),
        "#5a0000",
      )}

      ${goldBtn(quotesUrl, "Submit Quote Now")}
    `;

    for (const to of adminEmails) {
      await this.send(
        to,
        `OVERDUE: Shipping quote for ${order.orderNumber}`,
        labiShell(body, this.storefrontUrl),
      );
    }
  }

  // ─── Shipping: quote ready (customer) ────────────────────────────────────

  async sendShippingQuoteReady(order: OrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const quote = order.shippingQuote;
    const currency = order.chargeCurrency ?? "NGN";

    // Items subtotal = order total minus shipping fee (both in naira)
    const itemsNaira = Math.max(
      0,
      (order.total ?? 0) - (order.shippingFee ?? 0),
    );

    // For multi-currency orders, show the charge currency amounts
    const isMulti = currency !== "NGN" && order.chargeTotal != null;
    const feeDisplay = isMulti
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
        }).format((order.shippingFee ?? 0) / 100)
      : fmtNGN(order.shippingFee ?? 0);
    const itemsDisplay = isMulti
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
        }).format(itemsNaira / 100)
      : fmtNGN(itemsNaira);
    const totalDisplay = fmtOrderTotal(order);

    const validUntilDisplay = quote?.validUntil
      ? new Date(quote.validUntil).toLocaleDateString("en-NG", {
          dateStyle: "long",
        })
      : "—";

    const body = `
      ${heading("Your shipping quote is ready")}
      ${sub(`Hi ${order.customerName ?? "there"}, your order is ready for payment including the shipping fee.`)}

      ${infoBox(
        infoRow("Order", order.orderNumber) +
          infoRow("Items", itemsDisplay) +
          infoRow("Shipping fee", feeDisplay, true) +
          (quote?.carrier ? infoRow("Carrier", quote.carrier) : "") +
          (quote?.etaDays
            ? infoRow(
                "Est. delivery",
                `${quote.etaDays} business day${quote.etaDays !== 1 ? "s" : ""}`,
              )
            : "") +
          infoRow("Quote valid until", validUntilDisplay) +
          `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #2a2a2a;
                   font-size:15px;color:#e8e8e8;font-family:'DM Sans',Arial,sans-serif;">
           Total &nbsp;
           <strong style="color:#FED700;font-size:20px;">${totalDisplay}</strong>
         </p>` +
          (quote?.note
            ? `<p style="margin:8px 0 0;font-size:13px;color:#777;font-style:italic;">"${quote.note}"</p>`
            : ""),
      )}

      ${goldBtn(orderUrl, "Pay Now")}
      <p style="font-size:12px;color:#555;margin-top:12px;font-family:'DM Sans',Arial,sans-serif;">
        This quote expires on <strong style="color:#888;">${validUntilDisplay}</strong>.
      </p>
    `;

    await this.send(
      to,
      `Shipping quote ready — ${order.orderNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Shipping: quote expiring reminder (customer) ─────────────────────────

  async sendShippingQuoteExpiring(order: OrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const validUntil = order.shippingQuote?.validUntil;
    const expiresDisplay = validUntil
      ? new Date(validUntil).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

    const body = `
      ${heading("Your quote expires soon")}
      ${sub(`Hi ${order.customerName ?? "there"}, your shipping quote for order ${order.orderNumber} expires in 24 hours.`)}

      ${infoBox(
        infoRow("Order", order.orderNumber) +
          infoRow("Expires", expiresDisplay, true) +
          infoRow("Order total", fmtOrderTotal(order)),
      )}

      <p style="font-size:14px;color:#888;line-height:1.7;margin:0 0 4px;
                font-family:'DM Sans',Arial,sans-serif;">
        Complete payment before it expires to keep your reservation and the quoted shipping rate.
      </p>

      ${goldBtn(orderUrl, "Pay Now")}
    `;

    await this.send(
      to,
      `Your quote expires soon — ${order.orderNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Shipping: quote expired (customer) ──────────────────────────────────

  async sendShippingQuoteExpired(order: OrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;

    const body = `
      ${heading("Your shipping quote has expired")}
      ${sub(`Hi ${order.customerName ?? "there"}, the shipping quote for order ${order.orderNumber} has expired unpaid.`)}

      ${infoBox(infoRow("Order", order.orderNumber))}

      <p style="font-size:14px;color:#888;line-height:1.7;margin:0 0 4px;
                font-family:'DM Sans',Arial,sans-serif;">
        You can request a new quote from your order page and we will respond promptly.
      </p>

      ${goldBtn(orderUrl, "Request New Quote")}
    `;

    await this.send(
      to,
      `Shipping quote expired — ${order.orderNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Shipping: adjustment (customer) ──────────────────────────────────────

  async sendShippingAdjustment(
    order: OrderDocument,
    type: "refund" | "extra_charge",
    amount: number,
    reason: string,
  ): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const isRefund = type === "refund";
    const currency = order.chargeCurrency ?? "NGN";
    const amountDisplay = fmtMinor(amount, currency);
    const orderUrl = `${this.storefrontUrl}/orders/${(order._id as unknown as { toString(): string }).toString()}`;

    const body = `
      ${heading(isRefund ? "Shipping refund processed" : "Additional shipping payment required")}
      ${sub(`Hi ${order.customerName ?? "there"},`)}

      <p style="font-size:15px;color:#ccc;line-height:1.7;margin:0 0 24px;
                font-family:'DM Sans',Arial,sans-serif;">
        ${
          isRefund
            ? `A shipping refund of <strong style="color:#FED700;">${amountDisplay}</strong> has been processed for order <strong>${order.orderNumber}</strong>. It should appear within 3–5 business days.`
            : `An additional shipping payment of <strong style="color:#FED700;">${amountDisplay}</strong> is required for order <strong>${order.orderNumber}</strong>.`
        }
      </p>

      ${infoBox(
        infoRow("Order", order.orderNumber) +
          infoRow(
            isRefund ? "Refund amount" : "Amount due",
            amountDisplay,
            true,
          ) +
          infoRow("Reason", reason),
      )}

      ${isRefund ? outlineBtn(orderUrl, "View Order") : goldBtn(orderUrl, "View Order")}
    `;

    await this.send(
      to,
      isRefund
        ? `Shipping refund — ${order.orderNumber}`
        : `Additional shipping payment — ${order.orderNumber}`,
      labiShell(body, this.storefrontUrl),
    );
  }

  // ─── Core send helper ─────────────────────────────────────────────────────

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });
    } catch (err) {
      // Log but never crash the caller
      this.logger.error(
        `Email send failed to ${to}: ${(err as Error).message}`,
      );
    }
  }
}
