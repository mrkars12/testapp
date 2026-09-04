import { PrismaService } from './prisma.service';

/**
 * Constructs a PrismaService with a fully-controlled ConfigService stub
 * and no real database connection — platform()/getPlatformDatabaseUrl()
 * do no I/O until a query actually runs, so this is a pure unit test of
 * the fail-closed decision logic, matching the pattern already used by
 * prisma.service.integration.spec.ts for withTenantTransaction.
 */
class TestPrismaService extends PrismaService {
  constructor(configValues: Record<string, unknown>) {
    super(
      {} as never,
      {
        get: (key: string) => configValues[key],
      } as never,
      {} as never,
    );
  }
}

const PLACEHOLDER_URL =
  'postgresql://platform_role:placeholder@localhost:5432/placeholder_db';

type EnvOverrides = Record<string, string | undefined>;

function applyEnv(overrides: EnvOverrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Builds a TestPrismaService with a deterministic env, immune to
 * @prisma/client's own internal dotenv reload.
 *
 * `PrismaService extends PrismaClient`, and `super()` inside its
 * constructor instantiates a real `PrismaClient`, which reloads
 * `backend/.env` into `process.env` on *every* construction (verified
 * directly: `new PrismaClient()` repopulates any `.env`-defined key that
 * isn't already present in `process.env`, even one just deleted). Now
 * that `backend/.env` has a real `DATABASE_URL_PLATFORM` value, an
 * explicit `delete` before `new TestPrismaService(...)` gets silently
 * undone by that reload, before `getPlatformDatabaseUrl()`/`platform()`
 * ever inspects `process.env`. Re-applying `overrides` again immediately
 * after construction closes that window deterministically, without
 * depending on timing, dotenv internals, or mocking @prisma/client.
 */
function buildPlatformService(
  envOverrides: EnvOverrides,
  configValues: Record<string, unknown>,
): TestPrismaService {
  applyEnv(envOverrides);
  const svc = new TestPrismaService(configValues);
  applyEnv(envOverrides);
  return svc;
}

describe('PrismaService.platform() — fail-closed configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('production', () => {
    it('uses the configured platform connection when DATABASE_URL_PLATFORM is set', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          DATABASE_URL: 'postgresql://tenant_role:x@localhost/tenant_db',
        },
        {
          'app.isProduction': true,
          'app.allowPlatformDbFallback': false,
          DATABASE_URL_PLATFORM: PLACEHOLDER_URL,
        },
      );

      expect(() => svc.platform()).not.toThrow();
      expect(svc.platform()).toBeTruthy();
    });

    it('fails closed — throws — when DATABASE_URL_PLATFORM is missing, instead of falling back to DATABASE_URL', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          DATABASE_URL: 'postgresql://tenant_role:x@localhost/tenant_db',
        },
        {
          'app.isProduction': true,
          'app.allowPlatformDbFallback': false,
        },
      );

      expect(() => svc.platform()).toThrow(/DATABASE_URL_PLATFORM is not configured/);
    });

    it('does not leak the tenant DATABASE_URL credentials/role into the thrown error message', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          DATABASE_URL:
            'postgresql://tenant_role:super-secret-password@localhost/tenant_db',
        },
        {
          'app.isProduction': true,
          'app.allowPlatformDbFallback': false,
        },
      );

      try {
        svc.platform();
        fail('expected platform() to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('super-secret-password');
        expect(message).not.toContain('tenant_role');
        expect(message).not.toContain(process.env.DATABASE_URL);
      }
    });
  });

  describe('shared/deployed environment with NODE_ENV=development (Phase 9 finding)', () => {
    // Regression for the exact Phase 9 finding: the shared environment runs
    // with NODE_ENV=development (not "production"), so app.isProduction is
    // false. Before this fix, that was enough on its own to unlock the
    // TEST_DATABASE_URL/DATABASE_URL fallback in a shared/deployed
    // environment. It must now fail closed exactly like production unless
    // allowPlatformDbFallback is explicitly true.
    it('fails closed when DATABASE_URL_PLATFORM is missing, even though NODE_ENV=development / isProduction=false', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://tenant_role:x@localhost/tenant_db',
        },
        {
          'app.isProduction': false,
          // Mirrors configuration.ts: ALLOW_PLATFORM_DB_FALLBACK unset and
          // NODE_ENV !== 'test' resolves to false for a shared deployment.
          'app.allowPlatformDbFallback': false,
        },
      );

      expect(() => svc.platform()).toThrow(/DATABASE_URL_PLATFORM is not configured/);
    });

    it('does not leak the tenant DATABASE_URL credentials/role into the thrown error message', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          NODE_ENV: 'development',
          DATABASE_URL:
            'postgresql://tenant_role:super-secret-password@localhost/tenant_db',
        },
        {
          'app.isProduction': false,
          'app.allowPlatformDbFallback': false,
        },
      );

      try {
        svc.platform();
        fail('expected platform() to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('super-secret-password');
        expect(message).not.toContain('tenant_role');
        expect(message).not.toContain(process.env.DATABASE_URL);
      }
    });

    it('stays fail-closed even if DATABASE_URL_PLATFORM is merely blank/empty', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: '',
          TEST_DATABASE_URL: undefined,
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://tenant_role:x@localhost/tenant_db',
        },
        {
          'app.isProduction': false,
          'app.allowPlatformDbFallback': false,
          DATABASE_URL_PLATFORM: '',
        },
      );

      expect(() => svc.platform()).toThrow(/DATABASE_URL_PLATFORM is not configured/);
    });
  });

  describe('genuine local/test configuration', () => {
    it('keeps the existing explicit fallback when allowPlatformDbFallback is explicitly true: derives from TEST_DATABASE_URL', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: 'postgresql://rls_test:rls_test@localhost:5432/test_db',
        },
        {
          'app.isProduction': false,
          'app.allowPlatformDbFallback': true,
        },
      );

      expect(() => svc.platform()).not.toThrow();
    });

    it('rewrites the rls_test test-harness identity to the owner test role', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: 'postgresql://rls_test:rls_test@localhost:5432/test_db',
        },
        {
          'app.isProduction': false,
          'app.allowPlatformDbFallback': true,
        },
      );
      const resolved = (svc as unknown as {
        getPlatformDatabaseUrl(): string | undefined;
      }).getPlatformDatabaseUrl();

      expect(resolved).toBeDefined();
      const parsed = new URL(resolved as string);
      expect(parsed.username).toBe('test');
    });

    it('does not throw even with nothing configured at all when NODE_ENV=test (Jest default), the existing dev/test fallback', () => {
      // No explicit 'app.allowPlatformDbFallback' in the stub — falls
      // through to the process.env.NODE_ENV === 'test' check, exactly as
      // configuration.ts's appConfig factory would compute it.
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          TEST_DATABASE_URL: undefined,
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://tenant_role:x@localhost/tenant_db',
        },
        { 'app.isProduction': false },
      );

      expect(() => svc.platform()).not.toThrow();
    });

    it('honors an explicit ALLOW_PLATFORM_DB_FALLBACK opt-in even when NODE_ENV=development', () => {
      const svc = buildPlatformService(
        {
          DATABASE_URL_PLATFORM: undefined,
          NODE_ENV: 'development',
          TEST_DATABASE_URL: 'postgresql://rls_test:rls_test@localhost:5432/test_db',
        },
        {
          'app.isProduction': false,
          // Explicit, deliberate opt-in — mirrors ALLOW_PLATFORM_DB_FALLBACK=true.
          'app.allowPlatformDbFallback': true,
        },
      );

      expect(() => svc.platform()).not.toThrow();
    });
  });

  it('explicit DATABASE_URL_PLATFORM always wins regardless of environment or fallback configuration', () => {
    for (const isProduction of [true, false]) {
      for (const allowPlatformDbFallback of [true, false]) {
        const svc = buildPlatformService(
          { DATABASE_URL_PLATFORM: PLACEHOLDER_URL },
          {
            'app.isProduction': isProduction,
            'app.allowPlatformDbFallback': allowPlatformDbFallback,
            DATABASE_URL_PLATFORM: PLACEHOLDER_URL,
          },
        );

        expect(() => svc.platform()).not.toThrow();
      }
    }
  });
});
