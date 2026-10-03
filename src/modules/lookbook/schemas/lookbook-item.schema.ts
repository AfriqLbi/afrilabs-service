import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type LookbookItemDocument = LookbookItem & Document;

@Schema({ timestamps: true, collection: "lookbook_items" })
export class LookbookItem {
  @Prop({ required: true })
  title: string;

  @Prop({ default: "" })
  caption: string;

  @Prop({ required: true })
  imageUrl: string;

  /** Collection / season label, e.g. "SS 2025" */
  @Prop({ default: "" })
  season: string;

  /** Controls display order — lower = first */
  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  published: boolean;
}

export const LookbookItemSchema = SchemaFactory.createForClass(LookbookItem);
LookbookItemSchema.index({ sortOrder: 1, createdAt: -1 });
