import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ─── Estimate ─────────────────────────────────────────────────────────────────

export class EstimateAddressDto {
  @ApiProperty({
    example: "NG",
    description: "ISO 3166-1 alpha-2 country code",
  })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiPropertyOptional({ example: "LA", description: "State/region code" })
  @IsOptional()
  @IsString()
  state?: string;
}

export class ShippingEstimateDto {
  @ApiProperty({ type: EstimateAddressDto })
  @ValidateNested()
  @Type(() => EstimateAddressDto)
  address: EstimateAddressDto;

  @ApiPropertyOptional({
    example: false,
    description: "Customer selected pickup instead of delivery",
  })
  @IsOptional()
  @IsBoolean()
  pickup?: boolean;

  @ApiPropertyOptional({
    example: "64a1f2c8e3b7a900120d3333",
    description:
      "Cart ObjectId — used to compute chargeable weight and subtotal. " +
      "If omitted, weight defaults to 0.",
  })
  @IsOptional()
  @IsString()
  cartId?: string;
}

// ─── Quote submission (admin) ─────────────────────────────────────────────────

export class SubmitQuoteDto {
  @ApiProperty({
    example: 4500000,
    description: "Shipping fee in minor units of the order currency",
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount: number;

  @ApiProperty({
    example: "NGN",
    description: "ISO 4217 — must match the order's chargeCurrency",
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiPropertyOptional({ example: "DHL Express" })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ example: 5, description: "Estimated delivery days" })
  @IsOptional()
  @IsInt()
  @Min(1)
  etaDays?: number;

  @ApiPropertyOptional({
    example: "Includes customs clearance to your address.",
    description: "Note shown to the customer in the payment email",
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: 7,
    description: "Days until the quote expires (default: 7)",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  validDays?: number;
}

// ─── Override (admin) ─────────────────────────────────────────────────────────

export class OverrideShippingFeeDto {
  @ApiProperty({ example: 2500000 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amount: number;

  @ApiProperty({ example: "Customer loyalty discount applied" })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ─── Zone CRUD (admin) ────────────────────────────────────────────────────────

export class RateBandDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  minGrams: number;

  @ApiProperty({ example: 1000 })
  @IsInt()
  @Min(1)
  maxGrams: number;

  @ApiProperty({ example: 150000, description: "Fee in NGN kobo" })
  @IsInt()
  @Min(0)
  feeNgn: number;
}

export class EstimateRangeDto {
  @ApiProperty({ example: 4500000, description: "Min estimate in NGN kobo" })
  @IsInt()
  @Min(0)
  minNgn: number;

  @ApiProperty({ example: 7000000, description: "Max estimate in NGN kobo" })
  @IsInt()
  @Min(0)
  maxNgn: number;
}

export class CreateZoneDto {
  @ApiProperty({ example: "Lagos" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ["fixed", "quote"], example: "fixed" })
  @IsEnum(["fixed", "quote"])
  mode: "fixed" | "quote";

  @ApiProperty({
    example: ["NG"],
    description: "ISO 3166-1 alpha-2 country codes",
  })
  @IsArray()
  @IsString({ each: true })
  countries: string[];

  @ApiPropertyOptional({
    example: ["LA"],
    description: "State codes within the listed countries",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  states?: string[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFallback?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [RateBandDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBandDto)
  rates?: RateBandDto[];

  @ApiPropertyOptional({
    example: 200000,
    description: "Flat fee in NGN kobo (used when no bands cover the weight)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  flatFeeNgn?: number;

  @ApiPropertyOptional({
    example: 10000000,
    description: "Item subtotal threshold for free shipping (NGN kobo)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeOverNgn?: number;

  @ApiPropertyOptional({ type: EstimateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EstimateRangeDto)
  estimateRange?: EstimateRangeDto;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  etaMinDays?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  etaMaxDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  pickupAvailable?: boolean;

  @ApiPropertyOptional({ example: "Import duties are payable on delivery." })
  @IsOptional()
  @IsString()
  customerNote?: string;
}

// ─── Settings (admin) ────────────────────────────────────────────────────────

export class UpdateShippingSettingsDto {
  @ApiPropertyOptional({
    example: 48,
    description: "Hours within which an admin must submit a quote",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quoteSlaHours?: number;

  @ApiPropertyOptional({
    example: 7,
    description: "Default validity window (days)",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quoteValidDays?: number;

  @ApiPropertyOptional({ example: "admin@labi.ng, ops@labi.ng" })
  @IsOptional()
  @IsString()
  adminAlertEmails?: string;

  @ApiPropertyOptional({
    example: 50000000,
    description: "Quote amount cap in NGN kobo",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountCapNgn?: number;
}

export class UpdateZoneDto {
  @ApiPropertyOptional({ example: "Lagos Updated" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: ["fixed", "quote"] })
  @IsOptional()
  @IsEnum(["fixed", "quote"])
  mode?: "fixed" | "quote";

  @ApiPropertyOptional({ example: ["NG"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @ApiPropertyOptional({ example: ["LA"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  states?: string[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFallback?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [RateBandDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBandDto)
  rates?: RateBandDto[];

  @ApiPropertyOptional({ example: 200000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  flatFeeNgn?: number;

  @ApiPropertyOptional({ example: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeOverNgn?: number;

  @ApiPropertyOptional({ type: EstimateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EstimateRangeDto)
  estimateRange?: EstimateRangeDto;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  etaMinDays?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  etaMaxDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  pickupAvailable?: boolean;

  @ApiPropertyOptional({ example: "Import duties are payable on delivery." })
  @IsOptional()
  @IsString()
  customerNote?: string;
}
