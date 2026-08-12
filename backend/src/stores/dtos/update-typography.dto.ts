import { IsString, IsNumber, IsOptional } from 'class-validator'

export class UpdateTypographyDto {
  @IsString() @IsOptional() headingFont?: string
  @IsString() @IsOptional() bodyFont?: string
  @IsString() @IsOptional() baseSize?: string
  @IsNumber() @IsOptional() scale?: number
  @IsString() @IsOptional() h1Size?: string
  @IsString() @IsOptional() h2Size?: string
  @IsString() @IsOptional() h3Size?: string
  @IsNumber() @IsOptional() lineHeight?: number
  @IsString() @IsOptional() letterSpacing?: string
}
