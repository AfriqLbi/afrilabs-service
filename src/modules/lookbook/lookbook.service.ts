import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { LookbookItem, LookbookItemDocument } from "./schemas/lookbook-item.schema";
import { CreateLookbookItemDto, UpdateLookbookItemDto } from "./dto/lookbook.dto";

@Injectable()
export class LookbookService {
  constructor(
    @InjectModel(LookbookItem.name)
    private readonly model: Model<LookbookItemDocument>,
  ) {}

  /** Public: only published items, sorted by sortOrder asc then createdAt desc */
  listPublished() {
    return this.model
      .find({ published: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
  }

  /** Admin: all items */
  listAll() {
    return this.model.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  }

  async create(dto: CreateLookbookItemDto) {
    return this.model.create({
      title:     dto.title,
      caption:   dto.caption ?? "",
      imageUrl:  dto.imageUrl,
      season:    dto.season ?? "",
      sortOrder: dto.sortOrder ?? 0,
      published: dto.published ?? true,
    });
  }

  async update(id: string, dto: UpdateLookbookItemDto) {
    const item = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!item) throw new NotFoundException("Lookbook item not found");
    return item;
  }

  async remove(id: string) {
    const item = await this.model.findByIdAndDelete(id);
    if (!item) throw new NotFoundException("Lookbook item not found");
  }

  /** Bulk reorder — receives [{id, sortOrder}] and updates all at once */
  async reorder(items: { id: string; sortOrder: number }[]) {
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        this.model.findByIdAndUpdate(id, { sortOrder }),
      ),
    );
  }
}
