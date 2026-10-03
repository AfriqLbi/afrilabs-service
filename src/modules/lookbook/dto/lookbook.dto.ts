import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateLookbookItemDto {
  @ApiProperty({ example: "The Harmattan Edit" })
  @IsString() @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: "Handwoven Aṣọ-Òkè meets modern silhouette." })
  @IsOptional() @IsString()
  caption?: string;

  @ApiProperty({ example: "https://res.cloudinary.com/..." })
  @IsString() @IsNotEmpty()
  imageUrl: string;

  @ApiPropertyOptional({ example: "SS 2025" })
  @IsOptional() @IsString()
  season?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  published?: boolean;
}

export class UpdateLookbookItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() caption?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() season?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() published?: boolean;
}
