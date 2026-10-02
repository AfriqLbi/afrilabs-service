import {
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { SUPPORTED_CURRENCIES } from "../currency-config.service";

export class RoundingRuleDto {
  @IsNumber()
  @Min(0)
  @Max(4)
  decimals: number;

  @IsString()
  @IsIn(["round", "ceil", "floor"])
  mode: "round" | "ceil" | "floor";
}

export class UpdateCurrencyConfigDto {
  @ApiPropertyOptional({
    type: [String],
    example: ["NGN", "USD", "GBP"],
    description:
      "Subset of supported currencies to enable. " +
      `Supported: ${SUPPORTED_CURRENCIES.join(", ")}`,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(SUPPORTED_CURRENCIES as unknown as string[], { each: true })
  enabledCurrencies?: string[];

  @ApiPropertyOptional({
    type: Object,
    example: { CA: "CAD", AU: "AUD" },
    description: "ISO 3166-1 alpha-2 → ISO 4217 override map",
  })
  @IsOptional()
  @IsObject()
  countryOverrides?: Record<string, string>;

  @ApiPropertyOptional({
    example: 2.5,
    minimum: 0,
    maximum: 20,
    description:
      "FX buffer % added on top of the live rate to cover volatility (0–20)",
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(20)
  fxBuffer?: number;

  @ApiPropertyOptional({
    type: Object,
    description: "Per-currency rounding rules (decimals: 0-4, mode: round|ceil|floor)",
  })
  @IsOptional()
  @IsObject()
  roundingRules?: Record<string, RoundingRuleDto>;

  @ApiPropertyOptional({
    example: 240,
    minimum: 1,
    description: "Minutes before a stored FX rate is considered stale",
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  staleRateThresholdMinutes?: number;
}
