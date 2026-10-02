import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
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
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/strategies/jwt.strategy";
import {
  ApiEnvelopeOk,
} from "../../common/swagger/api-response.decorator";
import { ProductionTrackingService } from "./production-tracking.service";
import {
  CurrentStageResponseDto,
  ProductionLogResponseDto,
  UpdateProductionStageDto,
} from "./dto/production-tracking.dto";
import { ProductionStage } from "./schemas/production-log.schema";

// ─── Admin + Staff shared controller ─────────────────────────────────────────

@ApiTags("Production Tracking")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("production")
export class ProductionTrackingController {
  constructor(private readonly service: ProductionTrackingService) {}

  /**
   * Update the production stage for a standard or custom order.
   * Accessible by super_admin, merchandiser, and staff.
   * Staff are allowed because their entire role is to update production status.
   */
  @Patch(":orderId/stage")
  @Roles("super_admin", "merchandiser", "staff")
  @ApiOperation({
    summary: "Update production stage for an order",
    description:
      "Appends a new stage log entry. Stages must advance forward — " +
      "cutting → sewing → quality_check → ready → delivered. " +
      "Provide orderType=custom_order for custom orders, order for standard.",
  })
  @ApiParam({ name: "orderId", description: "Order or CustomOrder MongoDB ObjectId" })
  @ApiQuery({
    name: "orderType",
    enum: ["order", "custom_order"],
    required: true,
    description: "Whether this is a standard catalog order or a custom order",
  })
  @ApiQuery({ name: "orderRef", required: true, description: "Human-readable reference (e.g. AV-2601 or CO-1001)" })
  @ApiEnvelopeOk(ProductionLogResponseDto)
  async updateStage(
    @CurrentUser() user: JwtPayload,
    @Param("orderId") orderId: string,
    @Query("orderType") orderType: "order" | "custom_order",
    @Query("orderRef") orderRef: string,
    @Body() dto: UpdateProductionStageDto,
  ) {
    if (!["order", "custom_order"].includes(orderType)) {
      throw new ForbiddenException("Invalid orderType. Must be 'order' or 'custom_order'.");
    }

    return this.service.updateStage(
      {
        orderId,
        orderType,
        orderReference: orderRef,
        updatedBy: user.sub,
        updatedByName: user.email, // name not in JWT payload; email used as display
      },
      dto,
    );
  }

  /**
   * Get full production history for an order.
   * Admin + staff can view; customers see their status via the order detail endpoint.
   */
  @Get(":orderId/history")
  @Roles("super_admin", "merchandiser", "staff")
  @ApiOperation({ summary: "Get full production history for an order" })
  @ApiParam({ name: "orderId", description: "Order or CustomOrder MongoDB ObjectId" })
  @ApiEnvelopeOk(CurrentStageResponseDto)
  async getHistory(@Param("orderId") orderId: string) {
    return this.service.getHistory(orderId);
  }

  /**
   * Admin queue view: list all orders at a given production stage.
   */
  @Get("queue")
  @Roles("super_admin", "merchandiser", "staff")
  @ApiOperation({
    summary: "Production queue: list all orders at a given stage",
    description:
      "Returns one entry per order — the latest stage log entry where " +
      "the stage matches the requested value.",
  })
  @ApiQuery({
    name: "stage",
    enum: ["cutting", "sewing", "quality_check", "ready", "delivered"],
    required: true,
  })
  @ApiQuery({
    name: "orderType",
    enum: ["order", "custom_order"],
    required: false,
  })
  @ApiEnvelopeOk(ProductionLogResponseDto, true)
  async getQueue(
    @Query("stage") stage: ProductionStage,
    @Query("orderType") orderType?: "order" | "custom_order",
  ) {
    return this.service.getOrdersAtStage(stage, orderType);
  }
}
