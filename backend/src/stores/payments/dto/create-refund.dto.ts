import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'

export class CreateRefundDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live'

  /**
   * Amount in minor units. Omit to refund the full remaining balance.
   *
   * A string, not a number: JSON numbers are IEEE doubles and cannot
   * carry large minor-unit values exactly.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'amount_minor must be whole minor units' })
  amount_minor?: string

  @IsOptional() @IsString() @Length(0, 400) reason?: string
}