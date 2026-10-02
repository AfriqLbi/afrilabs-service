import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  CurrencyConfig,
  CurrencyConfigSchema,
} from "./schemas/currency-config.schema";
import { CurrencyConfigService } from "./currency-config.service";
import { CurrencyConfigController } from "./currency-config.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CurrencyConfig.name, schema: CurrencyConfigSchema },
    ]),
  ],
  providers: [CurrencyConfigService],
  controllers: [CurrencyConfigController],
  /**
   * Export so GeoCurrencyModule, PaymentModule, and OrderModule can inject
   * CurrencyConfigService without re-declaring the Mongoose model.
   */
  exports: [CurrencyConfigService],
})
export class CurrencyConfigModule {}
