import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { LookbookItem, LookbookItemSchema } from "./schemas/lookbook-item.schema";
import { LookbookService } from "./lookbook.service";
import { LookbookController, AdminLookbookController } from "./lookbook.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LookbookItem.name, schema: LookbookItemSchema },
    ]),
  ],
  providers: [LookbookService],
  controllers: [LookbookController, AdminLookbookController],
})
export class LookbookModule {}
