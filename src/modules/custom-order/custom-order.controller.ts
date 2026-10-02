import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/strategies/jwt.strategy";
import {
  ApiEnvelopeCreated,
  ApiEnvelopeOk,
  ApiPaginatedOk,
} from "../../common/swagger/api-response.decorator";
import { CustomOrderService } from "./custom-order.service";
import {
  AdminQuoteCustomOrderDto,
  AdminUpdateCustomOrderStatusDto,
  ApproveQuoteDto,
  CustomOrderQueryDto,
  SubmitCustomOrderDto,
} from "./dto/custom-order.dto";
import {
  CustomOrderResponseDto,
  InitializeCustomOrderPaymentResponseDto,
} from "./dto/custom-order-response.dto";

// ─── Customer-facing controller ───────────────────────────────────────────────

@ApiTags("Custom Orders")
@Controller("custom-orders")
export class CustomOrderController {
  constructor(private readonly service: CustomOrderService) {}

  /**
   * Submit a new custom order request.
   * Guest-accessible: no auth token required. Authenticated users' name/email
   * are pulled from the JWT payload; guests must provide them in the body.
   */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Submit a custom order request (guest or authenticated)",
    description:
      "Starts Flow 2 from the PRD. Guests must supply customerName + customerEmail. " +
      "Authenticated users' identity is taken from the JWT. Measurements are optional " +
      "at submission — can be supplied via WhatsApp or in-person.",
  })
  @ApiEnvelopeCreated(CustomOrderResponseDto)
  async submit(
    @Body() dto: SubmitCustomOrderDto,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.service.submit(
      dto,
      user?.sub ?? null,
      user?.email ?? null,
      null, // name resolved inside service from dto
    );
  }

  /** List own custom orders (authenticated only). */
  @Get("mine")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's custom orders" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiPaginatedOk(CustomOrderResponseDto)
  async findMine(
    @CurrentUser() user: JwtPayload,
    @Query("page") page = 1,
    @Query("limit") limit = 20,
  ) {
    return this.service.findByCustomer(user.sub, +page, +limit);
  }

  /** Get a single custom order by ID (must belong to the current user). */
  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a single custom order (must belong to current user)" })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async findOne(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.service.findOneByCustomer(id, user.sub);
  }

  /**
   * Approve quote + initialize payment.
   * BUSINESS RULE: status moves to payment_pending; paid only after webhook.
   */
  @Post(":id/approve")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Approve the admin quote and initialize payment",
    description:
      "PRD Flow 2, step 4. Transitions custom order to payment_pending and returns a " +
      "hosted checkout URL. The order only enters production after the payment webhook " +
      "confirms the transaction — never on redirect.",
  })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(InitializeCustomOrderPaymentResponseDto)
  async approveQuote(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: ApproveQuoteDto,
  ) {
    return this.service.approveQuoteAndInitializePayment(id, user.sub, dto);
  }
}

// ─── Admin controller ─────────────────────────────────────────────────────────

@ApiTags("Admin — Custom Orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "merchandiser")
@Controller("admin/custom-orders")
export class AdminCustomOrderController {
  constructor(private readonly service: CustomOrderService) {}

  @Get()
  @ApiOperation({
    summary: "Admin: list all custom orders",
    description: "Filterable by status and customer email. Paginated.",
  })
  @ApiPaginatedOk(CustomOrderResponseDto)
  async findAll(@Query() query: CustomOrderQueryDto) {
    return this.service.adminFindAll(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Admin: get a single custom order" })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async findOne(@Param("id") id: string) {
    return this.service.adminFindOne(id);
  }

  /**
   * Set the price quote and estimated ready date.
   * PRD Flow 2, step 3.
   */
  @Patch(":id/quote")
  @ApiOperation({
    summary: "Admin: set a price quote and timeline",
    description:
      "PRD Flow 2, step 3. Moves status from pending_review → quoted. " +
      "Customer is notified separately (email / WhatsApp).",
  })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async setQuote(
    @CurrentUser() admin: JwtPayload,
    @Param("id") id: string,
    @Body() dto: AdminQuoteCustomOrderDto,
  ) {
    return this.service.adminSetQuote(id, admin.sub, dto);
  }

  /**
   * Move a paid order into the production queue.
   * BUSINESS RULE: only possible after status === 'paid' (webhook-confirmed).
   */
  @Patch(":id/production")
  @ApiOperation({
    summary: "Admin: move a paid custom order into production",
    description:
      "BUSINESS RULE: only callable when status is 'paid' (i.e. payment confirmed via " +
      "webhook). Transitions status to in_production.",
  })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async markInProduction(@Param("id") id: string) {
    return this.service.adminMarkInProduction(id);
  }

  /** Mark a custom order as completed (quality check passed). */
  @Patch(":id/complete")
  @ApiOperation({ summary: "Admin: mark custom order as completed" })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async markCompleted(@Param("id") id: string) {
    return this.service.adminMarkCompleted(id);
  }

  /** Cancel or refund a custom order. */
  @Patch(":id/status")
  @Roles("super_admin") // only super_admin can cancel/refund
  @ApiOperation({ summary: "Admin: cancel or refund a custom order" })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: AdminUpdateCustomOrderStatusDto,
  ) {
    return this.service.adminUpdateStatus(id, dto);
  }
}

// ─── Staff controller (production/ops) ───────────────────────────────────────

@ApiTags("Staff — Custom Orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff")
@Controller("staff/custom-orders")
export class StaffCustomOrderController {
  constructor(private readonly service: CustomOrderService) {}

  /**
   * Staff can only see orders that are in_production or completed —
   * not pending quotes, payment details, or customer PII beyond what's
   * needed to do the work.
   */
  @Get()
  @ApiOperation({
    summary: "Staff: list in-production and completed custom orders",
    description:
      "Scoped to in_production and completed statuses. Staff cannot see " +
      "pending_review, quoted, approved, or payment data.",
  })
  @ApiPaginatedOk(CustomOrderResponseDto)
  async findProductionQueue(@Query() query: CustomOrderQueryDto) {
    // Override query status to only return production-relevant entries
    const scopedQuery: CustomOrderQueryDto = Object.assign(new CustomOrderQueryDto(), query, {
      status: ["in_production", "completed"].includes(query.status ?? "")
        ? query.status
        : "in_production",
    });
    return this.service.adminFindAll(scopedQuery);
  }

  @Get(":id")
  @ApiOperation({ summary: "Staff: get a single custom order" })
  @ApiParam({ name: "id", description: "Custom order MongoDB ObjectId" })
  @ApiEnvelopeOk(CustomOrderResponseDto)
  async findOne(@Param("id") id: string) {
    const order = await this.service.adminFindOne(id);
    // Guard: staff should not access pre-production orders
    if (!["in_production", "completed"].includes(order.status)) {
      throw new Error("Access denied to this order at its current stage");
    }
    return order;
  }
}
