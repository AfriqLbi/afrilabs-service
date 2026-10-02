import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  MeasurementProfile,
  MeasurementProfileSchema,
} from "./schemas/measurement-profile.schema";
import { MeasurementProfileService } from "./measurement-profile.service";
import {
  AdminMeasurementController,
  MeasurementProfileController,
} from "./measurement-profile.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MeasurementProfile.name, schema: MeasurementProfileSchema },
    ]),
  ],
  providers: [MeasurementProfileService],
  controllers: [MeasurementProfileController, AdminMeasurementController],
  /**
   * Export the service so that:
   *  - CustomOrderModule can look up a saved profile when a customer references
   *    one in their custom order request
   *  - Tests can inject the service directly
   */
  exports: [MeasurementProfileService],
})
export class MeasurementProfileModule {}
