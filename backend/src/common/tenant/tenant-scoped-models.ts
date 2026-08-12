/**
 * سجل الموديلات المشمولة بحارس العزل.
 *
 * التسجيل صريح عن قصد: الحارس مابيفحصش أي موديل مش مكتوب هنا، فمفيش
 * أي تأثير على أي كود موجود في المشروع.
 *
 * كل موديل فيه store_id لازم يتسجّل هنا. الموديل الغايب مش بيتفحص
 * أصلاً — الحارس بيعدّي عليه من غير ما يقول حاجة، وده أسوأ من غياب
 * الحارس لأنه بيدّي إحساس زائف بالأمان.
 *
 * ⚠️ لما تضيف جدول فيه store_id، ضيفه هنا. في اختبار بيقارن السجل ده
 * بالـ schema وبيفشل لو في موديل ناقص.
 */
export interface TenantScopedModel {
  /** اسم الموديل زي ما هو في Prisma (مش اسم الجدول) */
  readonly model: string
  readonly storeField: string
  /** null لو الموديل مالوش وضع test/live */
  readonly modeField: string | null
  /**
   * اسم العلاقة اللي بتوصّل للمتجر، لو موجودة.
   *
   * Prisma بيقبل الشكلين:
   *   where: { store_id: 5n }        ← scalar
   *   where: { store: { id: 5n } }   ← relation
   *
   * الاتنين نطاق صحيح تماماً. الحارس كان بيعرف الأول بس، فكان بيبلّغ
   * عن استعلام سليم — وحارس بيصرخ على كود صح بيتعلّم الناس يتجاهلوه.
   *
   * الافتراضي 'store'.
   */
  readonly storeRelation?: string
}

export const TENANT_SCOPED_MODELS: readonly TenantScopedModel[] = [
  // ── البنية التحتية (المرحلة 1a) ────────────────────────────────
  { model: 'PaymentIdempotencyRecord', storeField: 'store_id', modeField: 'mode' },
  { model: 'OutboxMessage', storeField: 'store_id', modeField: 'mode' },
  { model: 'ConsumedEvent', storeField: 'store_id', modeField: 'mode' },

  // ── إعدادات الدفع (المرحلة 1b.1) ───────────────────────────────
  { model: 'PaymentAccount', storeField: 'store_id', modeField: 'mode' },
  { model: 'PaymentMethodOffering', storeField: 'store_id', modeField: 'mode' },

  // ── الـ checkout (المرحلة 1b.2) ────────────────────────────────
  { model: 'Checkout', storeField: 'store_id', modeField: 'mode' },
  { model: 'InventoryReservation', storeField: 'store_id', modeField: 'mode' },

  // ── الدفع (المرحلة 1b.2) ───────────────────────────────────────
  { model: 'PaymentIntent', storeField: 'store_id', modeField: 'mode' },
  { model: 'PaymentAttempt', storeField: 'store_id', modeField: 'mode' },
  { model: 'Capture', storeField: 'store_id', modeField: 'mode' },
  { model: 'CaptureAllocation', storeField: 'store_id', modeField: 'mode' },
  { model: 'PaymentEvent', storeField: 'store_id', modeField: 'mode' },

  // ── الاسترداد ──────────────────────────────────────────────────
  { model: 'Refund', storeField: 'store_id', modeField: 'mode' },
  { model: 'RefundAllocation', storeField: 'store_id', modeField: 'mode' },

  // ── الدفتر ─────────────────────────────────────────────────────
  { model: 'Beneficiary', storeField: 'store_id', modeField: 'mode' },
  { model: 'LedgerAccount', storeField: 'store_id', modeField: 'mode' },
  { model: 'JournalEntry', storeField: 'store_id', modeField: 'mode' },

  // ── بيانات المتجر الأصلية ──────────────────────────────────────
  //
  // الجداول دي أقدم من فكرة الـ mode، فمالهاش عمود mode. كلها بيانات
  // مملوكة لمتجر واحد: استعلام من غير store_id عليها بيرجّع كتالوج أو
  // طلبات تاجر تاني.
  //
  // ⚠️ التسجيل هنا **مابيغيّرش أي سلوك حالي**. الحارس بيشتغل بس على
  // الاستعلامات اللي بتعدّي على guarded()، ومفيش خدمة من دول بتستخدمها
  // لسه. التسجيل بيخلي السجل صادق، ولما الخدمات دي تتحوّل بعدين يبقى
  // الحارس شايفها من أول يوم.
  { model: 'Product', storeField: 'store_id', modeField: null },
  { model: 'ProductType', storeField: 'store_id', modeField: null },
  { model: 'Tag', storeField: 'store_id', modeField: null },
  { model: 'Order', storeField: 'store_id', modeField: null },
  { model: 'Upload', storeField: 'store_id', modeField: null },
  { model: 'StoreTheme', storeField: 'store_id', modeField: null },
  { model: 'StoreThemePublished', storeField: 'store_id', modeField: null },
  { model: 'ThemeSection', storeField: 'store_id', modeField: null },
  { model: 'StorePage', storeField: 'store_id', modeField: null },
  { model: 'StoreMenu', storeField: 'store_id', modeField: null },
]

/**
 * موديلات فيها store_id لكن **مش** مشمولة بالحارس، وليه.
 *
 * موجودة كتوثيق صريح: الفرق بين "اتنسي" و"اتقرر" لازم يكون مكتوب.
 */
export const DELIBERATELY_UNSCOPED: readonly { model: string; reason: string }[] = [
  {
    model: 'CheckoutLineItem',
    reason: 'مالوش store_id — مربوط بالـ checkout اللي بيملكه',
  },
  {
    model: 'QuoteComponent',
    reason: 'مالوش store_id — مربوط بالـ checkout اللي بيملكه',
  },
  {
    model: 'LedgerPosting',
    reason: 'مالوش store_id — مربوط بالقيد اللي بيملكه',
  },
]

const BY_MODEL: ReadonlyMap<string, TenantScopedModel> = new Map(
  TENANT_SCOPED_MODELS.map((entry) => [entry.model, entry]),
)

export function getTenantScopedModel(model: string | undefined): TenantScopedModel | undefined {
  if (!model) return undefined
  return BY_MODEL.get(model)
}

/** عمليات القراءة — بتتفحص الـ where */
export const READ_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
])

/** عمليات التعديل والحذف — بتتفحص الـ where كمان */
export const WRITE_WITH_WHERE_OPERATIONS = new Set([
  'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
])

/** عمليات الإنشاء — بتتفحص الـ data */
export const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])