import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  startTestDatabase,
  stopTestDatabase,
} from '../../test/db-test-harness';

class TestPrismaService extends PrismaService {
  constructor(raw: PrismaClient) {
    super(
      {} as never,
      {
        get: () => undefined,
      } as never,
      {} as never,
    );

    Object.assign(this, raw);
  }
}

describe('PrismaService.withTenantTransaction (integration)', () => {
  let raw: PrismaClient;
  let prisma: TestPrismaService;

  beforeAll(async () => {
    raw = await startTestDatabase();
    prisma = new TestPrismaService(raw);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  it('sets app.store_id only inside the transaction', async () => {
    const before = await raw.$queryRaw<{ store_id: string | null }[]>`
      SELECT current_setting('app.store_id', true) AS store_id
    `;

    expect(before[0]?.store_id ?? null).toBe(null);

    const inside = await prisma.withTenantTransaction(
      123n,
      'live',
      async (tx) => {
        const rows = await tx.$queryRaw<{ store_id: string | null }[]>`
          SELECT current_setting('app.store_id', true) AS store_id
        `;

        return rows[0]?.store_id ?? null;
      },
    );

    expect(inside).toBe('123');

    const after = await raw.$queryRaw<{ store_id: string | null }[]>`
      SELECT current_setting('app.store_id', true) AS store_id
    `;

    expect(after[0]?.store_id === null || after[0]?.store_id === '').toBe(true);
  });
});
