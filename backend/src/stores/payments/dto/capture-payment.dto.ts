import { IsIn, IsOptional, IsString, Matches } from 'class-validator'

export class CapturePaymentDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live'

  /**
   * Amount in minor units. Omit to capture the full authorised balance.
   *
   * A string, not a number: JSON numbers are IEEE doubles and cannot
   * carry large minor-unit values exactly — same reasoning as
   * CreateRefundDto.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'amount_minor must be whole minor units' })
  amount_minor?: string
}
