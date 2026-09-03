import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * ══════════════════════════════════════════════════════════════════
 * The migration chain must be replayable from an EMPTY database.
 * ══════════════════════════════════════════════════════════════════
 *
 * `scripts/verify-migration-replay.sh` proves this properly — it builds
 * two real databases and diffs the result against `schema.prisma`. This
 * spec is the fast guard that runs on every `npx jest`, because that
 * script needs Docker and a minute, and the failure it catches is one
 * nobody notices for weeks.
 *
 * That is exactly what happened. `20260817164429_enable_payment_rls`
 * dropped a table and altered a policy that no migration ever created,
 * and referenced a role that no migration ever created. `migrate deploy`
 * against a fresh database failed on its third statement and every
 * migration after it — webhook events, disputes, the storefront cart,
 * the inventory guards — was unreachable. Nothing caught it, because
 * nothing ran the migrations: the test harness used `prisma db push`.
 *
 * These assertions encode the three specific ways that happened, so a
 * future migration cannot reintroduce any of them.
 */
describe('the migration chain', () => {
  const dir = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

  const migrations = readdirSync(dir)
    .filter((entry) => existsSync(join(dir, entry, 'migration.sql')))
    .sort();

  const sqlOf = (name: string): string =>
    readFileSync(join(dir, name, 'migration.sql'), 'utf8');

  /** Statements with their `--` comments stripped. */
  const statementsOf = (name: string): string =>
    sqlOf(name)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

  it('has migrations to check', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(14);
  });

  /**
   * Normalises a possibly schema-qualified, possibly quoted table name
   * to its bare form. `0_init` writes `"public"."StorePaymentProvider"`
   * while later migrations write `"payment_accounts"`, and the two must
   * compare equal or this spec reports its own parsing as a defect.
   */
  const bareTableName = (raw: string): string =>
    raw
      .split('.')
      .pop()!
      .replace(/"/g, '')
      .trim();

  it('never drops an object it cannot know exists', () => {
    /*
     * The original defect, exactly: `DROP TABLE "__rls_force_probe"` on
     * a table created by no migration. A bare DROP is only safe for
     * something an earlier migration created; anything else must say IF
     * EXISTS or it will fail on every database but the one it was
     * written against.
     */
    const created = new Set<string>();
    const offences: string[] = [];

    for (const name of migrations) {
      const sql = statementsOf(name);

      for (const match of sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)/gi,
      )) {
        created.add(bareTableName(match[1]));
      }

      for (const match of sql.matchAll(
        /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)/gi,
      )) {
        const guarded = Boolean(match[1]);
        const table = bareTableName(match[2]);
        if (!guarded && !created.has(table)) {
          offences.push(`${name}: DROP TABLE "${table}" without IF EXISTS`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('never alters a policy that no migration creates', () => {
    /*
     * `ALTER POLICY order_store_isolation ON "Order"` assumed a policy
     * that had only ever been created by hand. An ALTER is fine when a
     * migration created the policy, or when it is guarded by a DO block
     * that creates it in the ELSE branch — which is how that migration
     * was repaired.
     */
    const created = new Set<string>();
    const offences: string[] = [];

    for (const name of migrations) {
      const sql = statementsOf(name);

      for (const match of sql.matchAll(/CREATE\s+POLICY\s+(\w+)/gi)) {
        created.add(match[1]);
      }

      for (const match of sql.matchAll(/ALTER\s+POLICY\s+(\w+)/gi)) {
        if (!created.has(match[1])) {
          offences.push(`${name}: ALTER POLICY ${match[1]} which nothing creates`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('creates every role before a policy or grant names it', () => {
    /*
     * `CREATE POLICY … TO dartstore_app` resolves the role name at
     * creation time, so the role has to exist first. Both roles were
     * created by hand and appeared in no migration at all, which is why
     * the RLS migration could never run anywhere else.
     */
    const roles = ['dartstore_app', 'dartstore_platform'];
    const createdAt = new Map<string, number>();
    const offences: string[] = [];

    migrations.forEach((name, index) => {
      const sql = statementsOf(name);

      for (const role of roles) {
        if (new RegExp(`CREATE\\s+ROLE\\s+${role}\\b`, 'i').test(sql)) {
          if (!createdAt.has(role)) createdAt.set(role, index);
        }
      }

      for (const role of roles) {
        const referenced =
          new RegExp(`(CREATE|ALTER)\\s+POLICY[\\s\\S]{0,400}?TO\\s+${role}\\b`, 'i').test(sql) ||
          new RegExp(`GRANT[\\s\\S]{0,400}?TO\\s+${role}\\b`, 'i').test(sql);

        if (referenced && (createdAt.get(role) ?? Infinity) > index) {
          offences.push(`${name}: references ${role} before any migration creates it`);
        }
      }
    });

    expect(offences).toEqual([]);
    // And they must actually be created somewhere.
    for (const role of roles) {
      expect(createdAt.has(role)).toBe(true);
    }
  });

  it('never puts a credential in a migration', () => {
    /*
     * Migrations are committed; passwords are not. The two runtime roles
     * are created NOLOGIN and given their passwords by
     * `prisma/bootstrap/grant-login.sql` at deploy time — see
     * prisma/BOOTSTRAP.md.
     */
    const offences = migrations.filter((name) =>
      /PASSWORD\s+'/i.test(statementsOf(name)),
    );

    expect(offences).toEqual([]);
  });

  it('never grants a runtime role a way around row-level security', () => {
    /*
     * SUPERUSER or BYPASSRLS on either runtime role would make every
     * policy in the chain decorative, and every isolation test pass for
     * the wrong reason. TRUNCATE is withheld for the same reason: it
     * ignores RLS entirely.
     */
    const offences: string[] = [];

    for (const name of migrations) {
      const sql = statementsOf(name);

      if (/\b(?<!NO)SUPERUSER\b/i.test(sql.replace(/NOSUPERUSER/gi, ''))) {
        offences.push(`${name}: grants SUPERUSER`);
      }
      if (/\bBYPASSRLS\b/i.test(sql.replace(/NOBYPASSRLS/gi, ''))) {
        offences.push(`${name}: grants BYPASSRLS`);
      }
      if (/GRANT[^;]*\bTRUNCATE\b[^;]*TO\s+dartstore/i.test(sql)) {
        offences.push(`${name}: grants TRUNCATE to a runtime role`);
      }
    }

    expect(offences).toEqual([]);
  });
});
