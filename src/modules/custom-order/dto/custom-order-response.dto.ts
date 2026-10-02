import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MeasurementFieldResponseDto } from "../../measurement-profile/dto/measurement-profile-response.dto";

export class CustomOrderMeasurementSnapshotResponseDto {
  @ApiPropertyOptional({ example: "64b1f2c8e3b7a900120d1234" }) profileId: string | null;
  @ApiProperty({ example: "aso-oke-jacket" }) garmentType: string;
  @ApiPropertyOptional({ example: "Aso Oke Jacket" }) garmentLabel: string | null;
  @ApiProperty({ type: [MeasurementFieldResponseDto] }) fields: MeasurementFieldResponseDto[];
}

export class CustomOrderResponseDto {
  @ApiProperty({ example: "64b1f2c8e3b7a900120d9999" }) _id: string;
  @ApiProperty({ example: "CO-1001" }) referenceNumber: string;
  @ApiPropertyOptional({ example: "64a1f2c8e3b7a900120d5678" }) customerId: string | null;
  @ApiProperty({ example: "chioma@example.com" }) customerEmail: string;
  @ApiProperty({ example: "Chioma Okafor" }) customerName: string;
  @ApiPropertyOptional({ example: "+2348099887766" }) customerPhone: string | null;
  @ApiProperty({ example: "A custom navy Aso Oke jacket..." }) description: string;
  @ApiProperty({ example: "Aso Oke Jacket" }) garmentCategory: string;
  @ApiPropertyOptional({ example: "Aso Oke — navy and gold" }) fabricChoice: string | null;
  @ApiProperty({ type: [String] }) referenceImages: string[];
  @ApiPropertyOptional({ type: CustomOrderMeasurementSnapshotResponseDto }) measurement: CustomOrderMeasurementSnapshotResponseDto | null;
  @ApiProperty({ example: "pending_review" }) status: string;
  @ApiPropertyOptional({ example: 85000 }) quotedPrice: number | null;
  @ApiPropertyOptional({ example: "2026-09-20" }) estimatedReadyDate: string | null;
  @ApiPropertyOptional({ example: "Includes fabric sourcing..." }) adminQuoteNote: string | null;
  @ApiPropertyOptional({ example: "paystack" }) paymentProvider: string | null;
  @ApiPropertyOptional({ example: "https://checkout.paystack.com/..." }) checkoutUrl: string | null;
  @ApiPropertyOptional({ example: "https://wa.me/2348000000000?text=..." }) whatsappLink: string | null;
  @ApiPropertyOptional({ example: "64b1f2c8e3b7a900120daaaa" }) linkedOrderId: string | null;
  @ApiProperty({ example: "2026-06-15T10:30:00.000Z" }) createdAt: string;
  @ApiProperty({ example: "2026-06-20T08:00:00.000Z" }) updatedAt: string;
}

export class InitializeCustomOrderPaymentResponseDto {
  @ApiProperty({ example: "https://checkout.paystack.com/abc123" }) checkoutUrl: string;
  @ApiProperty({ example: "CO-1001-ABC123" }) paymentReference: string;
}
