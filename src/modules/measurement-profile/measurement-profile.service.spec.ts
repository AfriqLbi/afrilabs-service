/**
 * MeasurementProfileService — Unit Tests
 *
 * Critical business rule under test:
 *   BR-5: Measurement input validation must reject nonsensical values:
 *         zero, negative, or wildly out of range (> 400 cm).
 *
 * Also covers:
 *   - create() / update() / remove() happy paths
 *   - Duplicate garment type per user → ConflictException
 *   - Empty measurements array → BadRequestException
 *   - Duplicate key within a single submission → BadRequestException
 *   - Static validateFields() callable independently (used by CustomOrderService)
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { MeasurementProfileService } from "./measurement-profile.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validFields() {
  return [
    { key: "bust", label: "Bust (cm)", value: 92 },
    { key: "waist", label: "Waist (cm)", value: 74 },
    { key: "hip", label: "Hip (cm)", value: 98 },
  ];
}

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const savedProfile = {
  _id: "profile-id-001",
  userId: "user-id-001",
  garmentType: "aso-oke-jacket",
  garmentLabel: "Aso Oke Jacket",
  measurements: validFields(),
  notes: null,
  save: jest.fn().mockResolvedValue({}),
};

const mockProfileModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
};

function buildService(): MeasurementProfileService {
  return new MeasurementProfileService(mockProfileModel as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MeasurementProfileService (BR-5: measurement validation)", () => {
  let service: MeasurementProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // ── Static validateFields() — the core validation gate ────────────────────

  describe("MeasurementProfileService.validateFields() — static method", () => {
    it("passes for valid measurements (all values 1–400)", () => {
      expect(() =>
        MeasurementProfileService.validateFields(validFields()),
      ).not.toThrow();
    });

    it("throws BadRequestException for a zero value (BR-5)", () => {
      const fields = [{ key: "bust", label: "Bust (cm)", value: 0 }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        /greater than zero/,
      );
    });

    it("throws BadRequestException for a negative value (BR-5)", () => {
      const fields = [{ key: "waist", label: "Waist (cm)", value: -10 }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for a value > 400 cm (wildly out of range — BR-5)", () => {
      const fields = [{ key: "length", label: "Length (cm)", value: 401 }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        /400 cm/,
      );
    });

    it("throws BadRequestException for a value of exactly 0", () => {
      const fields = [{ key: "hip", label: "Hip (cm)", value: 0 }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
    });

    it("accepts a boundary value of exactly 1 (minimum valid)", () => {
      const fields = [{ key: "wrist", label: "Wrist (cm)", value: 1 }];

      expect(() =>
        MeasurementProfileService.validateFields(fields),
      ).not.toThrow();
    });

    it("accepts a boundary value of exactly 400 (maximum valid)", () => {
      const fields = [{ key: "height", label: "Height (cm)", value: 400 }];

      expect(() =>
        MeasurementProfileService.validateFields(fields),
      ).not.toThrow();
    });

    it("throws BadRequestException for an empty array", () => {
      expect(() => MeasurementProfileService.validateFields([])).toThrow(
        BadRequestException,
      );
      expect(() => MeasurementProfileService.validateFields([])).toThrow(
        /At least one measurement field/,
      );
    });

    it("throws BadRequestException for duplicate keys in a single submission", () => {
      const fields = [
        { key: "bust", label: "Bust (cm)", value: 90 },
        { key: "bust", label: "Bust again", value: 95 }, // duplicate key
      ];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        /Duplicate/,
      );
    });

    it("throws BadRequestException for a non-numeric value (NaN)", () => {
      const fields = [{ key: "bust", label: "Bust", value: NaN }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for an empty key string", () => {
      const fields = [{ key: "  ", label: "Blank key", value: 90 }];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
    });

    it("is case-insensitive for duplicate key detection", () => {
      const fields = [
        { key: "Bust", label: "Bust (cm)", value: 90 },
        { key: "bust", label: "Bust (cm)", value: 92 }, // same key, different case
      ];

      expect(() => MeasurementProfileService.validateFields(fields)).toThrow(
        BadRequestException,
      );
    });
  });

  // ── create() ──────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates a profile with valid measurements", async () => {
      mockProfileModel.findOne.mockResolvedValue(null); // no existing profile
      mockProfileModel.create.mockResolvedValue({ ...savedProfile });

      const result = await service.create("user-id-001", {
        garmentType: "Aso Oke Jacket",
        measurements: validFields(),
      });

      expect(mockProfileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-id-001",
          garmentType: "aso oke jacket", // service does toLowerCase() only, not slugify
          measurements: validFields(),
        }),
      );
    });

    it("throws ConflictException when a profile for the same garment type already exists", async () => {
      mockProfileModel.findOne.mockResolvedValue(savedProfile);

      await expect(
        service.create("user-id-001", {
          garmentType: "Aso Oke Jacket",
          measurements: validFields(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws BadRequestException when measurements include a zero value", async () => {
      mockProfileModel.findOne.mockResolvedValue(null);

      await expect(
        service.create("user-id-001", {
          garmentType: "Cargo Pants",
          measurements: [{ key: "waist", label: "Waist (cm)", value: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when measurements include a negative value", async () => {
      mockProfileModel.findOne.mockResolvedValue(null);

      await expect(
        service.create("user-id-001", {
          garmentType: "Cargo Pants",
          measurements: [{ key: "length", label: "Length (cm)", value: -5 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when measurements include a value > 400", async () => {
      mockProfileModel.findOne.mockResolvedValue(null);

      await expect(
        service.create("user-id-001", {
          garmentType: "Gown",
          measurements: [{ key: "length", label: "Length (cm)", value: 500 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── update() ──────────────────────────────────────────────────────────────

  describe("update()", () => {
    it("re-validates measurements on update and throws for invalid values", async () => {
      mockProfileModel.findOne.mockResolvedValue({ ...savedProfile });

      await expect(
        service.update("user-id-001", "profile-id-001", {
          measurements: [{ key: "bust", label: "Bust (cm)", value: -20 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("updates measurements when all values are valid", async () => {
      const profile = {
        ...savedProfile,
        save: jest.fn().mockResolvedValue({}),
      };
      mockProfileModel.findOne.mockResolvedValue(profile);

      const newFields = [
        { key: "chest", label: "Chest (cm)", value: 100 },
        { key: "sleeve", label: "Sleeve (cm)", value: 65 },
      ];

      await service.update("user-id-001", "profile-id-001", {
        measurements: newFields,
      });

      expect(profile.measurements).toEqual(newFields);
      expect(profile.save).toHaveBeenCalled();
    });
  });

  // ── remove() ──────────────────────────────────────────────────────────────

  describe("remove()", () => {
    it("deletes the profile when found", async () => {
      mockProfileModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await expect(
        service.remove("user-id-001", "profile-id-001"),
      ).resolves.not.toThrow();
    });

    it("throws NotFoundException when profile does not belong to user", async () => {
      mockProfileModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

      await expect(service.remove("user-id-001", "wrong-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findOneByUser() ───────────────────────────────────────────────────────

  describe("findOneByUser()", () => {
    it("returns the profile when found", async () => {
      mockProfileModel.findOne.mockResolvedValue(savedProfile);

      const result = await service.findOneByUser(
        "user-id-001",
        "profile-id-001",
      );

      expect(result).toEqual(savedProfile);
    });

    it("throws NotFoundException when not found", async () => {
      mockProfileModel.findOne.mockResolvedValue(null);

      await expect(
        service.findOneByUser("user-id-001", "missing-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
