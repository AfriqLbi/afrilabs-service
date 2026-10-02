/**
 * ProductionTrackingService — Unit Tests
 *
 * Rules under test:
 *   - Production stages must advance forward (cutting → sewing → quality_check
 *     → ready → delivered). Regression is blocked.
 *   - Skipping stages is allowed (e.g. cutting → ready for in-stock items).
 *   - getCurrentStage() returns null for an order with no log entries.
 *   - getHistory() returns entries newest-first.
 */

import { BadRequestException } from "@nestjs/common";
import { ProductionTrackingService } from "./production-tracking.service";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockLogModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  sort: jest.fn(),
  aggregate: jest.fn(),
};

function buildService(): ProductionTrackingService {
  return new ProductionTrackingService(mockLogModel as any);
}

// ─── Context helper ────────────────────────────────────────────────────────────

const ctx = {
  orderId: "order-id-001",
  orderType: "custom_order" as const,
  orderReference: "CO-1001",
  updatedBy: "staff-id-001",
  updatedByName: "Ife Adeyemi",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProductionTrackingService — stage enforcement", () => {
  let service: ProductionTrackingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // ── Forward advancement ────────────────────────────────────────────────────

  it("creates the first log entry (cutting) when no prior entries exist", async () => {
    // No prior log entries
    mockLogModel.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    mockLogModel.create.mockResolvedValue({ stage: "cutting", orderId: ctx.orderId });

    const result = await service.updateStage(ctx, { stage: "cutting" });

    expect(mockLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cutting", orderId: ctx.orderId }),
    );
  });

  it("advances from cutting → sewing successfully", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "cutting" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "sewing" });

    await expect(service.updateStage(ctx, { stage: "sewing" })).resolves.not.toThrow();
  });

  it("advances from sewing → quality_check successfully", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "sewing" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "quality_check" });

    await expect(service.updateStage(ctx, { stage: "quality_check" })).resolves.not.toThrow();
  });

  it("advances from quality_check → ready successfully", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "quality_check" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "ready" });

    await expect(service.updateStage(ctx, { stage: "ready" })).resolves.not.toThrow();
  });

  it("advances from ready → delivered successfully", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "ready" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "delivered" });

    await expect(service.updateStage(ctx, { stage: "delivered" })).resolves.not.toThrow();
  });

  // ── Skip stages ────────────────────────────────────────────────────────────

  it("allows skipping stages (cutting → ready) for in-stock items", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "cutting" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "ready" });

    await expect(service.updateStage(ctx, { stage: "ready" })).resolves.not.toThrow();
  });

  it("allows skipping to delivered directly from cutting", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "cutting" }) }),
    });
    mockLogModel.create.mockResolvedValue({ stage: "delivered" });

    await expect(service.updateStage(ctx, { stage: "delivered" })).resolves.not.toThrow();
  });

  // ── Regression blocked ────────────────────────────────────────────────────

  it("throws BadRequestException when trying to regress from sewing → cutting", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "sewing" }) }),
    });

    await expect(service.updateStage(ctx, { stage: "cutting" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException when trying to stay at the same stage (duplicate)", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "sewing" }) }),
    });

    await expect(service.updateStage(ctx, { stage: "sewing" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException when trying to regress from ready → quality_check", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "ready" }) }),
    });

    await expect(service.updateStage(ctx, { stage: "quality_check" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException when trying to regress from delivered → ready", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "delivered" }) }),
    });

    await expect(service.updateStage(ctx, { stage: "ready" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("includes helpful message about valid next stages when regression attempted", async () => {
    mockLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "sewing" }) }),
    });

    await expect(service.updateStage(ctx, { stage: "cutting" })).rejects.toThrow(
      /advance forward/,
    );
  });

  // ── getCurrentStage ────────────────────────────────────────────────────────

  describe("getCurrentStage()", () => {
    it("returns null for an order with no log entries", async () => {
      mockLogModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
      });

      const stage = await service.getCurrentStage("order-no-log");

      expect(stage).toBeNull();
    });

    it("returns the most recent stage", async () => {
      mockLogModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ stage: "quality_check" }) }) }),
      });

      const stage = await service.getCurrentStage("order-id-001");

      expect(stage).toBe("quality_check");
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe("getHistory()", () => {
    it("returns entries newest-first and currentStage from the first entry", async () => {
      const entries = [
        { stage: "sewing", createdAt: new Date("2026-09-02") },
        { stage: "cutting", createdAt: new Date("2026-09-01") },
      ];
      mockLogModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(entries) }),
      });

      const { currentStage, history } = await service.getHistory("order-id-001");

      expect(currentStage).toBe("sewing");
      expect(history).toHaveLength(2);
      expect(history[0].stage).toBe("sewing"); // newest first
    });

    it("returns currentStage null and empty history for new orders", async () => {
      mockLogModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const { currentStage, history } = await service.getHistory("new-order");

      expect(currentStage).toBeNull();
      expect(history).toHaveLength(0);
    });
  });
});
