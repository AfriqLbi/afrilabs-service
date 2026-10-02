import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CurrencyRateItemDto {
  @ApiProperty({ example: "USD" })
  currency: string;

  @ApiProperty({
    example: 0.000645,
    description: "1 NGN = this many units of the currency",
  })
  rate: number;

  @ApiProperty({ example: "$" })
  symbol: string;

  @ApiProperty({ example: "🇺🇸" })
  flag: string;
}

export class GeoContextDto {
  @ApiProperty({
    example: "NG",
    description: "ISO 3166-1 alpha-2 detected country code",
  })
  country: string;

  @ApiProperty({
    example: "NGN",
    description: "Suggested display/charge currency for this visitor",
  })
  currency: string;

  @ApiProperty({
    type: [CurrencyRateItemDto],
    description: "All supported currency rates (NGN base)",
  })
  rates: CurrencyRateItemDto[];

  @ApiProperty({
    type: [String],
    example: ["NGN", "USD", "GBP"],
    description: "Currencies enabled for checkout in CurrencyConfig",
  })
  enabledCurrencies: string[];

  @ApiProperty({
    example: 2,
    description: "FX buffer % from CurrencyConfig (e.g. 2 = 2%)",
  })
  fxBuffer: number;

  @ApiPropertyOptional({
    example: true,
    description:
      "Present and true when any FX rate is older than staleRateThresholdMinutes",
  })
  staleRates?: boolean;
}
