import { registerAs } from '@nestjs/config'

function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map((i) => i.trim()).filter((i) => i.length > 0)
}
function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
function parseBoolOr(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

export interface AppConfig { nodeEnv: string; isProduction: boolean; port: number; corsOrigins: string[] }
export interface SecurityConfig { jwtSecret: string; flowSecret: string }
export interface PaymentsConfig { encryptionKey: string; encryptionKeyVersion: number; previousEncryptionKey?: string; previousEncryptionKeyVersion?: number }
export interface MessagingConfig { dispatcherEnabled: boolean; pollIntervalMs: number; batchSize: number; leaseSeconds: number; maxAttempts: number; backoffBaseSeconds: number }
export interface IdempotencyConfig { ttlSeconds: number; leaseSeconds: number }
export interface TenantConfig { guardEnabled: boolean }

export const appConfig = registerAs<AppConfig>('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseIntOr(process.env.PORT, 4000),
  corsOrigins: parseList(process.env.CORS_ORIGINS ?? 'http://localhost:3000,*.localhost:3000'),
}))
export const securityConfig = registerAs<SecurityConfig>('security', () => ({
  jwtSecret: process.env.JWT_SECRET as string,
  flowSecret: process.env.FLOW_SECRET as string,
}))
export const paymentsConfig = registerAs<PaymentsConfig>('payments', () => ({
  encryptionKey: process.env.PAYMENT_ENCRYPTION_KEY as string,
  encryptionKeyVersion: parseIntOr(process.env.PAYMENT_ENCRYPTION_KEY_VERSION, 1),
  previousEncryptionKey: process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS,
  previousEncryptionKeyVersion: process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION
    ? parseIntOr(process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION, 1) : undefined,
}))
export const messagingConfig = registerAs<MessagingConfig>('messaging', () => ({
  dispatcherEnabled: parseBoolOr(process.env.OUTBOX_DISPATCHER_ENABLED, true),
  pollIntervalMs: parseIntOr(process.env.OUTBOX_POLL_INTERVAL_MS, 5000),
  batchSize: parseIntOr(process.env.OUTBOX_BATCH_SIZE, 50),
  leaseSeconds: parseIntOr(process.env.OUTBOX_LEASE_SECONDS, 60),
  maxAttempts: parseIntOr(process.env.OUTBOX_MAX_ATTEMPTS, 8),
  backoffBaseSeconds: parseIntOr(process.env.OUTBOX_BACKOFF_BASE_SECONDS, 5),
}))
export const idempotencyConfig = registerAs<IdempotencyConfig>('idempotency', () => ({
  ttlSeconds: parseIntOr(process.env.IDEMPOTENCY_TTL_SECONDS, 86_400),
  leaseSeconds: parseIntOr(process.env.IDEMPOTENCY_LEASE_SECONDS, 60),
}))
export const tenantConfig = registerAs<TenantConfig>('tenant', () => ({
  guardEnabled: parseBoolOr(process.env.TENANT_GUARD_ENABLED, process.env.NODE_ENV !== 'production'),
}))
export const configurationLoaders = [appConfig, securityConfig, paymentsConfig, messagingConfig, idempotencyConfig, tenantConfig]
