import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bull";
import { Order, OrderSchema } from "./schemas/order.schema";
import { Cart, CartSchema } from "../cart/schemas/cart.schema";
import { InventoryModule } from "../inventory/inventory.module";
import { ProductionTrackingModule } from "../production-tracking/production-tracking.module";
import { OrderService } from "./order.service";
import { OrderController, AdminOrderController } from "./order.controller";
import { QUEUE_RESERVATION_EXPIRY } from "../jobs/jobs.constants";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
    ]),
    BullModule.registerQueue({ name: QUEUE_RESERVATION_EXPIRY }),
    InventoryModule,
    ProductionTrackingModule,
  ],
  providers: [OrderService],
  controllers: [OrderController, AdminOrderController],
  exports: [OrderService, MongooseModule],
})
export class OrderModule {}
