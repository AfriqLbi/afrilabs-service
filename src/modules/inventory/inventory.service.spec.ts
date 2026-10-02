/**
 * InventoryService — Unit Tests
 *
 * Critical business rule under test:
 *   BR-4: An out-of-stock variant must be blocked from checkout at the API level.
 *
 * This means:
 *   (a) reserveStock() succeeds when available stock (stock - reserved) >= qty.
 *   (b) reserveStock() throws ConflictException when available stock < qty.
 *   (c) reserveStock() throws ConflictException when available stock === 0.
 *   (d) reserveStock() throws NotFoundException when the product does not exist.
 *   (e) setStock() throws ConflictException when new stock < current reserved
 *       (would put available below 0).
 *   (f) commitReservedStock() decrements both stock and reserved atomically.
 *   (g) releaseStock() increments reserved back (un-reserves) without going negative.
 */

import { ConflictException, NotFoundException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

// ─── Mock product model ────────────────────────────────────────────────────────

const mockProductModel = {
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
};

function buildService(): InventoryService {
  return new InventoryService(mockProductModel as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InventoryService (BR-4: out-of-stock blocking)", () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // ── reserveStock ───────────────────────────────────────────────────────────

  describe("reserveStock()", () => {
    it("succeeds when available stock >= requested qty", async () => {
      // findOneAndUpdate with the $expr filter returns the updated doc → success
      mockProductModel.findOneAndUpdate.mockResolvedValue({
        _id: "prod-001",
        reserved: 1,
      });

      await expect(service.reserveStock("prod-001", 1)).resolves.not.toThrow();
      expect(mockProductModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it("throws ConflictException when available stock < requested qty (BR-4 core)", async () => {
      // findOneAndUpdate returns null -> condition (stock - reserved >= qty) was not met
      mockProductModel.findOneAndUpdate.mockResolvedValue(null);
      // findById fallback for the error message - needs chained .lean()
      mockProductModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          title: "Aso Oke Jacket",
          stock: 3,
          reserved: 3, // available = 0
        }),
      });

      await expect(service.reserveStock("prod-001", 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws ConflictException when stock === 0 (completely out of stock)", async () => {
      mockProductModel.findOneAndUpdate.mockResolvedValue(null);
      mockProductModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          title: "Cargo Pants",
          stock: 0,
          reserved: 0,
        }),
      });

      await expect(service.reserveStock("prod-001", 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it("includes a helpful message naming the product and available qty", async () => {
      mockProductModel.findOneAndUpdate.mockResolvedValue(null);
      mockProductModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          title: "Straight Pants",
          stock: 2,
          reserved: 2, // available = 0
        }),
      });

      await expect(service.reserveStock("prod-001", 1)).rejects.toThrow(
        /Straight Pants/,
      );
    });

    it("throws NotFoundException when the product ID does not exist", async () => {
      mockProductModel.findOneAndUpdate.mockResolvedValue(null);
      mockProductModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null), // product not found at all
      });

      await expect(service.reserveStock("non-existent-id", 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("handles requesting more than current available stock (qty > available)", async () => {
      mockProductModel.findOneAndUpdate.mockResolvedValue(null);
      mockProductModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          title: "Danshiki",
          stock: 5,
          reserved: 3, // available = 2, requesting 5 -> conflict
        }),
      });

      await expect(service.reserveStock("prod-001", 5)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── setStock — admin cannot set stock below reserved ──────────────────────

  describe("setStock()", () => {
    it("throws ConflictException if new stock level would be below current reserved", async () => {
      mockProductModel.findById.mockResolvedValue({
        _id: "prod-001",
        title: "Office Pants",
        stock: 10,
        reserved: 5, // 5 units reserved by pending orders
      });

      // Trying to set stock to 3, but 5 are reserved — leaves -2 available
      await expect(service.setStock("prod-001", 3, "admin-id")).rejects.toThrow(
        ConflictException,
      );
    });

    it("succeeds when new stock >= current reserved", async () => {
      const product = { _id: "prod-001", reserved: 5 };
      mockProductModel.findById.mockResolvedValue(product);
      mockProductModel.findByIdAndUpdate.mockResolvedValue({
        ...product,
        stock: 10,
      });

      await expect(
        service.setStock("prod-001", 10, "admin-id"),
      ).resolves.toBeTruthy();
    });

    it("throws NotFoundException for a non-existent product", async () => {
      mockProductModel.findById.mockResolvedValue(null);

      await expect(
        service.setStock("non-existent", 5, "admin-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── commitReservedStock ────────────────────────────────────────────────────

  describe("commitReservedStock()", () => {
    it("decrements stock and reserved by the committed qty", async () => {
      mockProductModel.findByIdAndUpdate.mockResolvedValue({
        stock: 9,
        reserved: 0,
      });

      await expect(
        service.commitReservedStock("prod-001", 1),
      ).resolves.not.toThrow();
      expect(mockProductModel.findByIdAndUpdate).toHaveBeenCalledWith(
        "prod-001",
        { $inc: { stock: -1, reserved: -1 } },
        { new: true, session: undefined },
      );
    });

    it("throws NotFoundException when the product does not exist", async () => {
      mockProductModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(
        service.commitReservedStock("non-existent", 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── releaseStock ──────────────────────────────────────────────────────────

  describe("releaseStock()", () => {
    it("calls findByIdAndUpdate with $inc reserved: -qty", async () => {
      mockProductModel.findByIdAndUpdate.mockResolvedValue({});

      await service.releaseStock("prod-001", 2);

      expect(mockProductModel.findByIdAndUpdate).toHaveBeenCalledWith(
        "prod-001",
        expect.objectContaining({ $inc: { reserved: -2 } }),
        expect.anything(),
      );
    });
  });

  // ── getStockStatus ────────────────────────────────────────────────────────

  describe("getStockStatus()", () => {
    it("reports out_of_stock when available === 0", async () => {
      mockProductModel.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue({ stock: 5, reserved: 5, title: "Gown" }),
        }),
      });

      const status = await service.getStockStatus("prod-001");

      expect(status.stockStatus).toBe("out_of_stock");
      expect(status.available).toBe(0);
    });

    it("reports low_stock when available <= 5", async () => {
      mockProductModel.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue({ stock: 6, reserved: 2, title: "Hoodie" }),
        }),
      });

      const status = await service.getStockStatus("prod-001");

      expect(status.stockStatus).toBe("low_stock");
      expect(status.available).toBe(4);
    });

    it("reports in_stock when available > 5", async () => {
      mockProductModel.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue({ stock: 20, reserved: 2, title: "Jacket" }),
        }),
      });

      const status = await service.getStockStatus("prod-001");

      expect(status.stockStatus).toBe("in_stock");
      expect(status.available).toBe(18);
    });
  });
});
