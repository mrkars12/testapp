import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator'

export class UpdateSectionDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsOptional()
  settings?: any

  @IsOptional()
  blocks?: any[]

  @IsNumber()
  @IsOptional()
  sortOrder?: number

  @IsBoolean()
  @IsOptional()
  isActive?: boolean
}
