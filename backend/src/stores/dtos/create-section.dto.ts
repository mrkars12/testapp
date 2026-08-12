import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator'

export class CreateSectionDto {
  @IsString()
  type: string

  @IsString()
  name: string

  @IsOptional()
  settings?: any

  @IsOptional()
  blocks?: any[]

  @IsNumber()
  @IsOptional()
  sortOrder?: number

  @IsString()
  @IsOptional()
  pageType?: string = 'home'
}
