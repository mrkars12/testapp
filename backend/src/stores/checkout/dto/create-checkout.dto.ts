import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutItemDto {
  @IsString()
  @Length(1, 40)
  variant_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsString()
  @Length(2, 160)
  customer_name!: string;

  @IsString()
  @Length(5, 40)
  customer_phone!: string;

  @IsOptional()
  @IsEmail()
  customer_email?: string;

  @IsString()
  @Length(3, 400)
  address_line!: string;

  @IsString()
  @Length(2, 120)
  city!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  /** offering id from GET /storefront/:slug/payment-methods */
  @IsString()
  @Length(1, 40)
  payment_offering_id!: string;

  /**
   * Where the storefront wants the payer sent back after a redirect.
   *
   * Optional, and the only source of a per-checkout return URL: a
   * gateway that redirects (Tap, and any future one) receives it as
   * `PaymentCallContext.returnUrl`. When it is absent the adapter falls
   * back to whatever the merchant configured on the payment account,
   * which is why existing clients keep working unchanged.
   */
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @Length(1, 600)
  return_url?: string;

  /**
   * The checkout this one is being created to REPLACE.
   *
   * Sent by the storefront when a customer retries a declined payment or
   * changes their payment method: both release the checkout they were
   * on and create a new one, and nothing else records that the two are
   * the same purchase. Without it, a browser history entry carrying the
   * older token resolves that checkout in isolation, and its truthful
   * "failed" becomes the current state of a purchase already paid for.
   *
   * IDENTITY ONLY, and a CLAIM — it is stored as a relation between two
   * checkout rows and nothing else, and it can never assert an outcome:
   * whether the successor was paid is read from the successor's own
   * record. Validated server-side against the store, the mode, and the
   * predecessor's own state; anything that does not check out is
   * ignored rather than refused, so this cannot be used to probe which
   * tokens exist.
   *
   * The shape is asserted here because it is public knowledge (a
   * checkout token is 32 hex characters, `randomUUID()` without its
   * dashes) and tells an attacker nothing they did not already know.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{32}$/)
  supersedes_checkout_token?: string;
}
