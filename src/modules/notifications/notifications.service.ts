import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { OrderDocument } from "../order/schemas/order.schema";
import { CustomOrderDocument } from "../custom-order/schemas/custom-order.schema";

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
      "orders@mail.alphavista.ng",
    );
    this.storefrontUrl = this.config.get<string>(
      "storefront.baseUrl",
      "https://alphavista.ng",
    );
  }

  // ─── Order confirmation ───────────────────────────────────────────────────

  async sendOrderConfirmation(order: OrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const itemRows = order.items
      .map(
        (i) =>
          `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #eee">${i.title}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">₦${i.unitPrice.toLocaleString()}</td>
          </tr>`,
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:'DM Sans',Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px">
        <h1 style="font-size:22px;margin-bottom:4px">Order Confirmed ✅</h1>
        <p style="color:#555">Hi ${order.customerName ?? "there"}, your order has been received and payment confirmed.</p>

        <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0 0 4px"><strong>Order:</strong> ${order.orderNumber}</p>
          <p style="margin:0"><strong>Total:</strong> ₦${order.total.toLocaleString()}</p>
        </div>

        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid #eee">
              <th style="text-align:left;padding-bottom:8px">Item</th>
              <th style="text-align:center;padding-bottom:8px">Qty</th>
              <th style="text-align:right;padding-bottom:8px">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <p style="margin-top:24px">
          <a href="${this.storefrontUrl}/account/orders"
             style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
            View Order
          </a>
        </p>

        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999">
          Alphavista Electronics · Abuja, Nigeria<br>
          Questions? Reply to this email or WhatsApp +234-XXX-XXXX-XXX
        </p>
      </body>
      </html>
    `;

    await this.send(to, `Order Confirmed: ${order.orderNumber}`, html);
  }

  // ─── Order status update ──────────────────────────────────────────────────

  async sendOrderStatusUpdate(
    order: OrderDocument,
    previousStatus: string,
  ): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const statusMessages: Record<string, string> = {
      fulfilled: "Your order has been dispatched and is on its way!",
      cancelled:
        "Your order has been cancelled. Contact us if you have questions.",
      refunded:
        "Your refund has been processed. It should appear within 3–5 business days.",
    };

    const message = statusMessages[order.status];
    if (!message) return;

    const html = `
      <p>Hi ${order.customerName ?? "there"},</p>
      <p>${message}</p>
      <p><strong>Order:</strong> ${order.orderNumber}</p>
      <p><a href="${this.storefrontUrl}/account/orders">View Order</a></p>
    `;

    const subjects: Record<string, string> = {
      fulfilled: `Your order ${order.orderNumber} is on its way!`,
      cancelled: `Order ${order.orderNumber} cancelled`,
      refunded: `Refund processed for ${order.orderNumber}`,
    };

    await this.send(
      to,
      subjects[order.status] ?? `Order Update: ${order.orderNumber}`,
      html,
    );
  }

  // ─── Back-in-stock alert ──────────────────────────────────────────────────

  async sendBackInStockAlert(
    to: string,
    productTitle: string,
    productSlug: string,
  ): Promise<void> {
    const html = `
      <p>Good news! <strong>${productTitle}</strong> is back in stock.</p>
      <p><a href="${this.storefrontUrl}/product/${productSlug}">Shop now →</a></p>
    `;
    await this.send(to, `Back in stock: ${productTitle}`, html);
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

  // ─── Custom order: quote ready ────────────────────────────────────────────

  /**
   * Sent when an admin sets a price quote on a custom order.
   * Includes the quoted price, estimated ready date, and a direct link to
   * approve the quote and proceed to payment.
   */
  async sendCustomOrderQuote(order: CustomOrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const approveUrl = `${this.storefrontUrl}/custom-orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const whatsappSection = order.whatsappLink
      ? `<p style="margin-top:16px">
           Questions? <a href="${order.whatsappLink}" style="color:#FED700">Chat with us on WhatsApp</a>
         </p>`
      : "";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:'DM Sans',Arial,sans-serif;color:#f5f5f5;background:#0f0f0f;max-width:600px;margin:0 auto;padding:24px">
        <p style="font-size:22px;font-weight:700;letter-spacing:0.25em;color:#FED700;margin-bottom:4px">LABI</p>
        <h1 style="font-size:20px;margin-bottom:4px">Your custom order quote is ready</h1>
        <p style="color:#999">Hi ${order.customerName}, we have reviewed your request and prepared a quote.</p>

        <div style="background:#1a1a1a;border:1px solid #333;border-radius:0;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Reference:</strong> ${order.referenceNumber}</p>
          <p style="margin:0 0 8px"><strong>Garment:</strong> ${order.garmentCategory}</p>
          <p style="margin:0 0 8px"><strong>Quoted Price:</strong>
            <span style="color:#FED700;font-size:18px;font-weight:700">
              ₦${(order.quotedPrice ?? 0).toLocaleString("en-NG")}
            </span>
          </p>
          <p style="margin:0 0 8px"><strong>Estimated Ready:</strong> ${order.estimatedReadyDate ?? "TBD"}</p>
          ${
            order.adminQuoteNote
              ? `<p style="margin:0;color:#aaa;font-size:13px">${order.adminQuoteNote}</p>`
              : ""
          }
        </div>

        <p style="color:#999;font-size:14px">
          To proceed, approve the quote and complete payment. Your order enters production
          only after payment is confirmed.
        </p>

        <a href="${approveUrl}"
           style="display:inline-block;background:#FED700;color:#000;padding:12px 28px;
                  text-decoration:none;font-size:12px;letter-spacing:0.15em;
                  text-transform:uppercase;font-weight:600;margin-top:16px">
          Approve Quote &amp; Pay
        </a>

        ${whatsappSection}

        <hr style="border:none;border-top:1px solid #333;margin:24px 0">
        <p style="font-size:11px;color:#666">Labi Fashion · Lagos, Nigeria</p>
      </body>
      </html>
    `;

    await this.send(
      to,
      `Your Labi quote is ready — ${order.referenceNumber}`,
      html,
    );
  }

  // ─── Custom order: confirmed (payment received) ───────────────────────────

  /**
   * Sent immediately after the payment webhook confirms a custom order payment.
   * Includes a WhatsApp click-to-chat link and a link to track the order.
   */
  async sendCustomOrderConfirmation(order: CustomOrderDocument): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const trackUrl = `${this.storefrontUrl}/custom-orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const whatsappSection = order.whatsappLink
      ? `<p style="margin-top:16px">
           Need to discuss your order?
           <a href="${order.whatsappLink}" style="color:#FED700">Chat with us on WhatsApp</a>
         </p>`
      : "";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:'DM Sans',Arial,sans-serif;color:#f5f5f5;background:#0f0f0f;max-width:600px;margin:0 auto;padding:24px">
        <p style="font-size:22px;font-weight:700;letter-spacing:0.25em;color:#FED700;margin-bottom:4px">LABI</p>
        <h1 style="font-size:20px;margin-bottom:4px">Payment confirmed — your piece is in the queue</h1>
        <p style="color:#999">Hi ${order.customerName}, we have received your payment and your custom order is now in our production queue.</p>

        <div style="background:#1a1a1a;border:1px solid #333;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Reference:</strong> ${order.referenceNumber}</p>
          <p style="margin:0 0 8px"><strong>Garment:</strong> ${order.garmentCategory}</p>
          <p style="margin:0 0 8px"><strong>Amount Paid:</strong>
            <span style="color:#FED700;font-weight:700">
              ₦${(order.quotedPrice ?? 0).toLocaleString("en-NG")}
            </span>
          </p>
          ${
            order.estimatedReadyDate
              ? `<p style="margin:0"><strong>Estimated Ready:</strong> ${order.estimatedReadyDate}</p>`
              : ""
          }
        </div>

        <p style="color:#999;font-size:14px">
          We will notify you as your order moves through each production stage —
          fabric cutting, sewing, and quality check.
        </p>

        <a href="${trackUrl}"
           style="display:inline-block;background:#FED700;color:#000;padding:12px 28px;
                  text-decoration:none;font-size:12px;letter-spacing:0.15em;
                  text-transform:uppercase;font-weight:600;margin-top:16px">
          Track My Order
        </a>

        ${whatsappSection}

        <hr style="border:none;border-top:1px solid #333;margin:24px 0">
        <p style="font-size:11px;color:#666">Labi Fashion · Lagos, Nigeria</p>
      </body>
      </html>
    `;

    await this.send(
      to,
      `Custom order confirmed — ${order.referenceNumber}`,
      html,
    );
  }

  // ─── Production stage update ──────────────────────────────────────────────

  /**
   * Sent when an admin/staff member advances the production stage for a
   * custom order. Keeps the customer informed without them having to ask.
   */
  async sendProductionUpdate(
    order: CustomOrderDocument,
    newStage: string,
    stageLabel: string,
  ): Promise<void> {
    const to = order.customerEmail;
    if (!to) return;

    const trackUrl = `${this.storefrontUrl}/custom-orders/${(order._id as unknown as { toString(): string }).toString()}`;
    const whatsappSection = order.whatsappLink
      ? `<a href="${order.whatsappLink}" style="color:#FED700">Chat with us on WhatsApp</a>`
      : "";

    const stageMessages: Record<string, string> = {
      cutting:
        "Your fabric has been selected and precision-cut by our artisans.",
      sewing:
        "Your garment is now being hand-sewn and assembled to your measurements.",
      quality_check:
        "Your piece is undergoing final quality inspection — almost there!",
      ready:
        "Your order has passed quality check and is ready for delivery or pickup.",
      delivered: "Your order is on its way! We hope you love your piece.",
    };

    const message =
      stageMessages[newStage] ??
      `Your order has moved to the ${stageLabel} stage.`;
    const isReady = newStage === "ready" || newStage === "delivered";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:'DM Sans',Arial,sans-serif;color:#f5f5f5;background:#0f0f0f;max-width:600px;margin:0 auto;padding:24px">
        <p style="font-size:22px;font-weight:700;letter-spacing:0.25em;color:#FED700;margin-bottom:4px">LABI</p>
        <h1 style="font-size:20px;margin-bottom:4px">Production update — ${stageLabel}</h1>
        <p style="color:#999">Hi ${order.customerName},</p>
        <p style="color:#ccc">${message}</p>

        <div style="background:#1a1a1a;border:1px solid #333;padding:16px;margin:16px 0">
          <p style="margin:0 0 4px"><strong>Order:</strong> ${order.referenceNumber}</p>
          <p style="margin:0 0 4px"><strong>Current Stage:</strong>
            <span style="color:#FED700">${stageLabel}</span>
          </p>
          ${
            order.estimatedReadyDate
              ? `<p style="margin:0"><strong>Est. Ready Date:</strong> ${order.estimatedReadyDate}</p>`
              : ""
          }
        </div>

        <a href="${trackUrl}"
           style="display:inline-block;background:${isReady ? "#FED700" : "#1a1a1a"};
                  color:${isReady ? "#000" : "#FED700"};
                  border:1px solid #FED700;
                  padding:12px 28px;text-decoration:none;font-size:12px;
                  letter-spacing:0.15em;text-transform:uppercase;font-weight:600;margin-top:8px">
          View Order Status
        </a>

        ${
          whatsappSection
            ? `<p style="margin-top:16px;font-size:13px;color:#999">
               Questions? ${whatsappSection}
             </p>`
            : ""
        }

        <hr style="border:none;border-top:1px solid #333;margin:24px 0">
        <p style="font-size:11px;color:#666">Labi Fashion · Lagos, Nigeria</p>
      </body>
      </html>
    `;

    const subjects: Record<string, string> = {
      cutting: `Production started — ${order.referenceNumber}`,
      sewing: `Now being sewn — ${order.referenceNumber}`,
      quality_check: `Quality check in progress — ${order.referenceNumber}`,
      ready: `Your order is ready! — ${order.referenceNumber}`,
      delivered: `Delivered — ${order.referenceNumber}`,
    };

    await this.send(
      to,
      subjects[newStage] ?? `Production update — ${order.referenceNumber}`,
      html,
    );
  }
}
