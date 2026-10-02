import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  ProductionLog,
  ProductionLogDocument,
  PRODUCTION_STAGE_ORDER,
  ProductionStage,
} from "./schemas/production-log.schema";
import { UpdateProductionStageDto } from "./dto/production-tracking.dto";

export interface UpdateStageContext {
  orderId: string;
  orderType: "order" | "custom_order";
  orderReference: string;
  updatedBy: string;
  updatedByName?: string | null;
}

@Injectable()
export class ProductionTrackingService {
  constructor(
    @InjectModel(ProductionLog.name)
    private readonly logModel: Model<ProductionLogDocument>,
  ) {}

  // ─── Update stage ─────────────────────────────────────────────────────────

  /**
   * Appends a new production log entry.
   *
   * Forward-only enforcement: stages must advance, not regress.
   * Exception: "delivered" can follow "ready" only.
   *
   * Returning to an earlier stage is not permitted — if a rework situation
   * occurs, an admin note should be added via the note field instead.
   */
  async updateStage(
    ctx: UpdateStageContext,
    dto: UpdateProductionStageDto,
  ): Promise<ProductionLogDocument> {
    const newStageIndex = PRODUCTION_STAGE_ORDER.indexOf(dto.stage);

    // Get the current stage from the latest log entry
    const latest = await this.logModel
      .findOne({ orderId: ctx.orderId })
      .sort({ createdAt: -1 })
      .lean();

    if (latest) {
      const currentIndex = PRODUCTION_STAGE_ORDER.indexOf(latest.stage);
      if (newStageIndex <= currentIndex) {
        throw new BadRequestException(
          `Cannot move production stage from "${latest.stage}" to "${dto.stage}". ` +
          `Stages must advance forward. Current: ${PRODUCTION_STAGE_ORDER.slice(currentIndex + 1).join(" → ")} are valid next stages.`,
        );
      }
    }

    return this.logModel.create({
      orderId: ctx.orderId,
      orderType: ctx.orderType,
      orderReference: ctx.orderReference,
      stage: dto.stage,
      updatedBy: ctx.updatedBy,
      updatedByName: ctx.updatedByName ?? null,
      note: dto.note ?? null,
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Returns the full production history for an order, newest entry first.
   * The first item in the returned array is the current stage.
   */
  async getHistory(orderId: string): Promise<{
    currentStage: ProductionStage | null;
    history: ProductionLogDocument[];
  }> {
    const history = await this.logModel
      .find({ orderId })
      .sort({ createdAt: -1 })
      .lean();

    return {
      currentStage: history.length > 0 ? history[0].stage : null,
      history: history as unknown as ProductionLogDocument[],
    };
  }

  /**
   * Get the current production stage only (lightweight — for embedding in order responses).
   */
  async getCurrentStage(orderId: string): Promise<ProductionStage | null> {
    const latest = await this.logModel
      .findOne({ orderId })
      .sort({ createdAt: -1 })
      .select("stage")
      .lean();
    return latest ? latest.stage : null;
  }

  /**
   * Admin: list all orders currently at a given stage.
   * Useful for production queue views.
   */
  async getOrdersAtStage(
    stage: ProductionStage,
    orderType?: "order" | "custom_order",
  ): Promise<ProductionLogDocument[]> {
    // Find the latest log per orderId where stage === requested stage.
    // Using aggregation to get the latest-per-order efficiently.
    const match: Record<string, unknown> = { stage };
    if (orderType) match.orderType = orderType;

    return this.logModel.aggregate([
      // Start with the stage we want
      { $match: match },
      // Sort by orderId + createdAt desc so the latest per order comes first
      { $sort: { orderId: 1, createdAt: -1 } },
      // Collapse to one entry per orderId
      { $group: { _id: "$orderId", latest: { $first: "$$ROOT" } } },
      // Only keep those where the LATEST stage matches what we asked for
      { $replaceRoot: { newRoot: "$latest" } },
      { $match: { stage } },
      { $sort: { createdAt: -1 } },
    ]);
  }
}
