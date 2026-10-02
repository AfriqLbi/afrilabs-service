import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MeasurementFieldDto } from "../../measurement-profile/dto/measurement-profile.dto";

// ─── Inline measurement block (used when no saved profile is referenced) ──────

export class InlineMeasurementDto {
  @ApiPropertyOptional({
    example: "64b1f2c8e3b7a900120d1234",
    description:
      "ID of a previously saved measurement profile. " +
      "If provided, the service copies the fields from that profile. " +
      "Either this OR `measurements` must be supplied — not both.",
  })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiProperty({
    example: "aso-oke-jacket",
    description: "Garment type — should match the product category or a descriptive slug.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  garmentType: string;

  @ApiPropertyOptional({ example: "Aso Oke Jacket" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  garmentLabel?: string;

  @ApiPropertyOptional({
    type: [MeasurementFieldDto],
    description:
      "Inline measurement fields. Required when profileId is NOT supplied. " +
      "Each value must be > 0 and ≤ 400 cm.",
    example: [
      { key: "chest", label: "Chest (cm)", value: 98 },
      { key: "shoulder", label: "Shoulder (cm)", value: 46 },
      { key: "length", label: "Length (cm)", value: 72 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementFieldDto)
  measurements?: MeasurementFieldDto[];
}

// ─── Submit custom order request (guest or authenticated) ─────────────────────

export class SubmitCustomOrderDto {
  // Customer identity — required for guest (no JWT); ignored when authenticated.
  @ApiPropertyOptional({
    example: "Chioma Okafor",
    description: "Required when submitting as a guest (no auth token).",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({
    example: "chioma@example.com",
    description: "Required when submitting as a guest.",
  })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ example: "+2348099887766" })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-]{7,20}$/, { message: "Invalid phone number format" })
  customerPhone?: string;

  // ─── Request details ────────────────────────────────────────────────────

  @ApiProperty({
    example:
      "I need a custom Aso Oke jacket for my brother's wedding. " +
      "I'd like a navy blue base with gold trim, padded shoulders, double-breasted.",
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: "Please describe your order in at least 20 characters" })
  @MaxLength(2000)
  description: string;

  @ApiProperty({
    example: "Aso Oke Jacket",
    description: "Garment category from the catalogue, e.g. 'Cargo Pants', 'Aso Oke Gown'.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  garmentCategory: string;

  @ApiPropertyOptional({ example: "Aso Oke — blue and gold", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fabricChoice?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Cloudinary URLs of reference images already uploaded via /v1/admin/media.",
    example: ["https://res.cloudinary.com/labi/image/upload/v1/custom/ref1.jpg"],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: "Each reference image must be a valid URL" })
  referenceImages?: string[];

  // ─── Measurements ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    type: InlineMeasurementDto,
    description:
      "Measurement data for the garment. Provide either a saved profileId or " +
      "inline measurements array. Omit entirely if the customer will supply " +
      "measurements separately via WhatsApp or in-person.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineMeasurementDto)
  measurement?: InlineMeasurementDto;
}

// ─── Admin: set quote ─────────────────────────────────────────────────────────

export class AdminQuoteCustomOrderDto {
  @ApiProperty({
    example: 85000,
    description: "Quoted price in NGN kobo… actually full Naira. Min 100.",
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(100, { message: "Quoted price must be at least ₦100" })
  @Max(10_000_000, { message: "Quoted price exceeds maximum allowed value" })
  quotedPrice: number;

  @ApiProperty({
    example: "2026-09-20",
    description: "Estimated ready date (ISO-8601 date string, e.g. 2026-09-20).",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "estimatedReadyDate must be a valid date in YYYY-MM-DD format",
  })
  estimatedReadyDate: string;

  @ApiPropertyOptional({
    example:
      "Price includes Aso Oke fabric sourcing, 3 fittings, and complimentary alterations within 30 days.",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminQuoteNote?: string;
}

// ─── Customer: approve quote and select payment provider ──────────────────────

export class ApproveQuoteDto {
  @ApiProperty({
    enum: ["paystack", "flutterwave"],
    example: "paystack",
    description: "Payment gateway to use for the deposit/full payment.",
  })
  @IsEnum(["paystack", "flutterwave"])
  paymentProvider: "paystack" | "flutterwave";
}

// ─── Admin: cancel / refund ───────────────────────────────────────────────────

export class AdminUpdateCustomOrderStatusDto {
  @ApiProperty({
    enum: ["cancelled", "refunded"],
    description: "Admin-initiated terminal status transition.",
  })
  @IsEnum(["cancelled", "refunded"])
  status: "cancelled" | "refunded";

  @ApiPropertyOptional({ example: "Customer requested cancellation via WhatsApp.", maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ─── Query (admin list) ───────────────────────────────────────────────────────

export class CustomOrderQueryDto {
  @ApiPropertyOptional({
    enum: [
      "pending_review",
      "quoted",
      "approved",
      "payment_pending",
      "paid",
      "in_production",
      "completed",
      "cancelled",
      "refunded",
    ],
  })
  @IsOptional()
  @IsEnum([
    "pending_review",
    "quoted",
    "approved",
    "payment_pending",
    "paid",
    "in_production",
    "completed",
    "cancelled",
    "refunded",
  ])
  status?: string;

  @ApiPropertyOptional({ example: "chioma@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  get skip(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 20);
  }
}
