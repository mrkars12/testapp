import { IsIn, IsOptional, IsString, Length } from 'class-validator'

export class VoidPaymentDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live'

  @IsOptional() @IsString() @Length(0, 400) reason?: string
}
