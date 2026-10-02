import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ProductionLog, ProductionLogSchema } from "./schemas/production-log.schema";
import { ProductionTrackingService } from "./production-tracking.service";
import { ProductionTrackingController } from "./production-tracking.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductionLog.name, schema: ProductionLogSchema },
    ]),
  ],
  providers: [ProductionTrackingService],
  controllers: [ProductionTrackingController],
  /**
   * Export the service so PaymentModule and CustomOrderModule can query
   * current production stage when building order responses.
   */
  exports: [ProductionTrackingService],
})
export class ProductionTrackingModule {}
