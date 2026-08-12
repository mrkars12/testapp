/**
 * ══════════════════════════════════════════════════════════════════
 * كتالوج البوابات
 * ══════════════════════════════════════════════════════════════════
 *
 * وصف ذاتي لكل بوابة: اسمها، وسائل الدفع اللي بتقدّمها، والحقول اللي
 * التاجر لازم يدخلها. الواجهة بتبني الفورم من الميتاداتا دي، فإضافة
 * بوابة جديدة مابتحتاجش أي تعديل في الواجهة.
 *
 * ⚠️ الكتالوج ده **إعدادات بس** في المرحلة 1b.1 — مفيش ولا أدابتر
 * بيكلّم بوابة لسه. أول أدابتر (الدفع عند الاستلام والتحويل البنكي)
 * بييجي في 1b.2، والبوابات الأونلاين في المرحلة 2 وبعدها.
 *
 * البوابات اللي مش هنا مش هتظهر للتاجر، حتى لو موجودة في enum
 * PaymentProviderKey. ده مقصود: أحسن من إننا نعرض بوابة مالهاش تنفيذ.
 */

/** نوع حقل الاعتماد — الواجهة بترسم الـ input على أساسه */
export type CredentialFieldType = 'text' | 'password' | 'select' | 'textarea'

export interface CredentialFieldSpec {
  /** المفتاح اللي بيتخزّن بيه داخل blob الاعتمادات المشفّر */
  readonly key: string
  readonly label_ar: string
  readonly label_en: string
  readonly type: CredentialFieldType
  readonly required: boolean
  /** للنوع select */
  readonly options?: readonly { value: string; label_ar: string; label_en: string }[]
  readonly placeholder?: string
  /** يظهر تحت الحقل كتلميح للتاجر */
  readonly help_ar?: string
}

export interface GatewayDefinition {
  /** لازم يكون قيمة موجودة في enum PaymentProviderKey */
  readonly key: string
  readonly name_ar: string
  readonly name_en: string
  /** false للطرق اليدوية زي الدفع عند الاستلام */
  readonly requires_credentials: boolean
  readonly supports_test_mode: boolean
  /** وسائل الدفع اللي البوابة دي بتقدّمها — قيم من enum PaymentMethodKey */
  readonly methods: readonly string[]
  /**
   * true لو البوابة بتقدّم أكتر من تكامل تحت نفس الحساب، وبالتالي
   * التاجر ممكن يعمل أكتر من offering لنفس الوسيلة.
   */
  readonly supports_multiple_integrations: boolean
  readonly credential_fields: readonly CredentialFieldSpec[]
}

const secret = (
  key: string,
  label_ar: string,
  label_en: string,
  required = true,
): CredentialFieldSpec => ({ key, label_ar, label_en, type: 'password', required })

const text = (
  key: string,
  label_ar: string,
  label_en: string,
  required = true,
): CredentialFieldSpec => ({ key, label_ar, label_en, type: 'text', required })

