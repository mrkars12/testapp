import { IsBoolean, IsString, IsOptional } from 'class-validator'

export class UpdateHeaderDto {
  @IsBoolean() @IsOptional() showSearch?: boolean
  @IsBoolean() @IsOptional() showAccount?: boolean
  @IsBoolean() @IsOptional() showCart?: boolean
  @IsBoolean() @IsOptional() sticky?: boolean
  @IsString() @IsOptional() background?: string
  @IsString() @IsOptional() textColor?: string
  @IsString() @IsOptional() logoPosition?: 'left' | 'center'
  @IsString() @IsOptional() menuPosition?: 'left' | 'center' | 'right'
}
