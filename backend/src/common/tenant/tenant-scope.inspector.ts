import {
  CREATE_OPERATIONS,
  READ_OPERATIONS,
  WRITE_WITH_WHERE_OPERATIONS,
  getTenantScopedModel,
} from './tenant-scoped-models';
import type { TenantScopedModel } from './tenant-scoped-models';

export type ScopeViolationKind =
  | 'missing_store_scope'
  | 'missing_mode_scope'
  | 'missing_store_value'
  | 'missing_mode_value'
  | 'store_scope_mismatch';

export interface ScopeViolation {
  readonly kind: ScopeViolationKind;
  readonly model: string;
  readonly operation: string;
  readonly detail: string;
}

export interface InspectionInput {
  readonly model: string | undefined;
  readonly operation: string;
  readonly args: unknown;
  readonly contextStoreId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldConstrained(
  where: unknown,
  field: string,
  relation?: string,
): boolean {
  if (!isRecord(where)) return false;
  if (Object.prototype.hasOwnProperty.call(where, field)) return true;

  if (relation && isRecord(where[relation])) {
    const nested = where[relation] as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(nested, 'id') ||
      Object.prototype.hasOwnProperty.call(nested, field)
    ) {
      return true;
    }
  }

  const and = where.AND;

  if (Array.isArray(and)) {
    return and.some((clause) => fieldConstrained(clause, field, relation));
  }

  if (isRecord(and)) {
    return fieldConstrained(and, field, relation);
  }

  return false;
}

function extractRelationScalar(
  where: unknown,
  relation: string,
  field: string,
): unknown {
  if (!isRecord(where)) return undefined;

  const nested = where[relation];

  if (isRecord(nested)) {
    const value = nested.id ?? nested[field];

    if (value !== undefined) {
      if (isRecord(value) && 'equals' in value) {
        return value.equals;
      }

      return value;
    }
  }

  const and = where.AND;

  if (Array.isArray(and)) {
    for (const clause of and) {
      const found = extractRelationScalar(clause, relation, field);

      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}

function extractScalar(where: unknown, field: string): unknown {
  if (!isRecord(where)) return undefined;

  const direct = where[field];

  if (direct !== undefined) {
    if (isRecord(direct) && 'equals' in direct) {
      return direct.equals;
    }

    return direct;
  }

  const and = where.AND;

  if (Array.isArray(and)) {
    for (const clause of and) {
      const found = extractScalar(clause, field);

      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}

/**
 * True only for an exact scalar/equals lookup.
 *
 * This is intentionally stricter than fieldConstrained().
 * A contains/startsWith/etc. filter does not qualify as a unique lookup.
 */
function hasExactScalarLookup(where: unknown, field: string): boolean {
  if (!isRecord(where)) return false;

  const direct = where[field];

  if (direct !== undefined) {
    if (isRecord(direct)) {
      return 'equals' in direct && direct.equals !== undefined;
    }

    return true;
  }

  const and = where.AND;

  if (Array.isArray(and)) {
    return and.some((clause) => hasExactScalarLookup(clause, field));
  }

  if (isRecord(and)) {
    return hasExactScalarLookup(and, field);
  }

  return false;
}

/**
 * A small, explicit exception for globally-unique lookup fields.
 *
 * Store scope is still mandatory. We only allow mode to be learned from
 * the row itself after this exact lookup succeeds.
 */
function allowsModeOmission(
  scoped: TenantScopedModel,
  operation: string,
  where: unknown,
): boolean {
  if (!READ_OPERATIONS.has(operation)) return false;

  const fields = scoped.modeOptionalUniqueFields ?? [];

  return fields.some((field) => hasExactScalarLookup(where, field));
}

function payloadsOf(args: unknown): unknown[] {
  if (!isRecord(args)) return [];

  const data = args.data;

  if (Array.isArray(data)) return data;
  if (isRecord(data)) return [data];

  return [];
}

export function inspectScope(input: InspectionInput): ScopeViolation[] {
  const scoped = getTenantScopedModel(input.model);

  if (!scoped) return [];

  const model = scoped.model;
  const { operation, args, contextStoreId } = input;
  const violations: ScopeViolation[] = [];

  const check = (kind: ScopeViolationKind, detail: string) => {
    violations.push({
      kind,
      model,
      operation,
      detail,
    });
  };

  if (CREATE_OPERATIONS.has(operation)) {
    for (const payload of payloadsOf(args)) {
      if (!isRecord(payload)) continue;

      if (payload[scoped.storeField] === undefined) {
        check('missing_store_value', `data.${scoped.storeField} غير موجود`);
      }

      if (scoped.modeField && payload[scoped.modeField] === undefined) {
        check('missing_mode_value', `data.${scoped.modeField} غير موجود`);
      }
    }

    return violations;
  }

  if (
    READ_OPERATIONS.has(operation) ||
    WRITE_WITH_WHERE_OPERATIONS.has(operation)
  ) {
    const where = isRecord(args) ? args.where : undefined;

    if (
      !fieldConstrained(
        where,
        scoped.storeField,
        scoped.storeRelation ?? 'store',
      )
    ) {
      check('missing_store_scope', `where.${scoped.storeField} غير موجود`);
    } else if (contextStoreId != null) {
      const value =
        extractScalar(where, scoped.storeField) ??
        extractRelationScalar(
          where,
          scoped.storeRelation ?? 'store',
          scoped.storeField,
        );

      if (value !== undefined && String(value) !== String(contextStoreId)) {
        check(
          'store_scope_mismatch',
          `where.${scoped.storeField}=${String(value)} بينما سياق الطلب ${contextStoreId}`,
        );
      }
    }

    if (
      scoped.modeField &&
      !fieldConstrained(where, scoped.modeField) &&
      !allowsModeOmission(scoped, operation, where)
    ) {
      check('missing_mode_scope', `where.${scoped.modeField} غير موجود`);
    }

    if (operation === 'upsert') {
      for (const key of ['create', 'update'] as const) {
        const payload = isRecord(args) ? args[key] : undefined;

        if (!isRecord(payload)) continue;

        if (key === 'create' && payload[scoped.storeField] === undefined) {
          check('missing_store_value', `${key}.${scoped.storeField} غير موجود`);
        }
      }
    }
  }

  return violations;
}
