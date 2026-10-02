import {
  IsEnum,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentProvider } from "../schemas/order.schema";

export class ShippingAddressDto {
  @ApiProperty({ example: "Adaeze Okonkwo" })
  @IsString()
  @IsNotEmpty()
  fullName: string;
  @ApiProperty({ example: "+2348011223344" })
  @IsString()
  @IsNotEmpty()
  phone: string;
  @ApiProperty({ example: "12 Aminu Kano Crescent" })
  @IsString()
  @IsNotEmpty()
  line1: string;
  @ApiPropertyOptional({ example: "Suite 4B" })
  @IsOptional()
  @IsString()
  line2?: string;
  @ApiProperty({ example: "Abuja" }) @IsString() @IsNotEmpty() city: string;
  @ApiProperty({ example: "FCT" }) @IsString() @IsNotEmpty() state: string;
  @ApiPropertyOptional({ example: "Nigeria", default: "Nigeria" })
  @IsOptional()
  @IsString()
  country?: string;
}

/**
 * FX snapshot captured by the frontend at checkout submission time.
 * Required for non-NGN orders so the backend can compute chargeTotal from
 * the rate the customer saw — NOT a freshly fetched rate.
 */
export class FxRateSnapshotDto {
  @ApiProperty({
    example: 0.000645,
    description: "1 NGN = this many units of chargeCurrency, at lock time",
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  rate: number;

  @ApiProperty({
    example: 2,
    description: "FX buffer % applied by CurrencyProvider (0–20)",
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(20)
  buffer: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({
    example: "64a1f2c8e3b7a900120d1111",
    description: "Cart id — items loaded from this cart",
  })
  @IsOptional()
  @IsString()
  cartId?: string;

  @ApiPropertyOptional({ example: "adaeze@example.com" })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ example: "Adaeze Okonkwo" })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiProperty({
    enum: ["paystack", "flutterwave", "stripe"],
    example: "paystack",
  })
  @IsEnum(["paystack", "flutterwave", "stripe"])
  paymentProvider: PaymentProvider;

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @ApiPropertyOptional({ example: "COOL20" })
  @IsOptional()
  @IsString()
  promoCode?: string;

  /**
   * ISO 4217 charge currency. Defaults to "NGN" server-side when absent.
   * For non-NGN orders fxRateSnapshot MUST also be provided.
   */
  @ApiPropertyOptional({
    example: "USD",
    description: "ISO 4217 charge currency. Omit for NGN.",
  })
  @IsOptional()
  @IsString()
  chargeCurrency?: string;

  /**
   * FX rate snapshot from the CurrencyProvider context.
   * Required when chargeCurrency is not NGN.
   */
  @ApiPropertyOptional({ type: FxRateSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FxRateSnapshotDto)
  fxRateSnapshot?: FxRateSnapshotDto;
}
