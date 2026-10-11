import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrencyConfigService } from "./currency-config.service";
import { UpdateCurrencyConfigDto } from "./dto/update-currency-config.dto";
import { RedisCacheService } from "../redis-cache/redis-cache.service";

@ApiTags("Admin — Currency Config")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "merchandiser")
@Controller({ path: "admin/currency-config", version: "1" })
export class CurrencyConfigController {
  constructor(
    private readonly svc: CurrencyConfigService,
    private readonly cache: RedisCacheService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Get current currency configuration",
    description:
      "Returns the singleton CurrencyConfig document: enabled currencies, FX buffer %, rounding rules, stale-rate threshold.",
  })
  getConfig() {
    return this.svc.getConfig();
  }

  @Patch()
  @ApiOperation({
    summary: "Update currency configuration",
    description:
      "Partial update — only supplied fields are changed. " +
      "fxBuffer must be 0–20. Currency codes must be in the supported list.",
  })
  async updateConfig(@Body() dto: UpdateCurrencyConfigDto) {
    const result = await this.svc.updateConfig(dto);
    // Bust Redis geo + FX caches so the updated config is reflected immediately
    await Promise.all([
      this.cache.del("labi:fx:rates"),
      this.cache.delByPattern("labi:geo:*"),
    ]);
    return result;
  }
}
