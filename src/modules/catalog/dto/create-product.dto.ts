import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProductTag, ProductStatus } from "../schemas/product.schema";

export class SpecInputDto {
  @ApiProperty({ example: "Screen Size" })
  @IsString()
  @IsNotEmpty()
  label: string;
  @ApiProperty({ example: '55"' }) @IsString() @IsNotEmpty() value: string;
}

export class PackageDimsDto {
  @ApiProperty({ example: 60, description: "Length in cm" })
  @IsNumber()
  @Min(0)
  l: number;

  @ApiProperty({ example: 40, description: "Width in cm" })
  @IsNumber()
  @Min(0)
  w: number;

  @ApiProperty({ example: 10, description: "Height in cm" })
  @IsNumber()
  @Min(0)
  h: number;
}

export class CreateProductDto {
  @ApiProperty({
    example: "AV-1000",
    description: "Unique SKU — immutable once set",
  })
  @IsString()
  @IsNotEmpty()
  sku: string;

  @ApiProperty({ example: 'Hisense 55" 4K UHD Smart TV A6K' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: "64a1f2c8e3b7a900120d5678",
    description: "Brand ObjectId",
  })
  @IsString()
  @IsNotEmpty()
  brandId: string;

  @ApiProperty({
    example: "64a1f2c8e3b7a900120d4321",
    description: "Category ObjectId",
  })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiPropertyOptional({
    example: "s2",
    description: "Subcategory id from the category's subcategories array",
  })
  @IsOptional()
  @IsString()
  subcategoryId?: string;

  @ApiProperty({ example: 585000, description: "Base price in NGN" })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 699000,
    description: 'Crossed-out "was" price in NGN',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiPropertyOptional({ example: 24, description: "Starting stock quantity" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ["https://res.cloudinary.com/..."],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ example: "Built for Nigerian homes..." })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: "<p>Built for Nigerian homes...</p>" })
  @IsOptional()
  @IsString()
  descriptionHtml?: string;

  @ApiPropertyOptional({ type: [SpecInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecInputDto)
  specs?: SpecInputDto[];

  @ApiPropertyOptional({
    enum: ["active", "draft", "archived"],
    default: "draft",
  })
  @IsOptional()
  @IsEnum(["active", "draft", "archived"])
  status?: ProductStatus;

  @ApiPropertyOptional({
    type: [String],
    enum: ["new_arrival", "best_seller", "featured", "deal"],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(["new_arrival", "best_seller", "featured", "deal"], { each: true })
  tags?: ProductTag[];

  // ── Shipping weight / dimensions ───────────────────────────────────────────

  @ApiPropertyOptional({
    example: 850,
    description:
      "Packed weight in grams. Required for accurate shipping fee calculation.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  packageWeightGrams?: number;

  @ApiPropertyOptional({
    type: PackageDimsDto,
    description:
      "Outer packed dimensions in cm (l × w × h). Used for volumetric weight.",
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PackageDimsDto)
  packageDims?: PackageDimsDto;
}