const GATEWAYS: readonly GatewayDefinition[] = [
  // ── طرق يدوية — مفيش بوابة ولا مفاتيح ──────────────────────────
  {
    key: 'cod',
    name_ar: 'الدفع عند الاستلام',
    name_en: 'Cash on Delivery',
    requires_credentials: false,
    supports_test_mode: false,
    methods: ['cod'],
    supports_multiple_integrations: false,
    credential_fields: [],
  },
  {
    key: 'bank_transfer',
    name_ar: 'تحويل بنكي',
    name_en: 'Bank Transfer',
    // Not secrets, but the encrypted credential blob is the only
    // per-account storage that exists, and the merchant must fill these
    // in before the method can be offered at checkout.
    requires_credentials: true,
    supports_test_mode: false,
    methods: ['bank_transfer'],
    supports_multiple_integrations: false,
    credential_fields: [
      {
        key: 'bank_name',
        label_ar: 'اسم البنك',
        label_en: 'Bank name',
        type: 'text',
        required: true,
      },
      {
        key: 'account_holder',
        label_ar: 'اسم صاحب الحساب',
        label_en: 'Account holder',
        type: 'text',
        required: true,
      },
      {
        key: 'account_number',
        label_ar: 'رقم الحساب',
        label_en: 'Account number',
        type: 'text',
        required: false,
      },
      {
        key: 'iban',
        label_ar: 'الآيبان',
        label_en: 'IBAN',
        type: 'text',
        required: false,
      },
      {
        key: 'swift',
        label_ar: 'سويفت',
        label_en: 'SWIFT / BIC',
        type: 'text',
        required: false,
      },
      {
        key: 'instructions',
        label_ar: 'تعليمات للعميل',
        label_en: 'Instructions for the customer',
        type: 'textarea',
        required: false,
      },
    ],
  },

  // ── بوابات أونلاين ─────────────────────────────────────────────
  {
    key: 'stripe',
    name_ar: 'سترايب',
    name_en: 'Stripe',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'apple_pay', 'google_pay'],
    supports_multiple_integrations: false,
    credential_fields: [
      text('publishable_key', 'المفتاح العام', 'Publishable key'),
      secret('secret_key', 'المفتاح السري', 'Secret key'),
      secret('webhook_secret', 'سر الـ webhook', 'Webhook signing secret', false),
    ],
  },
  {
    key: 'paymob',
    name_ar: 'باي موب',
    name_en: 'Paymob',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'wallet', 'kiosk'],
    // باي موب بيدي integration_id مختلف لكل وسيلة
    supports_multiple_integrations: true,
    credential_fields: [
      secret('api_key', 'مفتاح الـ API', 'API key'),
      text('merchant_id', 'رقم التاجر', 'Merchant ID', false),
      secret('hmac_secret', 'مفتاح الـ HMAC', 'HMAC secret'),
    ],
  },
  {
    key: 'moyasar',
    name_ar: 'ميسر',
    name_en: 'Moyasar',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'mada', 'apple_pay'],
    supports_multiple_integrations: false,
    credential_fields: [
      text('publishable_key', 'المفتاح العام', 'Publishable key'),
      secret('secret_key', 'المفتاح السري', 'Secret key'),
      secret('webhook_secret', 'سر الـ webhook', 'Webhook secret', false),
    ],
  },
  {
    key: 'tap',
    name_ar: 'تاب',
    name_en: 'Tap Payments',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'mada', 'knet', 'benefit', 'apple_pay'],
    supports_multiple_integrations: false,
    credential_fields: [
      secret('secret_key', 'المفتاح السري', 'Secret key'),
      text('publishable_key', 'المفتاح العام', 'Publishable key', false),
    ],
  },
  {
    key: 'my_fatoorah',
    name_ar: 'ماي فاتورة',
    name_en: 'MyFatoorah',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'knet', 'benefit', 'apple_pay'],
    supports_multiple_integrations: false,
    credential_fields: [
      secret('api_token', 'رمز الـ API', 'API token'),
    ],
  },
  {
    key: 'fawry',
    name_ar: 'فوري',
    name_en: 'Fawry',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'wallet', 'kiosk'],
    supports_multiple_integrations: false,
    credential_fields: [
      text('merchant_code', 'كود التاجر', 'Merchant code'),
      secret('security_key', 'مفتاح الأمان', 'Security key'),
    ],
  },
]

const BY_KEY: ReadonlyMap<string, GatewayDefinition> = new Map(
  GATEWAYS.map((g) => [g.key, g]),
)

export function listGateways(): readonly GatewayDefinition[] {
  return GATEWAYS
}

export function findGateway(key: string): GatewayDefinition | undefined {
  return BY_KEY.get(key)
}

export function isSupportedGateway(key: string): boolean {
  return BY_KEY.has(key)
}

/** مفاتيح الاعتماد المسموحة للبوابة دي — أي مفتاح غيرها بيترفض */
export function allowedCredentialKeys(key: string): readonly string[] {
  return findGateway(key)?.credential_fields.map((f) => f.key) ?? []
}

/** الوسائل المسموحة للبوابة دي */
export function allowedMethods(key: string): readonly string[] {
  return findGateway(key)?.methods ?? []
}
