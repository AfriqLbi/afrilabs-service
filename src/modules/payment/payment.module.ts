import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  WebhookEvent,
  WebhookEventSchema,
} from "./schemas/webhook-event.schema";
import { PaymentService } from "./payment.service";
import { PaymentRouter } from "./payment-router.service";
import { StripeService } from "./stripe.service";
import { PaymentController } from "./payment.controller";
import { OrderModule } from "../order/order.module";
import { InventoryModule } from "../inventory/inventory.module";
import { CustomOrderModule } from "../custom-order/custom-order.module";
import { CurrencyConfigModule } from "../currency-config/currency-config.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WebhookEvent.name, schema: WebhookEventSchema },
    ]),
    forwardRef(() => OrderModule),
    InventoryModule,
    CustomOrderModule,
    CurrencyConfigModule,
  ],
  providers: [PaymentService, StripeService, PaymentRouter],
  controllers: [PaymentController],
  exports: [PaymentService, PaymentRouter],
})
export class PaymentModule {}
