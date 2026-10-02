import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  MeasurementProfile,
  MeasurementProfileDocument,
} from "./schemas/measurement-profile.schema";
import {
  CreateMeasurementProfileDto,
  MeasurementFieldDto,
  UpdateMeasurementProfileDto,
} from "./dto/measurement-profile.dto";

@Injectable()
export class MeasurementProfileService {
  constructor(
    @InjectModel(MeasurementProfile.name)
    private readonly profileModel: Model<MeasurementProfileDocument>,
  ) {}

  // ─── Public helpers ────────────────────────────────────────────────────────

  /**
   * Validates a measurement field array.
   * Called both from this service and from the custom-order service when
   * inline measurements are submitted with a custom order request.
   *
   * BUSINESS RULE: reject zero, negative, or wildly out-of-range values.
   * The DTO layer already applies @Min(1) / @Max(400) via class-validator, so
   * this method exists as a second line of defence for programmatic callers.
   */
  static validateFields(fields: MeasurementFieldDto[]): void {
    if (!fields || fields.length === 0) {
      throw new BadRequestException(
        "At least one measurement field is required",
      );
    }
    for (const f of fields) {
      if (!f.key || f.key.trim() === "") {
        throw new BadRequestException(
          "Each measurement field must have a non-empty key",
        );
      }
      if (typeof f.value !== "number" || isNaN(f.value)) {
        throw new BadRequestException(
          `Measurement "${f.key}" must be a number`,
        );
      }
      if (f.value <= 0) {
        throw new BadRequestException(
          `Measurement "${f.key}" must be greater than zero (received ${f.value})`,
        );
      }
      if (f.value > 400) {
        throw new BadRequestException(
          `Measurement "${f.key}" value ${f.value} cm is outside the realistic range (max 400 cm). ` +
            `Please double-check the figure you entered.`,
        );
      }
    }
    // Check for duplicate keys within a single submission
    const keys = fields.map((f) => f.key.toLowerCase());
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (duplicates.length > 0) {
      throw new BadRequestException(
        `Duplicate measurement keys: ${[...new Set(duplicates)].join(", ")}`,
      );
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: CreateMeasurementProfileDto,
  ): Promise<MeasurementProfileDocument> {
    MeasurementProfileService.validateFields(dto.measurements);

    const garmentType = dto.garmentType.trim().toLowerCase();
    const existing = await this.profileModel.findOne({ userId, garmentType });
    if (existing) {
      throw new ConflictException(
        `A measurement profile for garment type "${dto.garmentType}" already exists. ` +
          `Use PATCH /v1/measurements/${existing._id} to update it.`,
      );
    }

    return this.profileModel.create({
      userId,
      garmentType,
      garmentLabel: dto.garmentLabel ?? null,
      measurements: dto.measurements,
      notes: dto.notes ?? null,
    });
  }

  async findAllByUser(userId: string): Promise<MeasurementProfileDocument[]> {
    return this.profileModel
      .find({ userId })
      .sort({ garmentType: 1 })
      .lean() as unknown as MeasurementProfileDocument[];
  }

  async findOneByUser(
    userId: string,
    profileId: string,
  ): Promise<MeasurementProfileDocument> {
    const profile = await this.profileModel.findOne({ _id: profileId, userId });
    if (!profile) throw new NotFoundException("Measurement profile not found");
    return profile;
  }

  async findByUserAndGarmentType(
    userId: string,
    garmentType: string,
  ): Promise<MeasurementProfileDocument | null> {
    return this.profileModel.findOne({
      userId,
      garmentType: garmentType.trim().toLowerCase(),
    });
  }

  async update(
    userId: string,
    profileId: string,
    dto: UpdateMeasurementProfileDto,
  ): Promise<MeasurementProfileDocument> {
    const profile = await this.findOneByUser(userId, profileId);

    if (dto.measurements) {
      MeasurementProfileService.validateFields(dto.measurements);
    }

    Object.assign(profile, {
      ...(dto.garmentType && {
        garmentType: dto.garmentType.trim().toLowerCase(),
      }),
      ...(dto.garmentLabel !== undefined && {
        garmentLabel: dto.garmentLabel ?? null,
      }),
      ...(dto.measurements && { measurements: dto.measurements }),
      ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
    });

    return profile.save();
  }

  async remove(userId: string, profileId: string): Promise<void> {
    const result = await this.profileModel.deleteOne({
      _id: profileId,
      userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Measurement profile not found");
    }
  }

  /**
   * Admin: retrieve any user's profiles (for quote review, custom order processing).
   * Only callable with a super_admin / staff role — enforced in the controller.
   */
  async findAllByUserAdmin(
    userId: string,
  ): Promise<MeasurementProfileDocument[]> {
    return this.profileModel
      .find({ userId })
      .sort({ garmentType: 1 })
      .lean() as unknown as MeasurementProfileDocument[];
  }
}
