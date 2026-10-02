import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "Adaeze Okonkwo", maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: "adaeze@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "StrongPass123!", minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @ApiPropertyOptional({
    example: "+2348011223344",
    description: "Nigerian phone number (optional at registration)",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-]{7,20}$/, { message: "Invalid phone number format" })
  phone?: string;
}
