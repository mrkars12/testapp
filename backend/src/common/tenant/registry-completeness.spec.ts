import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DELIBERATELY_UNSCOPED,
  TENANT_SCOPED_MODELS,
} from './tenant-scoped-models';

/**
 * Guards the registry against the failure that let it fall behind.
 *
 * The registry sat at three models for two phases while a dozen tables
 * carrying store_id were added around it. An unregistered model is not
 * checked at all, so the guard reported clean on exactly the tables that
 * matter most. Nobody noticed because nothing compared the two lists.
 */
describe('every store-scoped model is registered', () => {
  const schemaPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'schema.prisma',
  );

  /** Prisma models declaring a store_id or storeId field. */
  function modelsWithStoreId(): string[] {
    let schema: string;
    try {
      schema = readFileSync(schemaPath, 'utf8');
    } catch {
      return [];
    }

    const found: string[] = [];
    const blocks = schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);

    for (const [, name, body] of blocks) {
      if (/^\s*(store_id|storeId)\s+/m.test(body)) {
        found.push(name);
      }
    }

    return found;
  }

  it('leaves no model with store_id or storeId unaccounted for', () => {
    const declared = modelsWithStoreId();

    if (declared.length === 0) {
      // Schema not reachable from here; the registry cannot be compared.
      return;
    }

    const registered = new Set(TENANT_SCOPED_MODELS.map((m) => m.model));
    const excused = new Set(DELIBERATELY_UNSCOPED.map((m) => m.model));

    const missing = declared.filter(
      (model) => !registered.has(model) && !excused.has(model),
    );

    expect(missing).toEqual([]);
  });

  it('registers no model twice', () => {
    const names = TENANT_SCOPED_MODELS.map((m) => m.model);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every exclusion a reason', () => {
    for (const entry of DELIBERATELY_UNSCOPED) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('registers Collection with storeId', () => {
    const collection = TENANT_SCOPED_MODELS.find(
      (model) => model.model === 'Collection',
    );

    expect(collection).toBeDefined();
    expect(collection?.storeField).toBe('storeId');
    expect(collection?.modeField).toBeNull();
  });
});
