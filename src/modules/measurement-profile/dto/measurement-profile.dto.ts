import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";

// ─── Measurement field ─────────────────────────────────────────────────────────

export class MeasurementFieldDto {
  @ApiProperty({
    example: "bust",
    description: "Machine-readable field key, e.g. bust, waist, hip, sleeve_length",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  key: string;

  @ApiProperty({ example: "Bust (cm)", description: "Human-readable display label" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  /**
   * Value in centimetres.
   *
   * BUSINESS RULE: Measurement input validation must reject:
   *  - zero or negative values  → @Min(1)
   *  - wildly out-of-range      → @Max(400) (no realistic human measurement
   *                                exceeds 400 cm)
   *
   * Common Nigerian garment measurements typically fall in these ranges:
   *   bust/chest: 60–140 cm  |  waist: 50–130 cm  |  hip: 60–150 cm
   *   height/length: 30–250 cm  |  sleeve: 40–100 cm
   * The @Max(400) guard catches any obviously nonsensical submission while
   * remaining permissive enough for edge cases (very tall customers, long gowns).
   */
  @ApiProperty({
    example: 90,
    description:
      "Measurement value in centimetres. Must be > 0 and ≤ 400. " +
      "Zero, negative, or wildly out-of-range values are rejected.",
    minimum: 1,
    maximum: 400,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1, { message: "Measurement value must be greater than zero" })
  @Max(400, { message: "Measurement value cannot exceed 400 cm — please check the figure you entered" })
  value: number;
}

// ─── Create ────────────────────────────────────────────────────────────────────

export class CreateMeasurementProfileDto {
  @ApiProperty({
    example: "aso-oke-jacket",
    description:
      "Garment type — should match the product category slug or a descriptive name. " +
      "One profile per (user, garmentType) pair is allowed.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  garmentType: string;

  @ApiPropertyOptional({
    example: "Aso Oke Jacket",
    description: "Human-readable label shown in the UI",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  garmentLabel?: string;

  @ApiProperty({
    type: [MeasurementFieldDto],
    description: "Array of named measurement fields. At least one field is required.",
    example: [
      { key: "bust", label: "Bust (cm)", value: 92 },
      { key: "waist", label: "Waist (cm)", value: 74 },
      { key: "hip", label: "Hip (cm)", value: 98 },
      { key: "length", label: "Length (cm)", value: 120 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementFieldDto)
  measurements: MeasurementFieldDto[];

  @ApiPropertyOptional({
    example: "Prefer a little extra room around the shoulders",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── Update (all fields optional) ────────────────────────────────────────────

export class UpdateMeasurementProfileDto extends PartialType(CreateMeasurementProfileDto) {}
