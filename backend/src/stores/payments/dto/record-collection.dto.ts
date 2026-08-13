import { IsIn, IsOptional, IsString, Length } from 'class-validator'

export class RecordCollectionDto {
  @IsOptional()
  @IsIn(['test', 'live'])
  mode?: 'test' | 'live'

  /** Free-text note, e.g. courier name or bank transfer reference. */
  @IsOptional()
  @IsString()
  @Length(0, 400)
  reference?: string
}