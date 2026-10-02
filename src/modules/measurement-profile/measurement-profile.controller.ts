import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/strategies/jwt.strategy";
import {
  ApiEnvelopeCreated,
  ApiEnvelopeOk,
} from "../../common/swagger/api-response.decorator";
import { MeasurementProfileService } from "./measurement-profile.service";
import {
  CreateMeasurementProfileDto,
  UpdateMeasurementProfileDto,
} from "./dto/measurement-profile.dto";
import { MeasurementProfileResponseDto } from "./dto/measurement-profile-response.dto";

@ApiTags("Measurements")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("measurements")
export class MeasurementProfileController {
  constructor(private readonly service: MeasurementProfileService) {}

  // ─── Customer endpoints ────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: "Create a new measurement profile",
    description:
      "Creates a profile for a specific garment type. One profile per (user, garmentType) pair. " +
      "All measurement values must be > 0 and ≤ 400 cm.",
  })
  @ApiEnvelopeCreated(MeasurementProfileResponseDto)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMeasurementProfileDto,
  ) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: "List all measurement profiles for the current user" })
  @ApiEnvelopeOk(MeasurementProfileResponseDto, true)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAllByUser(user.sub);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single measurement profile by ID" })
  @ApiParam({ name: "id", description: "Measurement profile MongoDB ObjectId" })
  @ApiEnvelopeOk(MeasurementProfileResponseDto)
  async findOne(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.service.findOneByUser(user.sub, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a measurement profile",
    description: "All fields optional. Replaces the entire measurements array if provided.",
  })
  @ApiParam({ name: "id", description: "Measurement profile MongoDB ObjectId" })
  @ApiEnvelopeOk(MeasurementProfileResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdateMeasurementProfileDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a measurement profile" })
  @ApiParam({ name: "id", description: "Measurement profile MongoDB ObjectId" })
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.service.remove(user.sub, id);
  }
}

// ─── Admin sub-controller: read any user's profiles ───────────────────────────

@ApiTags("Admin — Measurements")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "staff")
@Controller("admin/measurements")
export class AdminMeasurementController {
  constructor(private readonly service: MeasurementProfileService) {}

  @Get(":userId")
  @ApiOperation({
    summary: "Admin: list measurement profiles for any user",
    description: "Used during custom-order quote review. Requires super_admin or staff role.",
  })
  @ApiParam({ name: "userId", description: "Target user's MongoDB ObjectId" })
  @ApiEnvelopeOk(MeasurementProfileResponseDto, true)
  async findForUser(@Param("userId") userId: string) {
    return this.service.findAllByUserAdmin(userId);
  }
}
