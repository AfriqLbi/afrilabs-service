import {
  Body, Controller, Delete, Get, HttpCode,
  HttpStatus, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LookbookService } from "./lookbook.service";
import { CreateLookbookItemDto, UpdateLookbookItemDto } from "./dto/lookbook.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ApiErrorResponse } from "../../common/swagger/api-response.decorator";
import { IsArray, IsNumber, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

// ── Storefront (public) ────────────────────────────────────────────────────────

@ApiTags("Lookbook")
@Controller({ path: "lookbook", version: "1" })
export class LookbookController {
  constructor(private readonly svc: LookbookService) {}

  @Get()
  @ApiOperation({ summary: "List published lookbook items" })
  list() {
    return this.svc.listPublished();
  }
}

// ── Reorder DTO ────────────────────────────────────────────────────────────────

class ReorderItemDto {
  @ApiProperty() @IsString() id: string;
  @ApiProperty() @IsNumber() sortOrder: number;
}

class ReorderDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

// ── Admin ──────────────────────────────────────────────────────────────────────

@ApiTags("Admin — Lookbook")
@ApiBearerAuth()
@Controller({ path: "admin/lookbook", version: "1" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "merchandiser")
@ApiForbiddenResponse({ description: "Insufficient role", type: ApiErrorResponse })
export class AdminLookbookController {
  constructor(private readonly svc: LookbookService) {}

  @Get()
  @ApiOperation({ summary: "[Admin] List all lookbook items" })
  list() {
    return this.svc.listAll();
  }

  @Post()
  @ApiOperation({ summary: "[Admin] Create a lookbook item" })
  create(@Body() dto: CreateLookbookItemDto) {
    return this.svc.create(dto);
  }

  @Patch("reorder")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "[Admin] Bulk reorder lookbook items" })
  reorder(@Body() dto: ReorderDto) {
    return this.svc.reorder(dto.items);
  }

  @Patch(":id")
  @ApiOperation({ summary: "[Admin] Update a lookbook item" })
  update(@Param("id") id: string, @Body() dto: UpdateLookbookItemDto) {
    return this.svc.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "[Admin] Delete a lookbook item" })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { message: "Deleted" };
  }
}
