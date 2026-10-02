import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProductionStage } from "../schemas/production-log.schema";

export class UpdateProductionStageDto {
  @ApiProperty({
    enum: ["cutting", "sewing", "quality_check", "ready", "delivered"],
    example: "sewing",
    description:
      "Production stage to advance to. Must follow the defined order: " +
      "cutting → sewing → quality_check → ready → delivered. " +
      "Skipping stages is allowed (e.g. marking 'ready' directly if the item " +
      "was already in stock).",
  })
  @IsEnum(["cutting", "sewing", "quality_check", "ready", "delivered"])
  stage: ProductionStage;

  @ApiPropertyOptional({
    example: "Fabric cutting completed. Ready for stitching tomorrow.",
    maxLength: 500,
    description: "Optional note (v1: text only, no photo upload).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ProductionLogResponseDto {
  @ApiProperty({ example: "64b1f2c8e3b7a900120d0001" }) _id: string;
  @ApiProperty({ example: "64b1f2c8e3b7a900120d9999" }) orderId: string;
  @ApiProperty({ enum: ["order", "custom_order"], example: "custom_order" }) orderType: string;
  @ApiProperty({ example: "CO-1001" }) orderReference: string;
  @ApiProperty({ enum: ["cutting", "sewing", "quality_check", "ready", "delivered"], example: "sewing" }) stage: string;
  @ApiProperty({ example: "64a1f2c8e3b7a900120d5678" }) updatedBy: string;
  @ApiPropertyOptional({ example: "Chidinma" }) updatedByName: string | null;
  @ApiPropertyOptional({ example: "Fabric cutting completed." }) note: string | null;
  @ApiProperty({ example: "2026-07-01T09:00:00.000Z" }) createdAt: string;
}

export class CurrentStageResponseDto {
  @ApiProperty({ example: "sewing" }) currentStage: string | null;
  @ApiProperty({ type: [ProductionLogResponseDto] }) history: ProductionLogResponseDto[];
}
