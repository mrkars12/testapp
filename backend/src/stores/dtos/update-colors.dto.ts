import { IsString, IsOptional } from 'class-validator'

export class UpdateColorsDto {
  @IsString() @IsOptional() primary?: string
  @IsString() @IsOptional() secondary?: string
  @IsString() @IsOptional() accent?: string
  @IsString() @IsOptional() background?: string
  @IsString() @IsOptional() surface?: string
  @IsString() @IsOptional() textPrimary?: string
  @IsString() @IsOptional() textSecondary?: string
  @IsString() @IsOptional() textMuted?: string
  @IsString() @IsOptional() border?: string
  @IsString() @IsOptional() headerBg?: string
  @IsString() @IsOptional() headerText?: string
  @IsString() @IsOptional() footerBg?: string
  @IsString() @IsOptional() footerText?: string
}
