import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { Model, Types } from "mongoose";
import * as crypto from "crypto";
import {
  CustomOrder,
  CustomOrderDocument,
  CustomOrderStatus,
} from "./schemas/custom-order.schema";
import {
  AdminQuoteCustomOrderDto,
  AdminUpdateCustomOrderStatusDto,
  ApproveQuoteDto,
  CustomOrderQueryDto,
  SubmitCustomOrderDto,
} from "./dto/custom-order.dto";
import { MeasurementProfileService } from "../measurement-profile/measurement-profile.service";
import { NotificationsService } from "../notifications/notifications.service";
import { paginate, PaginatedResult } from "../../common/dto/pagination.dto";

@Injectable()
export class CustomOrderService {
  private readonly logger = new Logger(CustomOrderService.name);

  constructor(
    @InjectModel(CustomOrder.name)
    private readonly customOrderModel: Model<CustomOrderDocument>,
    private readonly measurementService: MeasurementProfileService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // ─── Submit (guest or authenticated) ─────────────────────────────────────

  /**
   * PRD Flow 2, step 1–2.
   * BUSINESS RULE: a guest can submit without an account.
   * When userId is null, customerName + customerEmail must be present in the DTO.
   */
  async submit(
    dto: SubmitCustomOrderDto,
    userId: string | null,
    userEmail: string | null,
    userName: string | null,
  ): Promise<CustomOrderDocument> {
    // ── Resolve identity ──────────────────────────────────────────────────
    const resolvedEmail = userId
      ? (userEmail ?? dto.customerEmail)
      : dto.customerEmail;
    const resolvedName = userId
      ? (userName ?? dto.customerName)
      : dto.customerName;

    if (!resolvedEmail) {
      throw new BadRequestException(
        "customerEmail is required for guest custom order submissions",
      );
    }
    if (!resolvedName) {
      throw new BadRequestException(
        "customerName is required for guest custom order submissions",
      );
    }

    // ── Resolve measurements ──────────────────────────────────────────────
    let measurementSnapshot: CustomOrder["measurement"] = null;

    if (dto.measurement) {
      const m = dto.measurement;

      if (m.profileId && m.measurements && m.measurements.length > 0) {
        throw new BadRequestException(
          "Provide either a saved profileId OR inline measurements — not both",
        );
      }

      if (m.profileId) {
        // Look up saved profile — only possible for authenticated users
        if (!userId) {
          throw new BadRequestException(
            "Cannot reference a saved measurement profile without being logged in. " +
              "Please supply inline measurements instead.",
          );
        }
        const profile = await this.measurementService.findOneByUser(
          userId,
          m.profileId,
        );
        measurementSnapshot = {
          profileId: m.profileId,
          garmentType: profile.garmentType,
          garmentLabel: profile.garmentLabel,
          fields: profile.measurements.map((f) => ({
            key: f.key,
            label: f.label,
            value: f.value,
          })),
        };
      } else if (m.measurements && m.measurements.length > 0) {
        // Validate inline measurements (second line of defence; DTO already runs @Min/@Max)
        MeasurementProfileService.validateFields(m.measurements);
        measurementSnapshot = {
          profileId: null,
          garmentType: m.garmentType,
          garmentLabel: m.garmentLabel ?? null,
          fields: m.measurements.map((f) => ({
            key: f.key,
            label: f.label,
            value: f.value,
          })),
        };
      } else {
        throw new BadRequestException(
          "measurement block provided but contains neither a profileId nor inline measurements",
        );
      }
    }

    // ── Build WhatsApp click-to-chat link ─────────────────────────────────
    const whatsappNumber = this.config.get<string>("whatsapp.number", "");
    const whatsappLink = whatsappNumber
      ? `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}?text=Hi%2C%20I%20submitted%20a%20custom%20order%20and%20would%20like%20to%20follow%20up.`
      : null;

    // ── Persist ───────────────────────────────────────────────────────────
    const referenceNumber = await this.nextReferenceNumber();

    return this.customOrderModel.create({
      customerId: userId,
      customerEmail: resolvedEmail.toLowerCase().trim(),
      customerName: resolvedName.trim(),
      customerPhone: dto.customerPhone ?? null,
      referenceNumber,
      description: dto.description,
      garmentCategory: dto.garmentCategory,
      fabricChoice: dto.fabricChoice ?? null,
      referenceImages: dto.referenceImages ?? [],
      measurement: measurementSnapshot,
      status: "pending_review",
      whatsappLink,
    });
  }

  // ─── Customer: list own orders ────────────────────────────────────────────

  async findByCustomer(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<CustomOrderDocument>> {
    const filter = { customerId: userId };
    const [items, total] = await Promise.all([
      this.customOrderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.customOrderModel.countDocuments(filter),
    ]);
    return paginate(items as unknown as CustomOrderDocument[], total, {
      page,
      limit,
    } as any);
  }

  async findOneByCustomer(
    customOrderId: string,
    userId: string,
  ): Promise<CustomOrderDocument> {
    const order = await this.customOrderModel.findOne({
      _id: customOrderId,
      customerId: userId,
    });
    if (!order) throw new NotFoundException("Custom order not found");
    return order;
  }

  // ─── Admin: set quote (PRD Flow 2, step 3) ───────────────────────────────

  /**
   * PRD Flow 2, step 3: admin reviews and sets a price + timeline.
   * Transitions status: pending_review → quoted.
   */
  async adminSetQuote(
    customOrderId: string,
    adminId: string,
    dto: AdminQuoteCustomOrderDto,
  ): Promise<CustomOrderDocument> {
    const order = await this.findByIdOrThrow(customOrderId);

    if (!["pending_review", "quoted"].includes(order.status)) {
      throw new BadRequestException(
        `Cannot set quote on a custom order with status "${order.status}". ` +
          `Only pending_review or re-quoted orders can be updated.`,
      );
    }

    // Parse and validate the date string
    const readyDate = new Date(dto.estimatedReadyDate);
    if (isNaN(readyDate.getTime()) || readyDate <= new Date()) {
      throw new BadRequestException(
        "estimatedReadyDate must be a valid future date in YYYY-MM-DD format",
      );
    }

    order.quotedPrice = dto.quotedPrice;
    order.estimatedReadyDate = dto.estimatedReadyDate;
    order.adminQuoteNote = dto.adminQuoteNote ?? null;
    order.quotedBy = adminId;
    order.quotedAt = new Date();
    order.status = "quoted";

    const saved = await order.save();

    // Fire-and-forget — never block the admin response on email delivery
    this.notifications
      .sendCustomOrderQuote(saved)
      .catch((err) =>
        this.logger.error(
          `Failed to send quote email for ${saved.referenceNumber}`,
          err,
        ),
      );

    return saved;
  }

  // ─── Customer: approve quote + initialize payment (Flow 2, steps 4) ──────

  /**
   * BUSINESS RULE: a custom order only enters production once payment is
   * confirmed against an admin-approved quote. This method sets status to
   * `payment_pending` and returns a checkout URL. The status transitions to
   * `paid` only via the payment webhook — never here.
   */
  async approveQuoteAndInitializePayment(
    customOrderId: string,
    userId: string,
    dto: ApproveQuoteDto,
  ): Promise<{ checkoutUrl: string; paymentReference: string }> {
    const order = await this.customOrderModel.findOne({
      _id: customOrderId,
      customerId: userId,
    });
    if (!order) throw new NotFoundException("Custom order not found");

    if (order.status !== "quoted") {
      throw new BadRequestException(
        `Custom order cannot be approved — current status is "${order.status}". ` +
          `Only a quoted order can be approved by the customer.`,
      );
    }

    if (!order.quotedPrice || order.quotedPrice <= 0) {
      throw new BadRequestException(
        "This custom order does not yet have a valid quote",
      );
    }

    const paymentReference = this.generatePaymentReference(
      order.referenceNumber,
    );
    const checkoutUrl = await this.initializePayment(
      order,
      dto.paymentProvider,
      paymentReference,
    );

    order.paymentProvider = dto.paymentProvider;
    order.paymentReference = paymentReference;
    order.checkoutUrl = checkoutUrl;
    order.status = "payment_pending";
    await order.save();

    return { checkoutUrl, paymentReference };
  }

  // ─── Webhook: confirm payment ─────────────────────────────────────────────

  /**
   * Called by the PaymentService webhook handler when a payment is confirmed.
   *
   * BUSINESS RULE: order enters production ONLY after this is called — never
   * on the redirect alone. Called exclusively from the webhook path.
   *
   * Returns null if no custom order matches the reference (normal for standard orders).
   */
  async confirmPayment(
    paymentReference: string,
    webhookId: string,
  ): Promise<CustomOrderDocument | null> {
    const order = await this.customOrderModel.findOne({ paymentReference });
    if (!order) return null;

    // Idempotency: already processed
    if (order.processedWebhookId) {
      this.logger.log(
        `Custom order ${order.referenceNumber} already confirmed by webhook ${order.processedWebhookId} — skipping`,
      );
      return order;
    }

    if (order.status !== "payment_pending") {
      this.logger.warn(
        `Custom order ${order.referenceNumber} received payment confirmation but status is "${order.status}" — skipping`,
      );
      return order;
    }

    order.status = "paid";
    order.paidAt = new Date();
    order.processedWebhookId = webhookId;
    const saved = await order.save();

    // Notify the customer — fire-and-forget
    this.notifications
      .sendCustomOrderConfirmation(saved)
      .catch((err) =>
        this.logger.error(
          `Failed to send confirmation email for ${saved.referenceNumber}`,
          err,
        ),
      );

    return saved;
  }

  /**
   * Called by the PaymentService when a payment fails.
   * Rolls the custom order back to `approved` so the customer can retry.
   */
  async handlePaymentFailed(paymentReference: string): Promise<void> {
    const order = await this.customOrderModel.findOne({ paymentReference });
    if (!order || order.status !== "payment_pending") return;
    order.status = "approved"; // allow retry
    order.checkoutUrl = null;
    await order.save();
  }

  // ─── Admin: update status ─────────────────────────────────────────────────

  async adminUpdateStatus(
    customOrderId: string,
    dto: AdminUpdateCustomOrderStatusDto,
  ): Promise<CustomOrderDocument> {
    const order = await this.findByIdOrThrow(customOrderId);

    const terminalStatuses: CustomOrderStatus[] = [
      "completed",
      "cancelled",
      "refunded",
    ];
    if (terminalStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Custom order is already in terminal status "${order.status}" and cannot be updated`,
      );
    }

    if (
      dto.status === "refunded" &&
      order.status !== "paid" &&
      order.status !== "in_production"
    ) {
      throw new BadRequestException(
        `Only paid or in-production custom orders can be refunded`,
      );
    }

    order.status = dto.status;
    return order.save();
  }

  /** Admin: mark as in_production — separate endpoint for clarity. */
  async adminMarkInProduction(
    customOrderId: string,
  ): Promise<CustomOrderDocument> {
    const order = await this.findByIdOrThrow(customOrderId);
    if (order.status !== "paid") {
      throw new BadRequestException(
        `Cannot move to in_production — order status is "${order.status}". ` +
          `Only a paid custom order can enter production.`,
      );
    }
    order.status = "in_production";
    return order.save();
  }

  /** Admin: mark completed. */
  async adminMarkCompleted(
    customOrderId: string,
  ): Promise<CustomOrderDocument> {
    const order = await this.findByIdOrThrow(customOrderId);
    if (order.status !== "in_production") {
      throw new BadRequestException(
        `Cannot mark as completed — order status is "${order.status}". ` +
          `Only in_production orders can be completed.`,
      );
    }
    order.status = "completed";
    return order.save();
  }

  /** Link a created standard order document once payment triggers order creation. */
  async linkOrder(customOrderId: string, orderId: string): Promise<void> {
    await this.customOrderModel.findByIdAndUpdate(customOrderId, {
      linkedOrderId: orderId,
    });
  }

  // ─── Admin: list / get ────────────────────────────────────────────────────

  async adminFindAll(
    query: CustomOrderQueryDto,
  ): Promise<PaginatedResult<CustomOrderDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.email) filter.customerEmail = query.email.toLowerCase().trim();

    const [items, total] = await Promise.all([
      this.customOrderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit ?? 20)
        .lean(),
      this.customOrderModel.countDocuments(filter),
    ]);

    return paginate(
      items as unknown as CustomOrderDocument[],
      total,
      query as any,
    );
  }

  async adminFindOne(customOrderId: string): Promise<CustomOrderDocument> {
    return this.findByIdOrThrow(customOrderId);
  }

  // ─── Lookup by reference (used by payment webhook) ────────────────────────

  async findByPaymentReference(
    ref: string,
  ): Promise<CustomOrderDocument | null> {
    return this.customOrderModel.findOne({ paymentReference: ref });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findByIdOrThrow(id: string): Promise<CustomOrderDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException("Custom order not found");
    const order = await this.customOrderModel.findById(id);
    if (!order) throw new NotFoundException("Custom order not found");
    return order;
  }

  private async nextReferenceNumber(): Promise<string> {
    const last = await this.customOrderModel
      .findOne()
      .sort({ createdAt: -1 })
      .select("referenceNumber")
      .lean();
    const lastNum = last
      ? parseInt(last.referenceNumber.replace("CO-", ""), 10)
      : 1000;
    return `CO-${lastNum + 1}`;
  }

  private generatePaymentReference(referenceNumber: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `${referenceNumber}-${ts}-${rand}`;
  }

  // ─── Payment initialization (Paystack / Flutterwave) ─────────────────────

  private async initializePayment(
    order: CustomOrderDocument,
    provider: "paystack" | "flutterwave",
    paymentReference: string,
  ): Promise<string> {
    const storefrontUrl = this.config.get<string>(
      "storefront.baseUrl",
      "http://localhost:3000",
    );
    const callbackUrl = `${storefrontUrl}/custom-orders/confirm?ref=${paymentReference}`;
    const orderId = (order._id as unknown as Types.ObjectId).toString();

    if (provider === "paystack") {
      return this.initializePaystack(
        order,
        paymentReference,
        callbackUrl,
        orderId,
      );
    }
    return this.initializeFlutterwave(
      order,
      paymentReference,
      callbackUrl,
      orderId,
    );
  }

  private async initializePaystack(
    order: CustomOrderDocument,
    reference: string,
    callbackUrl: string,
    orderId: string,
  ): Promise<string> {
    const secretKey = this.config.get<string>("paystack.secretKey");
    const body = JSON.stringify({
      email: order.customerEmail,
      amount: Math.round((order.quotedPrice ?? 0) * 100), // kobo
      reference,
      callback_url: callbackUrl,
      metadata: {
        orderId,
        customOrderRef: order.referenceNumber,
        orderType: "custom",
      },
    });

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      throw new BadRequestException(
        "Paystack payment initialization failed for custom order",
      );
    }

    const data = (await res.json()) as {
      status: boolean;
      data: { authorization_url: string };
    };
    return data.data.authorization_url;
  }

  private async initializeFlutterwave(
    order: CustomOrderDocument,
    reference: string,
    redirectUrl: string,
    orderId: string,
  ): Promise<string> {
    const secretKey = this.config.get<string>("flutterwave.secretKey");
    const body = JSON.stringify({
      tx_ref: reference,
      amount: order.quotedPrice,
      currency: "NGN",
      redirect_url: redirectUrl,
      customer: {
        email: order.customerEmail,
        name: order.customerName,
        phonenumber: order.customerPhone ?? undefined,
      },
      meta: {
        orderId,
        customOrderRef: order.referenceNumber,
        orderType: "custom",
      },
    });

    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      throw new BadRequestException(
        "Flutterwave payment initialization failed for custom order",
      );
    }

    const data = (await res.json()) as {
      status: string;
      data: { link: string };
    };
    return data.data.link;
  }
}
