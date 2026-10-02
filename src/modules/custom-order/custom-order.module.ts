import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { CustomOrder, CustomOrderSchema } from "./schemas/custom-order.schema";
import { CustomOrderService } from "./custom-order.service";
import {
  AdminCustomOrderController,
  CustomOrderController,
  StaffCustomOrderController,
} from "./custom-order.controller";
import { MeasurementProfileModule } from "../measurement-profile/measurement-profile.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomOrder.name, schema: CustomOrderSchema },
    ]),
    MeasurementProfileModule,
    NotificationsModule,
  ],
  providers: [CustomOrderService],
  controllers: [
    CustomOrderController,
    AdminCustomOrderController,
    StaffCustomOrderController,
  ],
  exports: [CustomOrderService],
})
export class CustomOrderModule {}
