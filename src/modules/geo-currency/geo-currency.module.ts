import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { FxRate, FxRateSchema } from "./schemas/fx-rate.schema";
import { GeoCurrencyService } from "./geo-currency.service";
import { GeoCurrencyController } from "./geo-currency.controller";
import { GeoContextController } from "./geo-context.controller";
import { CurrencyConfigModule } from "../currency-config/currency-config.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FxRate.name, schema: FxRateSchema }]),
    CurrencyConfigModule,
  ],
  providers: [GeoCurrencyService],
  controllers: [GeoCurrencyController, GeoContextController],
  exports: [GeoCurrencyService],
})
export class GeoCurrencyModule {}
