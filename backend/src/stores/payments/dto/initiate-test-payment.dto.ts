import { IsOptional, IsString, IsUrl, Length } from 'class-validator'

/**
 * Starts a merchant-only TEST payment against a real TEST-mode gateway
 * account. Never touches Order/Checkout — see TestPaymentService.
 */
export class InitiateTestPaymentDto {
  /** A gateway key from the catalog, e.g. 'stripe'. Must support test mode. */
  @IsString()
  @Length(1, 40)
  gateway!: string

  /** Optional: pick a specific method offered by the gateway (e.g. 'card'). */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  method?: string

  /**
   * Where the merchant-only test page wants the payer sent back after a
   * redirect-based provider. Same contract as the storefront checkout's
   * `return_url` — optional, adapter falls back to its configured URL.
   */
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @Length(1, 600)
  return_url?: string
}
