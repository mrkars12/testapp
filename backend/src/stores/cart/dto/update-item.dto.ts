import { IsInt, Max, Min } from 'class-validator';

/**
 * A new quantity for a line already in the cart.
 *
 * Zero is allowed and means "remove", so the storefront's quantity
 * stepper has one endpoint rather than a special case at 1.
 */
export class UpdateCartItemDto {
  @IsInt()
  @Min(0)
  @Max(999)
  quantity!: number;
}
