import {
  CREATE_OPERATIONS,
  READ_OPERATIONS,
  WRITE_WITH_WHERE_OPERATIONS,
  getTenantScopedModel,
} from './tenant-scoped-models'

/**
 * ══════════════════════════════════════════════════════════════════
 * فحص نطاق المستأجر — منطق خالص
 * ══════════════════════════════════════════════════════════════════
 *
 * منفصل عن الـ extension عن قصد: كده المنطق بيتغطّى باختبارات وحدة
 * من غير قاعدة بيانات ومن غير عميل Prisma مولّد.
 *
 * ⚠️ الفحص **بيبلّغ بس**. مابيعدّلش الاستعلام، ومابيضيفش شروط، ومابيمنعش
 * أي عملية — عشان مايبقاش في سلوك خفي بيغيّر نتايج الاستعلامات من ورا
 * المطوّر.
 */

export type ScopeViolationKind =
  /** استعلام على موديل مشمول من غير store_id في الـ where */
  | 'missing_store_scope'
  | 'missing_mode_scope'
  | 'missing_store_value'
  | 'missing_mode_value'
  /** الاستعلام بيستهدف متجر غير المتجر اللي في سياق الطلب */
  | 'store_scope_mismatch'

export interface ScopeViolation {
  readonly kind: ScopeViolationKind
  readonly model: string
  readonly operation: string
  readonly detail: string
}

export interface InspectionInput {
  readonly model: string | undefined
  readonly operation: string
  readonly args: unknown
  /** معرّف المتجر من سياق الطلب، لو موجود */
  readonly contextStoreId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * هل الحقل مقيّد في الـ where؟
 *
 * بيدوّر جوه AND كمان، لأن الشكل ده شائع:
 *   where: { AND: [{ store_id: 1n }, { status: 'pending' }] }
 *
 * OR مابيتحسبش عن قصد: شرط جوه OR ممكن يتحقق من غير ما الحقل يتقيّد،
 * فوجوده هناك مش ضمانة عزل.
 */
function fieldConstrained(
  where: unknown,
  field: string,
  relation?: string,
): boolean {
  if (!isRecord(where)) return false
  if (Object.prototype.hasOwnProperty.call(where, field)) return true

  // الشكل العلائقي: where: { store: { id: 5n } }
  //
  // نطاق صحيح زي الـ scalar بالظبط. بنقبله لما العلاقة بتقيّد المفتاح
  // الأساسي أو المفتاح الأجنبي — مش مجرد وجود العلاقة، عشان
  // { store: { name: 'x' } } مايعدّيش كأنه نطاق.
  if (relation && isRecord(where[relation])) {
    const nested = where[relation] as Record<string, unknown>
    if (
      Object.prototype.hasOwnProperty.call(nested, 'id') ||
      Object.prototype.hasOwnProperty.call(nested, field)
    ) {
      return true
    }
  }

  const and = where.AND
  if (Array.isArray(and)) {
    return and.some((clause) => fieldConstrained(clause, field, relation))
  }
  if (isRecord(and)) return fieldConstrained(and, field, relation)

  return false
}

/** يستخرج قيمة الحقل لو كانت قيمة مباشرة أو بشكل { equals } */
/** بيطلّع قيمة المتجر من الشكل العلائقي: { store: { id: 5n } } */
function extractRelationScalar(
  where: unknown,
  relation: string,
  field: string,
): unknown {
  if (!isRecord(where)) return undefined

  const nested = where[relation]
  if (isRecord(nested)) {
    const value = nested.id ?? nested[field]
    if (value !== undefined) {
      if (isRecord(value) && 'equals' in value) return value.equals
      return value
    }
  }

  const and = where.AND
  if (Array.isArray(and)) {
    for (const clause of and) {
      const found = extractRelationScalar(clause, relation, field)
      if (found !== undefined) return found
    }
  }

  return undefined
}

function extractScalar(where: unknown, field: string): unknown {
  if (!isRecord(where)) return undefined
  const direct = where[field]
  if (direct !== undefined) {
    if (isRecord(direct) && 'equals' in direct) return direct.equals
    return direct
  }
  const and = where.AND
  if (Array.isArray(and)) {
    for (const clause of and) {
      const found = extractScalar(clause, field)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** بيرجّع صفوف الـ data سواء كانت صف واحد أو مجموعة */
function payloadsOf(args: unknown): unknown[] {
  if (!isRecord(args)) return []
  const data = args.data
  if (Array.isArray(data)) return data
  if (isRecord(data)) return [data]
  return []
}

export function inspectScope(input: InspectionInput): ScopeViolation[] {
  const scoped = getTenantScopedModel(input.model)
  if (!scoped) return [] // موديل مش مسجّل → مفيش أي فحص

  const model = scoped.model
  const { operation, args, contextStoreId } = input
  const violations: ScopeViolation[] = []

  const check = (kind: ScopeViolationKind, detail: string) =>
    violations.push({ kind, model, operation, detail })

  if (CREATE_OPERATIONS.has(operation)) {
    for (const payload of payloadsOf(args)) {
      if (!isRecord(payload)) continue
      if (payload[scoped.storeField] === undefined) {
        check('missing_store_value', `data.${scoped.storeField} غير موجود`)
      }
      if (scoped.modeField && payload[scoped.modeField] === undefined) {
        check('missing_mode_value', `data.${scoped.modeField} غير موجود`)
      }
    }
    return violations
  }

  if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE_OPERATIONS.has(operation)) {
    const where = isRecord(args) ? args.where : undefined

    if (
      !fieldConstrained(where, scoped.storeField, scoped.storeRelation ?? 'store')
    ) {
      check('missing_store_scope', `where.${scoped.storeField} غير موجود`)
    } else if (contextStoreId != null) {
      const value =
        extractScalar(where, scoped.storeField) ??
        extractRelationScalar(where, scoped.storeRelation ?? 'store', scoped.storeField)
      if (value !== undefined && String(value) !== String(contextStoreId)) {
        check(
          'store_scope_mismatch',
          `where.${scoped.storeField}=${String(value)} بينما سياق الطلب ${contextStoreId}`,
        )
      }
    }

    if (scoped.modeField && !fieldConstrained(where, scoped.modeField)) {
      check('missing_mode_scope', `where.${scoped.modeField} غير موجود`)
    }

    if (operation === 'upsert') {
      for (const key of ['create', 'update'] as const) {
        const payload = isRecord(args) ? args[key] : undefined
        if (!isRecord(payload)) continue
        if (key === 'create' && payload[scoped.storeField] === undefined) {
          check('missing_store_value', `${key}.${scoped.storeField} غير موجود`)
        }
      }
    }
  }

  return violations
}