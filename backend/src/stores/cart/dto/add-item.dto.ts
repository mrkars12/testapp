import { IsInt, IsString, Length, Max, Min } from 'class-validator';

/**
 * One line going into the cart.
 *
 * No price, no title, no image. The server knows a cart line as a
 * variant and a quantity and nothing else, so there is no field here a
 * browser could use to influence what it is eventually charged.
 */
export class AddCartItemDto {
  @IsString()
  @Length(1, 40)
  variant_id!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}
