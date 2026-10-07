import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bull";
import {
  ShippingZone,
  ShippingZoneSchema,
} from "./schemas/shipping-zone.schema";
import {
  ShippingSettings,
  ShippingSettingsSchema,
} from "./schemas/shipping-settings.schema";
import { Order, OrderSchema } from "../order/schemas/order.schema";
import { ShippingResolverService } from "./shipping-resolver.service";
import { ShippingQuoteService } from "./shipping-quote.service";
import { ShippingZoneService } from "./shipping-zone.service";
import { ShippingSettingsService } from "./shipping-settings.service";
import { ShippingProcessor } from "./shipping.processor";
import {
  ShippingController,
  AdminShippingController,
} from "./shipping.controller";
import { QUEUE_SHIPPING } from "./shipping.constants";
import { OrderModule } from "../order/order.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { CartModule } from "../cart/cart.module";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShippingZone.name, schema: ShippingZoneSchema },
      { name: ShippingSettings.name, schema: ShippingSettingsSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    BullModule.registerQueue({ name: QUEUE_SHIPPING }),
    OrderModule,
    NotificationsModule,
    AuditLogModule,
    CartModule,
    InventoryModule,
  ],
  providers: [
    ShippingResolverService,
    ShippingQuoteService,
    ShippingZoneService,
    ShippingSettingsService,
    ShippingProcessor,
  ],
  controllers: [ShippingController, AdminShippingController],
  exports: [
    ShippingResolverService,
    ShippingQuoteService,
    ShippingZoneService,
    ShippingSettingsService,
  ],
})
export class ShippingModule {}
