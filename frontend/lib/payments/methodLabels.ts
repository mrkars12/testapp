/**
 * Customer-facing payment method display names — UI only.
 * Precedence:
 * 1. display_name_ar (offering.name_ar)
 * 2. display_name_en (offering.name_en)
 * 3. safe method-key mapping from PaymentMethodKey enum
 * 4. fallback to raw key (never generic duplicate)
 */
export const PAYMENT_METHOD_LABELS_AR: Record<string, string> = {
  card: 'بطاقة ائتمانية',
  mada: 'مدى',
  knet: 'كي نت',
  benefit: 'بنفت',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  // Left in Latin script deliberately: STC Pay is the wallet's own
  // brand name and it is what the provider's own button says, so an
  // Arabic transliteration here would name it something the customer
  // does not then see inside the form.
  stc_pay: 'STC Pay',
  wallet: 'المحفظة الإلكترونية',
  kiosk: 'كشك',
  bank_transfer: 'تحويل بنكي',
  cod: 'الدفع عند الاستلام',
  bnpl: 'الدفع بالتقسيط',
}
export const PAYMENT_METHOD_LABELS_EN: Record<string, string> = {
  card: 'Credit Card',
  mada: 'Mada',
  knet: 'KNET',
  benefit: 'Benefit',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  stc_pay: 'STC Pay',
  wallet: 'Wallet',
  kiosk: 'Kiosk',
  bank_transfer: 'Bank Transfer',
  cod: 'Cash on Delivery',
  bnpl: 'Buy Now Pay Later',
}

/** The label for one method key, with no aggregation. */
function labelForMethod(key: string): string | null {
  const trimmed = key.trim()
  if (!trimmed) return null
  if (PAYMENT_METHOD_LABELS_AR[trimmed]) return PAYMENT_METHOD_LABELS_AR[trimmed]
  if (PAYMENT_METHOD_LABELS_EN[trimmed]) return PAYMENT_METHOD_LABELS_EN[trimmed]
  return trimmed.replace(/_/g, ' ')
}

/**
 * Separator for an experience that covers more than one method.
 *
 * A payment EXPERIENCE is one provider surface, and one surface can host
 * several of our methods — Moyasar's card form accepts mada as a network
 * alongside Visa/Mastercard/Amex, so the merchant's `card` and `mada`
 * offerings are one form. The customer sees one choice, named for
 * everything it accepts ("بطاقة ائتمانية · مدى"), rather than two
 * choices that open the identical form.
 *
 * Composed from the method labels rather than given a new invented name:
 * whatever the merchant enabled is what the label says, and a merchant
 * who turns mada off sees the label change without anyone editing a
 * table of aggregate names.
 */
const METHOD_JOIN = ' · '

export interface OfferingLabelSource {
  method: string
  name_ar: string | null
  name_en: string | null
  /**
   * Every method this experience covers, from the backend's grouping.
   * Absent (older backend) means "just `method`".
   */
  methods?: string[] | null
}

export function resolveMethodDisplayName(offering: OfferingLabelSource): string {
  // A name the merchant typed wins over anything derived, for the whole
  // experience: they named the choice, not one row of it.
  const ar = offering.name_ar?.trim()
  if (ar) return ar
  const en = offering.name_en?.trim()
  if (en) return en

  const grouped = Array.isArray(offering.methods) ? offering.methods : []
  const keys = grouped.length > 0 ? grouped : [offering.method ?? '']

  const labels = keys.map(labelForMethod).filter((label): label is string => label !== null)
  if (labels.length === 0) return 'طريقة دفع'

  // De-duplicated: two offerings of the same method on one form must not
  // produce "مدى · مدى".
  return [...new Set(labels)].join(METHOD_JOIN)
}
