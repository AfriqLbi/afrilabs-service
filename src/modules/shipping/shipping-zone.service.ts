import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  ShippingZone,
  ShippingZoneDocument,
} from "./schemas/shipping-zone.schema";
import { CreateZoneDto, UpdateZoneDto } from "./dto/shipping.dto";
import { AuditLogService } from "../audit-log/audit-log.service";

@Injectable()
export class ShippingZoneService {
  constructor(
    @InjectModel(ShippingZone.name)
    private readonly zoneModel: Model<ShippingZoneDocument>,
    private readonly auditLog: AuditLogService,
  ) {}

  listAll(): Promise<ShippingZoneDocument[]> {
    return this.zoneModel
      .find()
      .sort({ priority: -1, name: 1 })
      .lean<ShippingZoneDocument[]>();
  }

  async create(
    dto: CreateZoneDto,
    actorId?: string,
  ): Promise<ShippingZoneDocument> {
    if (dto.isFallback) {
      const existing = await this.zoneModel
        .findOne({ isFallback: true })
        .lean();
      if (existing) {
        throw new BadRequestException(
          "A fallback zone already exists. Update or remove it before creating a new one.",
        );
      }
    }
    const zone = await this.zoneModel.create(dto);
    await this.auditLog.log({
      actor: actorId ?? "system",
      action: "shipping_zone.create",
      entityType: "shipping_zone",
      entityId: (zone._id as unknown as { toString: () => string }).toString(),
      after: dto as unknown as Record<string, unknown>,
    });
    return zone;
  }

  async update(
    id: string,
    dto: UpdateZoneDto,
    actorId?: string,
  ): Promise<ShippingZoneDocument> {
    if (dto.isFallback) {
      const existing = await this.zoneModel
        .findOne({ isFallback: true, _id: { $ne: id } })
        .lean();
      if (existing) {
        throw new BadRequestException(
          "Another zone is already flagged as fallback. Clear that flag first.",
        );
      }
    }
    const before = await this.zoneModel.findById(id).lean();
    const updated = await this.zoneModel.findByIdAndUpdate(id, dto, {
      new: true,
    });
    if (!updated) throw new NotFoundException("Shipping zone not found");
    await this.auditLog.log({
      actor: actorId ?? "system",
      action: "shipping_zone.update",
      entityType: "shipping_zone",
      entityId: id,
      before: before as unknown as Record<string, unknown>,
      after: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const before = await this.zoneModel.findById(id).lean();
    const result = await this.zoneModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException("Shipping zone not found");
    await this.auditLog.log({
      actor: actorId ?? "system",
      action: "shipping_zone.delete",
      entityType: "shipping_zone",
      entityId: id,
      before: before as unknown as Record<string, unknown>,
    });
  }
}
