import { execFileSync } from 'child_process';
import { join } from 'path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * ══════════════════════════════════════════════════════════════════
 * The test database is built by THE REAL MIGRATION CHAIN.
 * ══════════════════════════════════════════════════════════════════
 *
 * It did not used to be. This file ran `prisma db push` and then
 * re-created, by hand, everything `db push` cannot express: every RLS
 * policy, the partial unique indexes, the CHECK constraints — against a
 * role called `rls_test` that exists in no production environment.
 *
 * Three things were wrong with that, and all three were real:
 *
 *   1. NOTHING RAN THE MIGRATIONS. `20260817164429_enable_payment_rls`
 *      dropped a table and altered a policy that no migration ever
 *      created, so `migrate deploy` against an empty database failed on
 *      its third statement and every migration after it was
 *      unreachable. A green suite said nothing about it, because a
 *      green suite never touched a migration.
 *
 *   2. THE POLICIES UNDER TEST NAMED THE WRONG ROLE. Proving that
 *      `rls_test` is correctly fenced in proves nothing about
 *      `dartstore_app`, and the production split between the
 *      application role and the platform role — the grant boundary a
 *      whole class of bugs lives on — was exercised by nothing at all.
 *
 *   3. THE HAND-WRITTEN MIRROR COULD DRIFT from the migration it was
 *      copied from, silently, in either direction.
 *
 * So the setup below does what a deployment does, in the same order:
 *
 *   `prisma migrate deploy`   → schema, RLS, policies, roles, grants,
 *                               partial indexes, CHECK constraints
 *   grant LOGIN + password    → the one step migrations deliberately
 *                               omit, because a migration must not
 *                               carry a credential (prisma/BOOTSTRAP.md)
 *
 * There is no hand-written DDL left in this file. If a migration is
 * broken, the integration suite now fails to start — which is the
 * correct moment to find out.
 *
 * ── THREE CONNECTIONS, THREE IDENTITIES ────────────────────────────
 *
 *   dartstore_app       the application's own role. RLS-bound, exactly
 *                       as in production. Published as TEST_DATABASE_URL.
 *   dartstore_platform  the cross-store sweep role, with the same narrow
 *                       per-table grants production gives it. Published
 *                       as TEST_PLATFORM_DATABASE_URL — so a sweep that
 *                       reaches past its grants fails HERE rather than
 *                       in production.
 *   the container owner only for TRUNCATE between tests. Neither runtime
 *                       role may TRUNCATE (it ignores RLS), so cleanup
 *                       cannot borrow their identity. Published as
 *                       TEST_OWNER_DATABASE_URL.
 */

/** Kept in step with `prisma/bootstrap/grant-login.sql`. Test-only. */
const APP_ROLE = 'dartstore_app';
const APP_PASSWORD = 'dartstore_app_test';
const PLATFORM_ROLE = 'dartstore_platform';
const PLATFORM_PASSWORD = 'dartstore_platform_test';

module.exports = async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('payments_test')
    .withUsername('test')
    .withPassword('test')
    // Durability settings only matter if the data must survive a crash.
    // This database is thrown away at the end of the run, and leaving
    // fsync on made TRUNCATE ... CASCADE take over thirty seconds per
    // test on a slow container — the whole suite was waiting on disk.
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
      '-c',
      'autovacuum=off',
    ])
    .start();

  const raw = container.getConnectionUri();

  // Postgres waits for a lock forever by default, so a blocked TRUNCATE
  // hangs the suite with no output. These turn that into a fast, named
  // error. Set through the URL because Prisma pools connections and a
  // SET would only affect whichever connection ran it.
  const options = [
    '-c lock_timeout=5000',
    '-c statement_timeout=30000',
    '-c idle_in_transaction_session_timeout=15000',
  ].join(' ');

  const ownerUrl = `${raw}${raw.includes('?') ? '&' : '?'}options=${encodeURIComponent(options)}`;

  // Step 1 — the real migration chain, as the owner. CREATE POLICY and
  // GRANT both require table ownership, which is exactly why a
  // deployment runs migrations as the owner and not as the app role.
  migrateDeploy(ownerUrl);

  // Step 2 — the credential half. `20260817164428_bootstrap_database_roles`
  // creates both roles NOLOGIN on purpose; production supplies the
  // passwords from its secret store, and this supplies fixed test ones.
  grantLogin(ownerUrl);

  process.env.TEST_OWNER_DATABASE_URL = ownerUrl;
  process.env.TEST_DATABASE_URL = asRole(ownerUrl, APP_ROLE, APP_PASSWORD);
  process.env.TEST_PLATFORM_DATABASE_URL = asRole(
    ownerUrl,
    PLATFORM_ROLE,
    PLATFORM_PASSWORD,
  );

  (globalThis as Record<string, unknown>).__PG_CONTAINER__ = container;
};

/** The same URL, authenticating as a different role. */
function asRole(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

/** Resolves the Prisma CLI without going through npx. */
function prismaBinary(): string {
  return join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  );
}

/**
 * Applies `prisma/migrations` to the fresh container.
 *
 * The Prisma CLI is invoked directly rather than through npx: npx
 * prompts on stdin when it has to resolve a package, and with stdio
 * piped that prompt is invisible and waits forever. stdin is closed and
 * a timeout is set, because execFileSync blocks the event loop and Jest
 * cannot time it out from the outside.
 */
function migrateDeploy(url: string): void {
  try {
    execFileSync(prismaBinary(), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error as {
      status?: number;
      signal?: string;
      stdout?: Buffer;
      stderr?: Buffer;
      message?: string;
    };

    throw new Error(
      [
        'prisma migrate deploy failed while preparing the test database.',
        'The migration chain must apply cleanly to an EMPTY database —',
        'see scripts/verify-migration-replay.sh and prisma/BOOTSTRAP.md.',
        detail.signal
          ? `signal: ${detail.signal}`
          : `exit code: ${detail.status}`,
        detail.stdout?.toString().trim(),
        detail.stderr?.toString().trim(),
        detail.message,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

/**
 * The deployment step that follows `migrate deploy` in every
 * environment: give the two runtime roles a way to log in.
 *
 * Mirrors `prisma/bootstrap/grant-login.sql`, including its refusal to
 * widen either role. NOSUPERUSER/NOBYPASSRLS are re-asserted here for
 * the same reason they are there: a role that bypasses RLS would make
 * every isolation test in this suite pass for the wrong reason.
 */
function grantLogin(url: string): void {
  const script = `
    ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${APP_PASSWORD}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

    ALTER ROLE ${PLATFORM_ROLE} WITH LOGIN PASSWORD '${PLATFORM_PASSWORD}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_roles
         WHERE rolname IN ('${APP_ROLE}', '${PLATFORM_ROLE}')
           AND (rolsuper OR rolbypassrls)
      ) THEN
        RAISE EXCEPTION
          'a runtime role can bypass RLS — every isolation test would be meaningless';
      END IF;
    END
    $$;
  `;

  execFileSync(prismaBinary(), ['db', 'execute', '--stdin', '--url', url], {
    input: script,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
    windowsHide: true,
  });
}
