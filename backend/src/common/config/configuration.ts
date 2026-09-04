import { registerAs } from '@nestjs/config';

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((i) => i.trim())
    .filter((i) => i.length > 0);
}
function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function parseBoolOr(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  /**
   * Explicit opt-in for PrismaService.platform() to derive the platform
   * connection from TEST_DATABASE_URL/DATABASE_URL when DATABASE_URL_PLATFORM
   * is unset. NODE_ENV=development (the shared/deployed default) must NEVER
   * be sufficient on its own — only NODE_ENV=test (set automatically by
   * Jest) or an explicit ALLOW_PLATFORM_DB_FALLBACK=true opt-in enable it.
   */
  allowPlatformDbFallback: boolean;
  port: number;
  corsOrigins: string[];
  /**
   * The payment mode the PUBLIC storefront checkout transacts in.
   *
   * `live` always, except when a developer explicitly opts a
   * non-production deployment into `test` so a gateway's own test
   * account can be exercised against a real browser. It exists because
   * the storefront previously hardcoded `'live'`, which made a merchant's
   * configured *test* account unreachable from the storefront and left
   * the embedded flow impossible to verify without live credentials.
   *
   * Production can NEVER be flipped by it: the check below refuses the
   * override outright when NODE_ENV=production, so setting the variable
   * on a production host is inert rather than dangerous. That is the same
   * rule `allowPlatformDbFallback` follows, for the same reason — a
   * deployment must not be able to change how real customers' money is
   * handled through an environment variable someone set by accident.
   *
   * It selects which PaymentAccount and offerings the storefront sees.
   * It does not change any gateway behaviour, any adapter, or anything
   * about how a payment is verified: a `test` storefront runs exactly
   * the same code against the merchant's test account.
   */
  storefrontPaymentMode: 'live' | 'test';
  /**
   * THE KILL SWITCH for server-authoritative cart identity.
   *
   * Default ON. When it is off the storefront controllers ignore the
   * cart cookie entirely and every checkout takes the stateless path
   * that existed before — the same behaviour as a browser that sends no
   * cookie, which the backend has to tolerate anyway. That makes it a
   * rollback without a deploy, which is worth having for the first week
   * of a change that sits directly in the payment path.
   *
   * It does not delete or invalidate anything: existing carts stay in
   * the database, and turning it back on resumes exactly where it left
   * off.
   */
  cartIdentityEnabled: boolean;
}
export interface SecurityConfig {
  jwtSecret: string;
  flowSecret: string;
}
export interface PaymentsConfig {
  encryptionKey: string;
  encryptionKeyVersion: number;
  previousEncryptionKey?: string;
  previousEncryptionKeyVersion?: number;
}
export interface MessagingConfig {
  dispatcherEnabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
  backoffBaseSeconds: number;
}
export interface IdempotencyConfig {
  ttlSeconds: number;
  leaseSeconds: number;
}
export interface TenantConfig {
  guardEnabled: boolean;
  throwOnViolation: boolean;
}

/**
 * Resolves the storefront's payment mode.
 *
 * Deliberately not `parseBoolOr`-shaped: the default is `live` and the
 * ONLY value that changes it is the exact string `test`, on a
 * non-production deployment. Anything else — unset, empty, misspelled,
 * `live`, or `test` on production — is `live`.
 */
export function parseStorefrontPaymentMode(
  raw: string | undefined,
  nodeEnv: string | undefined,
): 'live' | 'test' {
  if (raw?.trim().toLowerCase() !== 'test') return 'live';
  // A production deployment is never overridable. Setting the variable
  // there is inert, not effective.
  if (nodeEnv === 'production') return 'live';
  return 'test';
}

export const appConfig = registerAs<AppConfig>('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  allowPlatformDbFallback: parseBoolOr(
    process.env.ALLOW_PLATFORM_DB_FALLBACK,
    process.env.NODE_ENV === 'test',
  ),
  port: parseIntOr(process.env.PORT, 4000),
  corsOrigins: parseList(
    process.env.CORS_ORIGINS ?? 'http://localhost:3000,*.localhost:3000',
  ),
  storefrontPaymentMode: parseStorefrontPaymentMode(
    process.env.STOREFRONT_PAYMENT_MODE,
    process.env.NODE_ENV,
  ),
  cartIdentityEnabled: parseBoolOr(process.env.CART_IDENTITY_ENABLED, true),
}));
export const securityConfig = registerAs<SecurityConfig>('security', () => ({
  jwtSecret: process.env.JWT_SECRET as string,
  flowSecret: process.env.FLOW_SECRET as string,
}));
export const paymentsConfig = registerAs<PaymentsConfig>('payments', () => ({
  encryptionKey: process.env.PAYMENT_ENCRYPTION_KEY as string,
  encryptionKeyVersion: parseIntOr(
    process.env.PAYMENT_ENCRYPTION_KEY_VERSION,
    1,
  ),
  previousEncryptionKey: process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS,
  previousEncryptionKeyVersion: process.env
    .PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION
    ? parseIntOr(process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION, 1)
    : undefined,
}));
export const messagingConfig = registerAs<MessagingConfig>('messaging', () => ({
  dispatcherEnabled: parseBoolOr(process.env.OUTBOX_DISPATCHER_ENABLED, true),
  pollIntervalMs: parseIntOr(process.env.OUTBOX_POLL_INTERVAL_MS, 5000),
  batchSize: parseIntOr(process.env.OUTBOX_BATCH_SIZE, 50),
  leaseSeconds: parseIntOr(process.env.OUTBOX_LEASE_SECONDS, 60),
  maxAttempts: parseIntOr(process.env.OUTBOX_MAX_ATTEMPTS, 8),
  backoffBaseSeconds: parseIntOr(process.env.OUTBOX_BACKOFF_BASE_SECONDS, 5),
}));
export const idempotencyConfig = registerAs<IdempotencyConfig>(
  'idempotency',
  () => ({
    ttlSeconds: parseIntOr(process.env.IDEMPOTENCY_TTL_SECONDS, 86_400),
    leaseSeconds: parseIntOr(process.env.IDEMPOTENCY_LEASE_SECONDS, 60),
  }),
);
export const tenantConfig = registerAs<TenantConfig>('tenant', () => ({
  /*
   * ON EVERYWHERE, production included.
   *
   * This used to default to `NODE_ENV !== 'production'`, which switched
   * the isolation net OFF in the one environment where a cross-tenant
   * read is an incident rather than a test failure. The guard is
   * REPORT-ONLY (see `createTenantGuardExtension`): it does not rewrite
   * a query, does not add conditions, and does not refuse anything
   * unless `throwOnViolation` is separately turned on — which it still
   * is not, by default, anywhere. So the only thing this default ever
   * suppressed in production was the warning.
   *
   * That matters here because the application-level guard is not
   * redundant with RLS: `checkouts` and `checkout_items` carry
   * `store_id` and `mode` but have no row-level security enabled, so
   * for those tables this inspection is the ONLY thing that notices a
   * query that forgot its store scope.
   *
   * Still overridable: set TENANT_GUARD_ENABLED=false to turn it off.
   */
  guardEnabled: parseBoolOr(process.env.TENANT_GUARD_ENABLED, true),
  throwOnViolation: parseBoolOr(
    process.env.TENANT_GUARD_THROW_ON_VIOLATION,
    false,
  ),
}));
export const configurationLoaders = [
  appConfig,
  securityConfig,
  paymentsConfig,
  messagingConfig,
  idempotencyConfig,
  tenantConfig,
];
