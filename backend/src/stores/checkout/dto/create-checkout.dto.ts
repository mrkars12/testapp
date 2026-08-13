import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator'

export class CheckoutItemDto {
  @IsString()
  @Length(1, 40)
  variant_id!: string

  @IsInt()
  @Min(1)
  quantity!: number
}

export class CreateCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[]

  @IsString()
  @Length(2, 160)
  customer_name!: string

  @IsString()
  @Length(5, 40)
  customer_phone!: string

  @IsOptional()
  @IsEmail()
  customer_email?: string

  @IsString()
  @Length(3, 400)
  address_line!: string

  @IsString()
  @Length(2, 120)
  city!: string

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string

  /** offering id from GET /storefront/:slug/payment-methods */
  @IsString()
  @Length(1, 40)
  payment_offering_id!: string
}