import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  ShippingSettings,
  ShippingSettingsDocument,
} from "./schemas/shipping-settings.schema";

@Injectable()
export class ShippingSettingsService {
  constructor(
    @InjectModel(ShippingSettings.name)
    private readonly model: Model<ShippingSettingsDocument>,
  ) {}

  /** Returns the settings document, creating one with defaults if missing. */
  async getSettings(): Promise<ShippingSettingsDocument> {
    let doc = await this.model.findOne().lean<ShippingSettingsDocument>();
    if (!doc) {
      doc = await this.model.create({}) as unknown as ShippingSettingsDocument;
      doc = await this.model.findOne().lean<ShippingSettingsDocument>();
    }
    return doc!;
  }

  async updateSettings(
    dto: Partial<ShippingSettings>,
  ): Promise<ShippingSettingsDocument> {
    // Upsert: update the single doc, create if missing
    const existing = await this.model.findOne();
    if (existing) {
      Object.assign(existing, dto);
      await existing.save();
      return existing;
    }
    return this.model.create(dto);
  }
}
