import { IsString, Length, Matches } from 'class-validator'

/**
 * The provider payment identifier a browser-side payment form produced.
 *
 * Validated for shape only. It is a *claim* about which provider object
 * belongs to this checkout, and it is proved — or rejected — server-side
 * by re-fetching it with the store's own credentials and checking it
 * against the intent (CheckoutService.confirmEmbeddedPayment). The
 * pattern here exists so a hostile value cannot reach a provider URL,
 * not because matching it means anything.
 */
export class ConfirmEmbeddedPaymentDto {
  @IsString()
  @Length(1, 128)
  // Provider ids in this space are UUIDs or opaque alphanumeric tokens.
  // Anything with a slash, a space or a control character is not one.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'payment_reference contains unsupported characters.',
  })
  payment_reference!: string
}
