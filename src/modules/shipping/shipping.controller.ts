import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiForbiddenResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ShippingResolverService,
  CartLineWeight,
} from "./shipping-resolver.service";
import { ShippingQuoteService } from "./shipping-quote.service";
import { ShippingZoneService } from "./shipping-zone.service";
import {
  ShippingEstimateDto,
  SubmitQuoteDto,
  OverrideShippingFeeDto,
  CreateZoneDto,
  UpdateZoneDto,
  UpdateShippingSettingsDto,
} from "./dto/shipping.dto";
import {
  OptionalJwtAuthGuard,
  JwtAuthGuard,
} from "../../common/guards/jwt-auth.guard";
import { CartService } from "../cart/cart.service";
import { ShippingSettingsService } from "./shipping-settings.service";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/strategies/jwt.strategy";
import {
  ApiEnvelopeOk,
  ApiErrorResponse,
} from "../../common/swagger/api-response.decorator";

// ─── Customer: Shipping estimate ──────────────────────────────────────────────

@ApiTags("Shipping")
@Controller({ path: "shipping", version: "1" })
export class ShippingController {
  constructor(
    private readonly resolver: ShippingResolverService,
    private readonly quoteService: ShippingQuoteService,
    private readonly cartService: CartService,
  ) {}

  /**
   * POST /v1/shipping/estimate
   *
   * Returns the shipping fee estimate for the current session cart + the given
   * address. Uses the server-side cart resolved from the auth cookie or guestId.
   *
   * Possible statuses:
   *   CALCULATED    — fee computed automatically from the rate card
   *   QUOTE_REQUIRED — zone is quote-mode; admin will set the fee after order is placed
   *   PICKUP        — customer selected pickup and zone supports it; fee = 0
   *   NO_ZONE       — no configured zone for this destination
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Post("estimate")
  @ApiOperation({
    summary: "Estimate shipping fee for a destination",
    description:
      "Body: `{ address: { country, state }, pickup? }`. " +
      "Returns CALCULATED, QUOTE_REQUIRED, PICKUP, or NO_ZONE. " +
      "All monetary values are in the smallest unit of NGN (kobo).",
  })
  @ApiBadRequestResponse({
    description: "Validation error",
    type: ApiErrorResponse,
  })
  async estimate(
    @Body() dto: ShippingEstimateDto,
    @CurrentUser() _user: JwtPayload | undefined,
  ) {
    // Resolve cart lines for weight-based fee calculation
    let items: CartLineWeight[] = [];
    let subtotalNgn = 0;

    if (dto.cartId) {
      const cart = await this.cartService.getCartById(dto.cartId);
      if (cart) {
        items = cart.lines.map((l) => ({
          weightGrams: l.weightGrams ?? 0,
          dims: l.dims ?? { l: 0, w: 0, h: 0 },
          qty: l.quantity,
        }));
        // Cart subtotal is in NGN naira; convert to kobo for comparison
        // against zone.freeOverNgn (stored in kobo).
        const subtotalNaira = cart.lines.reduce(
          (s, l) => s + l.unitPrice * l.quantity,
          0,
        );
        subtotalNgn = Math.round(subtotalNaira * 100);
      }
    }

    const result = await this.resolver.estimate({
      country: dto.address.country,
      state: dto.address.state,
      items,
      subtotalNgn,
      pickup: dto.pickup,
    });

    if (result.status === "NO_ZONE") {
      return {
        status: "NO_ZONE",
        message:
          "Shipping to this destination is not yet configured. " +
          "Please contact us via WhatsApp for a shipping quote.",
      };
    }

    if (result.status === "QUOTE_REQUIRED") {
      return {
        status: "QUOTE_REQUIRED",
        zone: result.zone?.name,
        message: `Shipping to ${result.zone?.name ?? dto.address.country} is quoted per order. An admin will set the fee after you place your order.`,
        estimateRange: result.estimateRange ?? null,
        etaDays: result.etaDays ?? null,
        customerNote: result.zone?.customerNote ?? null,
      };
    }

    if (result.status === "PICKUP") {
      return {
        status: "PICKUP",
        zone: result.zone?.name,
        fee: { currency: "NGN", amount: 0 },
        source: "pickup",
        etaDays: result.etaDays ?? null,
      };
    }

    // CALCULATED
    return {
      status: "CALCULATED",
      zone: result.zone?.name,
      fee: { currency: "NGN", amount: result.feeNgn },
      source: result.source,
      chargeableWeightGrams: result.chargeableWeightGrams,
      etaDays: result.etaDays ?? null,
      customerNote: result.zone?.customerNote ?? null,
    };
  }
}

// ─── Admin: Shipping zones + quotes ──────────────────────────────────────────

class AdminQuotesQueryDto {
  @ApiPropertyOptional({
    example: "AWAITING_QUOTE",
    enum: ["AWAITING_QUOTE", "QUOTED", "EXPIRED"],
  })
  @IsOptional()
  @IsString()
  state?: string;
}

@ApiTags("Admin — Shipping")
@ApiBearerAuth()
@Controller({ path: "admin/shipping", version: "1" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "merchandiser", "support_agent")
@ApiForbiddenResponse({
  description: "Insufficient role",
  type: ApiErrorResponse,
})
export class AdminShippingController {
  constructor(
    private readonly resolver: ShippingResolverService,
    private readonly quoteService: ShippingQuoteService,
    private readonly zoneService: ShippingZoneService,
    private readonly settingsService: ShippingSettingsService,
  ) {}

  // ── Zone CRUD ──────────────────────────────────────────────────────────────

  @Get("zones")
  @ApiOperation({ summary: "[Admin] List all shipping zones" })
  listZones() {
    return this.zoneService.listAll();
  }

  @Post("zones")
  @ApiOperation({ summary: "[Admin] Create a shipping zone" })
  @ApiBadRequestResponse({
    description: "Validation error",
    type: ApiErrorResponse,
  })
  createZone(@Body() dto: CreateZoneDto, @CurrentUser() actor: JwtPayload) {
    return this.zoneService.create(dto, actor.sub);
  }

  @Patch("zones/:id")
  @ApiOperation({ summary: "[Admin] Update a shipping zone" })
  @ApiParam({ name: "id", description: "Zone ObjectId" })
  @ApiNotFoundResponse({
    description: "Zone not found",
    type: ApiErrorResponse,
  })
  updateZone(
    @Param("id") id: string,
    @Body() dto: UpdateZoneDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.zoneService.update(id, dto, actor.sub);
  }

  @Delete("zones/:id")
  @Roles("super_admin")
  @ApiOperation({ summary: "[Admin] Delete a shipping zone" })
  @ApiParam({ name: "id", description: "Zone ObjectId" })
  @ApiNotFoundResponse({
    description: "Zone not found",
    type: ApiErrorResponse,
  })
  deleteZone(@Param("id") id: string, @CurrentUser() actor: JwtPayload) {
    return this.zoneService.remove(id, actor.sub);
  }

  // ── Quote queue ────────────────────────────────────────────────────────────

  @Get("quotes")
  @ApiOperation({
    summary: "[Admin] List orders awaiting a shipping quote",
    description:
      "Returns orders with shippingStatus=AWAITING_QUOTE, oldest first.",
  })
  @ApiQuery({
    name: "state",
    required: false,
    enum: ["AWAITING_QUOTE", "QUOTED", "EXPIRED"],
  })
  listQuotes(@Query() query: AdminQuotesQueryDto) {
    return this.quoteService.listPendingQuotes(query.state);
  }

  // ── Quote submission ───────────────────────────────────────────────────────

  @Post("orders/:id/quote")
  @ApiOperation({
    summary: "[Admin] Submit a shipping quote for an order",
    description:
      "Sets the shipping fee, moves the order to PENDING_PAYMENT, and " +
      "enqueues a customer notification email with a payment link.",
  })
  @ApiParam({ name: "id", description: "Order ObjectId" })
  @ApiBadRequestResponse({
    description: "Order not in AWAITING_QUOTE state",
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description: "Order not found",
    type: ApiErrorResponse,
  })
  submitQuote(
    @Param("id") id: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.quoteService.submitQuote(id, dto, actor.sub);
  }

  // ── Override ───────────────────────────────────────────────────────────────

  @Patch("orders/:id/shipping-fee")
  @ApiOperation({
    summary: "[Admin] Override shipping fee on an unpaid order",
    description: "Requires a reason. Recomputes chargeTotal. Audit-logged.",
  })
  @ApiParam({ name: "id", description: "Order ObjectId" })
  @ApiBadRequestResponse({
    description: "Order already paid/closed",
    type: ApiErrorResponse,
  })
  overrideFee(
    @Param("id") id: string,
    @Body() dto: OverrideShippingFeeDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.quoteService.override(id, dto, actor.sub);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  @Get("settings")
  @ApiOperation({ summary: "[Admin] Get shipping settings" })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Patch("settings")
  @ApiOperation({ summary: "[Admin] Update shipping settings" })
  @ApiBody({ type: UpdateShippingSettingsDto })
  updateSettings(@Body() dto: UpdateShippingSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
