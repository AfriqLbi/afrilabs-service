import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CategoryDocument = Category & Document;

export class SubcategoryEmbedded {
  @Prop({ required: true }) id: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) slug: string;
}

@Schema({ timestamps: true, collection: "categories" })
export class Category {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: "" })
  blurb: string;

  @Prop({ default: "" })
  imageUrl: string;

  @Prop({ type: String, default: null })
  parentId: string | null;

  @Prop({ type: [{ id: String, name: String, slug: String }], default: [] })
  subcategories: SubcategoryEmbedded[];

  @Prop({ default: 0 })
  sortOrder: number;

  /**
   * Distinguishes browseable product categories from admin-curated storefront
   * sections (e.g. "New Arrivals", "Bridal", "Aso-Ebi").
   * Added for Labi fashion platform; default "category" keeps all pre-existing
   * electronics categories valid without a data migration.
   */
  @Prop({
    type: String,
    enum: ["category", "section"],
    default: "category",
  })
  type: "category" | "section";
}

export const CategorySchema = SchemaFactory.createForClass(Category);
// slug: unique index already created by unique: true in @Prop
CategorySchema.index({ parentId: 1 });
CategorySchema.index({ type: 1, sortOrder: 1 }); // for /v1/catalog/categories?type=section
