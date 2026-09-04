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

export interface WebhookEventSpec {
  readonly key: string
  readonly label_ar: string
  readonly required: boolean
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
  /**
   * الأحداث اللي الأدابتر فعلاً بيتعامل معاها — مطابقة لـ
   * HANDLED_EVENT_TYPES/isRecognised* في كل *-fact-map.ts. مفيش حدث
   * هنا مذكور تخمينياً؛ لو الأدابتر مابيعملهوش، مابيظهرش هنا. فاضية
   * للبوابات اليدوية واللي لسه من غير أدابتر.
   */
  readonly webhook_events?: readonly WebhookEventSpec[]
  /** شرح مختصر للتاجر: إزاي يهيّئ الـ webhook عند البوابة دي. */
  readonly webhook_setup_help_ar?: string
  /**
   * true لو السيرفر يقدر يولّد الـ webhook secret نفسه (زر "إنشاء
   * Secret Token") بدل ما يتوقّع إن التاجر يخترعه بنفسه ويلصقه.
   * موجودة فقط عند ميسر حالياً — بوابات زي Stripe/Paymob/Tap ليها
   * موديل أمان خاص بيها (signing secret من لوحتها هي، أو HMAC/hashstring
   * بمفتاح موجود بالفعل) ومحتاجاش السلوك ده. Default: false.
   */
  readonly supports_generated_webhook_secret?: boolean
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
      {
        key: 'webhook_secret',
        label_ar: 'سر الـ webhook',
        label_en: 'Webhook signing secret',
        type: 'password',
        required: false,
        help_ar:
          'من Stripe Dashboard → Developers → Webhooks → افتح الـ Endpoint اللي أنشأته → "Signing secret" → Reveal → انسخ القيمة (تبدأ بـ whsec_).',
      },
    ],
    webhook_events: [
      { key: 'payment_intent.succeeded', label_ar: 'نجاح الدفع', required: true },
      { key: 'payment_intent.payment_failed', label_ar: 'فشل الدفع', required: true },
      { key: 'checkout.session.expired', label_ar: 'انتهاء صلاحية الجلسة', required: true },
      { key: 'payment_intent.amount_capturable_updated', label_ar: 'تفويض قابل للتحصيل', required: false },
      { key: 'payment_intent.canceled', label_ar: 'إلغاء الدفع', required: false },
      { key: 'charge.refunded', label_ar: 'استرداد المبلغ', required: false },
      { key: 'refund.updated', label_ar: 'تحديث حالة الاسترداد', required: false },
      { key: 'charge.dispute.created', label_ar: 'فتح نزاع', required: false },
      { key: 'charge.dispute.closed', label_ar: 'إغلاق نزاع', required: false },
    ],
    webhook_setup_help_ar:
      'أنشئ Endpoint جديد من Stripe Dashboard → Developers → Webhooks، الصق رابط الـ webhook هنا بالأسفل، اختر الأحداث المطلوبة، ثم انسخ Signing secret (يبدأ بـ whsec_) والصقه في حقل "سر الـ webhook".',
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
    // الحقول دي بتطابق تدفّق الـ Intention API الحالي:
    //   secret_key  → Authorization: Token … للـ intention والـ capture/void/refund
    //   public_key  → رابط الـ Unified Checkout
    //   api_key     → توليد auth token للاستعلام عن حالة المعاملة
    //   hmac_secret → التحقق من توقيع الـ callback
    // المصدر: developers.paymob.com — Getting Integration Credentials
    credential_fields: [
      secret('secret_key', 'المفتاح السري', 'Secret key'),
      text('public_key', 'المفتاح العام', 'Public key'),
      secret('api_key', 'مفتاح الـ API', 'API key'),
      {
        key: 'hmac_secret',
        label_ar: 'مفتاح الـ HMAC',
        label_en: 'HMAC secret',
        type: 'password',
        required: true,
        help_ar:
          'من لوحة باي موب → Settings → Payment Integrations → HMAC — انسخ القيمة كما هي والصقها هنا؛ هي نفسها اللي بيوقّع بيها باي موب كل TRANSACTION callback.',
      },
    ],
    webhook_events: [
      { key: 'TRANSACTION', label_ar: 'إشعار المعاملة (نجاح/فشل/استرداد/إبطال)', required: true },
    ],
    webhook_setup_help_ar:
      'باي موب بترسل كل شيء عبر callback واحد اسمه TRANSACTION، محمي بتوقيع HMAC وليس بسر منفصل. من لوحة باي موب → Developers → Callbacks، فعّل Transaction processed callback على رابط الـ webhook بالأسفل، وتأكد أن مفتاح HMAC فوق مطابق تماماً للي في لوحة التاجر.',
  },
  {
    key: 'moyasar',
    name_ar: 'ميسر',
    name_en: 'Moyasar',
    requires_credentials: true,
    supports_test_mode: true,
    // STC Pay is a method of the SAME embedded form as card/mada/Apple
    // Pay (`stcpay` in the pinned bundle) — it is listed here because
    // the merchant switches it on like any other method, not because it
    // is a second surface. It needs no credential field of its own; the
    // only external step is enabling STC Pay on the Moyasar account.
    methods: ['card', 'mada', 'apple_pay', 'stc_pay'],
    supports_multiple_integrations: false,
    // الحقول دي بتطابق تدفّق الـ Invoices الحالي:
    //   secret_key     → Basic auth لكل نداءات الخادم (الفاتورة والاسترداد)
    //   webhook_secret → الـ secret token اللي التاجر بيحطه على الـ webhook
    //                    في لوحة ميسر، وبيرجع في جسم كل إشعار
    //   publishable_key → للواجهة بس (Create Payment)، الأدابتر مابيستخدمهوش
    // المصدر: docs.moyasar.com — Authentication / Configure Webhooks
    credential_fields: [
      secret('secret_key', 'المفتاح السري', 'Secret key'),
      {
        key: 'webhook_secret',
        label_ar: 'رمز الـ webhook السري',
        label_en: 'Webhook secret token',
        type: 'password',
        // اختياري في نموذج الاعتماد الأساسي عمداً: إعداد الحساب (secret_key)
        // وإعداد الـ webhook همّان منفصلان — التاجر لازم يقدر يحفظ ويفعّل
        // حساب ميسر شغّال من غير ما يكون هيّأ الـ webhook لسه. مصدر القيمة
        // ده بقى غالباً زر "إنشاء Secret Token" في لوحة Webhook Setup
        // (PaymentAccountService.generateWebhookSecret)، مش هنا — الحقل
        // ده لسه موجود عشان لو التاجر حب يلصق سر اختاره هو بنفسه بدل ما
        // يخلّي السيرفر يولّده.
        required: false,
        help_ar:
          'اختياري هنا — ممكن تسيبه فاضي وتضغط "إنشاء Secret Token" في قسم إعداد الـ Webhook تحت بعد ما تحفظ الحساب، أو تلصق قيمة من اختيارك من لوحة ميسر → Webhooks → Secret Token.',
      },
      text('publishable_key', 'المفتاح العام', 'Publishable key', false),
      // ── Apple Pay داخل نفس نموذج ميسر المضمّن ────────────────────
      //
      // مش أسرار — بس التخزين الوحيد لكل حساب هو blob الاعتمادات، وده
      // اللي بيخلّي إعداد Apple Pay متربط بالحساب الصح: متجرين على
      // نفس البوابة بحسابين مختلفين بيبقى لكل واحد اسم عرض ودولة
      // مختلفين، من غير أي إعداد عام مشترك.
      //
      // نموذج ميسر بيرمي استثناء لو الاسم أو الدولة ناقصين، فالمنهج:
      // الحقلين دول موجودين → Apple Pay بيتعرض جوه النموذج المضمّن.
      // ناقصين → بيرجع لفاتورة ميسر المستضافة (تحويل آمن ثم العودة).
      // المصدر: cdn.moyasar.com/mpf/1.19.0/moyasar.js + docs.moyasar.com
      {
        key: 'apple_pay_label',
        label_ar: 'Apple Pay — اسم التاجر المعروض',
        label_en: 'Apple Pay merchant label',
        type: 'text',
        required: false,
        placeholder: 'اسم متجرك كما يظهر في نافذة Apple Pay',
        help_ar:
          'مطلوب لتفعيل Apple Pay داخل صفحة الدفع نفسها. لو تركته فارغًا هيشتغل Apple Pay عبر صفحة ميسر المستضافة بدل الدفع داخل الصفحة.',
      },
      {
        key: 'apple_pay_country',
        label_ar: 'Apple Pay — كود دولة التاجر',
        label_en: 'Apple Pay merchant country',
        type: 'text',
        required: false,
        placeholder: 'SA',
        help_ar:
          'حرفان بصيغة ISO 3166 (مثال: SA). مطلوب مع اسم التاجر لتفعيل Apple Pay داخل الصفحة.',
      },
      {
        key: 'apple_pay_supported_countries',
        label_ar: 'Apple Pay — الدول المسموح بها (اختياري)',
        label_en: 'Apple Pay supported countries',
        type: 'text',
        required: false,
        placeholder: 'SA, AE',
        help_ar:
          'اختياري. اتركه فارغًا ليستخدم النموذج القيمة الافتراضية من ميسر (SA).',
      },
      {
        key: 'apple_pay_merchant_capabilities',
        label_ar: 'Apple Pay — قدرات التاجر (اختياري)',
        label_en: 'Apple Pay merchant capabilities',
        type: 'text',
        required: false,
        placeholder: 'supports3DS, supportsCredit, supportsDebit',
        help_ar:
          'اختياري. اتركه فارغًا ليستخدم الافتراضي: supports3DS و supportsCredit و supportsDebit.',
      },
    ],
    webhook_events: [
      { key: 'payment_paid', label_ar: 'نجاح الدفع', required: true },
      { key: 'payment_failed', label_ar: 'فشل الدفع', required: true },
      { key: 'payment_authorized', label_ar: 'تفويض الدفع', required: false },
      { key: 'payment_captured', label_ar: 'تحصيل الدفع', required: false },
      { key: 'payment_voided', label_ar: 'إبطال الدفع', required: false },
      { key: 'payment_refunded', label_ar: 'استرداد المبلغ', required: false },
      { key: 'payment_abandoned', label_ar: 'التخلي عن الدفع', required: false },
    ],
    webhook_setup_help_ar:
      '1. احفظ بيانات ميسر أولًا. 2. انسخ رابط الـ Webhook تحت. 3. اضغط "إنشاء Secret Token" واحفظ القيمة الظاهرة (بتتعرض مرة واحدة بس). 4. افتح لوحة ميسر → Webhooks → Add webhook. 5. الصق رابط الـ Webhook. 6. ضع نفس الـ Secret Token في حقل Secret Token هناك. 7. Method = POST. 8. فعّل الأحداث: payment_paid و payment_failed على الأقل. 9. احفظ. 10. نفّذ عملية اختبار حقيقية من صفحة "اختبار بوابة الدفع" وانتظر وصول الإشعار — الحالة هتتحول لـ "تم التحقق" تلقائيًا.',
    supports_generated_webhook_secret: true,
  },
  {
    key: 'tap',
    name_ar: 'تاب',
    name_en: 'Tap Payments',
    requires_credentials: true,
    supports_test_mode: true,
    methods: ['card', 'mada', 'knet', 'benefit', 'apple_pay'],
    supports_multiple_integrations: false,
    // الحقول دي بتطابق تدفّق الـ Charges (redirect) الحالي:
    //   secret_key   → Authorization: Bearer sk_… لكل نداءات الخادم،
    //                  وكمان مفتاح الـ HMAC بتاع الـ hashstring في الـ webhook
    //                  (تاب مابيصدرش سر توقيع منفصل)
    //   merchant_id  → merchant.id في طلب الـ charge
    //   redirect_url → redirect.url، وهو حقل **مطلوب** في Create a Charge
    //   post_url     → post.url، ومن غيره تاب مابيبعتش أي webhook
    //   publishable_key → للـ SDKs بس، الأدابتر مابيستخدمهوش
    // المصدر: developers.tap.company — Create a Charge / Webhook /
    //          Get Started (API keys)
    credential_fields: [
      {
        key: 'secret_key',
        label_ar: 'المفتاح السري',
        label_en: 'Secret key',
        type: 'password',
        required: true,
        help_ar:
          'من developers.tap.company → Get Started → API Keys → انسخ Secret Key (يبدأ بـ sk_). تاب بيستخدمه في كل نداء للخادم، وكمان لتوقيع الـ webhook — تاب مالهوش سر توقيع منفصل.',
      },
      text('merchant_id', 'معرّف التاجر', 'Merchant ID', false),
      {
        key: 'redirect_url',
        label_ar: 'رابط رجوع العميل',
        label_en: 'Customer redirect URL',
        type: 'text',
        required: true,
        help_ar: 'تاب بيطلبه في كل عملية، والعميل بيرجع عليه بعد الدفع.',
      },
      {
        key: 'post_url',
        label_ar: 'رابط إشعارات تاب',
        label_en: 'Tap webhook (post) URL',
        type: 'text',
        required: true,
        help_ar: 'رابط الـ webhook بتاع الحساب ده. من غيره تاب مش هيبعت إشعارات.',
      },
      text('publishable_key', 'المفتاح العام', 'Publishable key', false),
    ],
    webhook_events: [
      { key: 'charge.status', label_ar: 'حالة عملية الدفع (نجاح/فشل/إلغاء)', required: true },
    ],
    webhook_setup_help_ar:
      'تاب مالهاش سر توقيع منفصل — "رابط إشعارات تاب" فوق هو نفسه رابط الـ webhook، ومحمي بـ hashstring مبني من نفس المفتاح السري. رابط رجوع العميل (redirect_url) مختلف تماماً: هو اللي المتصفح بيرجّع عليه العميل بعد الدفع، مش الخادم.',
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
