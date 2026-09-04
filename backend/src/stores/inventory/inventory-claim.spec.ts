import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertAbsoluteEditIsSafe,
  assertAvailable,
  decrementInventory,
  incrementInventory,
  InsufficientStockError,
  lockVariants,
  readAvailability,
} from './inventory-claim';

/**
 * Unit coverage for the claim primitive.
 *
 * The concurrency behaviour itself needs a real database and lives in
 * `checkout.service.integration.spec.ts` — no fake can hold a row lock.
 * What IS unit-testable is the decision logic wrapped around that lock,
 * and every one of these is a rule that would silently oversell or
 * silently refuse a legitimate sale if it were wrong:
 *
 *   • the lock order, which is the whole deadlock-freedom argument
 *   • netting `held` off on-hand
 *   • summing a variant that appears on more than one line
 *   • untracked variants skipping the claim entirely
 *   • backorder never being refused
 *   • the guarded writes reporting whether they actually wrote
 */

/** Captures what the claim asked the database to do. */
interface Recorder {
  /** Variant ids passed to `FOR UPDATE`, in the order the SQL got them. */
  locked: bigint[][];
  /** Rows `$executeRaw` claims to have affected, per call. */
  affected: number[];
}

function fakeTx(input: {
  variants?: { id: bigint; inventory_qty: number }[];
  held?: { variant_id: bigint; quantity: number }[];
  heldSum?: number | null;
  affected?: number;
  recorder?: Recorder;
}) {
  const recorder = input.recorder ?? { locked: [], affected: [] };

  return {
    $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Duck-typed rather than `instanceof Prisma.Sql`: only the TYPE
      // is exported on the `Prisma` namespace, not the runtime class.
      // What `Prisma.join()` produces always carries the interpolated
      // ids on `.values`, which is the thing under test.
      const joined = values.find(
        (v): v is { values: bigint[] } =>
          typeof v === 'object' &&
          v !== null &&
          Array.isArray((v as { values?: unknown }).values),
      );
      if (joined) recorder.locked.push(joined.values);
      return Promise.resolve([]);
    },

    $executeRaw: () => {
      const affected = input.affected ?? 0;
      recorder.affected.push(affected);
      return Promise.resolve(affected);
    },

    productVariant: {
      findMany: () => Promise.resolve(input.variants ?? []),
    },

    inventoryReservation: {
      groupBy: () =>
        Promise.resolve(
          (input.held ?? []).map((row) => ({
            variant_id: row.variant_id,
            _sum: { quantity: row.quantity },
          })),
        ),
      aggregate: () =>
        Promise.resolve({ _sum: { quantity: input.heldSum ?? null } }),
    },
  } as unknown as Prisma.TransactionClient;
}

const line = (
  variantId: bigint,
  quantity: number,
  over: { trackInventory?: boolean; continueSelling?: boolean } = {},
) => ({
  variantId,
  quantity,
  trackInventory: over.trackInventory ?? true,
  continueSelling: over.continueSelling ?? false,
});

describe('lockVariants', () => {
  it('locks in ascending id order, whatever order the caller passed', async () => {
    const recorder: Recorder = { locked: [], affected: [] };

    await lockVariants(fakeTx({ recorder }), [30n, 10n, 20n]);

    expect(recorder.locked).toHaveLength(1);
    expect(recorder.locked[0]).toEqual([10n, 20n, 30n]);
  });

  it('de-duplicates, so one variant on two lines takes one lock', async () => {
    const recorder: Recorder = { locked: [], affected: [] };

    await lockVariants(fakeTx({ recorder }), [7n, 7n, 3n, 7n]);

    expect(recorder.locked[0]).toEqual([3n, 7n]);
  });

  it('issues no statement at all for an empty list', async () => {
    const recorder: Recorder = { locked: [], affected: [] };

    await lockVariants(fakeTx({ recorder }), []);

    expect(recorder.locked).toEqual([]);
  });
});

describe('readAvailability', () => {
  it('subtracts live holds from on-hand', async () => {
    const available = await readAvailability(
      fakeTx({
        variants: [{ id: 1n, inventory_qty: 10 }],
        held: [{ variant_id: 1n, quantity: 4 }],
      }),
      { storeId: 5n, variantIds: [1n] },
    );

    expect(available.get('1')).toBe(6);
  });

  it('treats a variant with no holds as fully available', async () => {
    const available = await readAvailability(
      fakeTx({ variants: [{ id: 1n, inventory_qty: 2 }], held: [] }),
      { storeId: 5n, variantIds: [1n] },
    );

    expect(available.get('1')).toBe(2);
  });
});

