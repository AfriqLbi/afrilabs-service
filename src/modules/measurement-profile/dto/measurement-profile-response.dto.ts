import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class MeasurementFieldResponseDto {
  @ApiProperty({ example: "bust" }) key: string;
  @ApiProperty({ example: "Bust (cm)" }) label: string;
  @ApiProperty({ example: 92 }) value: number;
}

export class MeasurementProfileResponseDto {
  @ApiProperty({ example: "64b1f2c8e3b7a900120d1234" }) _id: string;
  @ApiProperty({ example: "64a1f2c8e3b7a900120d5678" }) userId: string;
  @ApiProperty({ example: "aso-oke-jacket" }) garmentType: string;
  @ApiPropertyOptional({ example: "Aso Oke Jacket" }) garmentLabel: string | null;
  @ApiProperty({ type: [MeasurementFieldResponseDto] }) measurements: MeasurementFieldResponseDto[];
  @ApiPropertyOptional({ example: "Prefer a little extra room" }) notes: string | null;
  @ApiProperty({ example: "2026-06-15T10:30:00.000Z" }) createdAt: string;
  @ApiProperty({ example: "2026-06-20T08:00:00.000Z" }) updatedAt: string;
}
