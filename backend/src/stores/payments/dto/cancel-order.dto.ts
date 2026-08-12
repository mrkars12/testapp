import { IsIn, IsOptional, IsString, Length } from 'class-validator'

export class CancelOrderDto {
  @IsOptional()
  @IsIn(['test', 'live'])
  mode?: 'test' | 'live'

  @IsOptional()
  @IsString()
  @Length(0, 400)
  reason?: string

  /**
   * Skip restocking, e.g. when the goods were lost rather than returned.
   * Defaults to restocking.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  restock?: 'true' | 'false'
}