describe('assertAvailable', () => {
  const store = { storeId: 5n };

  it('refuses when availability cannot cover the line', async () => {
    const tx = fakeTx({
      variants: [{ id: 1n, inventory_qty: 3 }],
      held: [{ variant_id: 1n, quantity: 2 }],
    });

    await expect(
      assertAvailable(tx, { ...store, lines: [line(1n, 2)] }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('sums the SAME variant across lines rather than checking each alone', async () => {
    // Three and three against four: neither line exceeds it, together
    // they do. Checking per line would let this through.
    const tx = fakeTx({ variants: [{ id: 1n, inventory_qty: 4 }], held: [] });

    await expect(
      assertAvailable(tx, { ...store, lines: [line(1n, 3), line(1n, 3)] }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('allows a request that exactly exhausts availability', async () => {
    const tx = fakeTx({ variants: [{ id: 1n, inventory_qty: 4 }], held: [] });

    await expect(
      assertAvailable(tx, { ...store, lines: [line(1n, 4)] }),
    ).resolves.toBeUndefined();
  });

  it('skips untracked lines entirely — no lock, no netting, no gate', async () => {
    const recorder: Recorder = { locked: [], affected: [] };
    const tx = fakeTx({ variants: [], held: [], recorder });

    await expect(
      assertAvailable(tx, {
        ...store,
        lines: [line(1n, 99, { trackInventory: false })],
      }),
    ).resolves.toBeUndefined();

    expect(recorder.locked).toEqual([]);
  });

  it('never refuses a backorder line, however short the stock', async () => {
    const tx = fakeTx({
      variants: [{ id: 1n, inventory_qty: 0 }],
      held: [{ variant_id: 1n, quantity: 5 }],
    });

    await expect(
      assertAvailable(tx, {
        ...store,
        lines: [line(1n, 50, { continueSelling: true })],
      }),
    ).resolves.toBeUndefined();
  });

  it('still LOCKS a backorder line, so lock ordering stays complete', async () => {
    const recorder: Recorder = { locked: [], affected: [] };
    const tx = fakeTx({
      variants: [{ id: 9n, inventory_qty: 0 }],
      held: [],
      recorder,
    });

    await assertAvailable(tx, {
      ...store,
      lines: [line(9n, 1, { continueSelling: true })],
    });

    expect(recorder.locked[0]).toEqual([9n]);
  });

  it('carries the failing variant, the amount wanted and the amount available', async () => {
    const tx = fakeTx({
      variants: [{ id: 42n, inventory_qty: 1 }],
      held: [],
    });

    await expect(
      assertAvailable(tx, { ...store, lines: [line(42n, 3)] }),
    ).rejects.toMatchObject({
      variantId: 42n,
      requested: 3,
      available: 1,
    });
  });
});

describe('decrementInventory', () => {
  it('reports true when the guarded write took the units', async () => {
    expect(
      await decrementInventory(fakeTx({ affected: 1 }), {
        storeId: 5n,
        variantId: 1n,
        quantity: 2,
      }),
    ).toBe(true);
  });

  it('reports false when the guard refused, rather than throwing', async () => {
    // A refusal is not an error by itself: "no money has moved" and
    // "the customer already paid" are two different situations, and the
    // caller is the one that knows which it is in.
    expect(
      await decrementInventory(fakeTx({ affected: 0 }), {
        storeId: 5n,
        variantId: 1n,
        quantity: 2,
      }),
    ).toBe(false);
  });
});

describe('incrementInventory', () => {
  it('reports whether the restock found its row', async () => {
    expect(
      await incrementInventory(fakeTx({ affected: 1 }), {
        storeId: 5n,
        variantId: 1n,
        quantity: 2,
      }),
    ).toBe(true);

    expect(
      await incrementInventory(fakeTx({ affected: 0 }), {
        storeId: 5n,
        variantId: 1n,
        quantity: 2,
      }),
    ).toBe(false);
  });
});

describe('assertAbsoluteEditIsSafe', () => {
  const base = { storeId: 5n, variantId: 1n, title: 'Widget' };

  it('refuses an absolute edit that would strand live holds', async () => {
    await expect(
      assertAbsoluteEditIsSafe(fakeTx({ heldSum: 3 }), {
        ...base,
        newQty: 1,
        continueSelling: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('names the number the merchant has to clear', async () => {
    await expect(
      assertAbsoluteEditIsSafe(fakeTx({ heldSum: 3 }), {
        ...base,
        newQty: 1,
        continueSelling: false,
      }),
    ).rejects.toThrow(/3 unit\(s\) held/);
  });

  it('allows an edit that still covers the holds', async () => {
    await expect(
      assertAbsoluteEditIsSafe(fakeTx({ heldSum: 3 }), {
        ...base,
        newQty: 3,
        continueSelling: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows any edit when nothing is held', async () => {
    await expect(
      assertAbsoluteEditIsSafe(fakeTx({ heldSum: null }), {
        ...base,
        newQty: 0,
        continueSelling: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('exempts backorder variants, which may go below zero by design', async () => {
    await expect(
      assertAbsoluteEditIsSafe(fakeTx({ heldSum: 10 }), {
        ...base,
        newQty: -5,
        continueSelling: true,
      }),
    ).resolves.toBeUndefined();
  });
});
