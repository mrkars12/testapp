import { Injectable, Logger } from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { ProviderRegistry } from './provider-registry.service'
import {
  normalizeProviderError,
  type CredentialValidationResult,
  type PaymentErrorCode,
} from './provider.types'
import { findGateway } from '../gateway-catalog'

/**
 * ==================================================================
 * Credential validation pipeline
 * ==================================================================
 *
 * One path from "the merchant pressed save" to "the account is active or
 * errored", with the provider-specific part confined to the adapter.
 *
 * Three stages, in this order, because each is cheaper and more certain
 * than the next:
 *
 *   1. Structural — are the fields the *catalog* marks required present?
 *      Catalog-driven, so core never names a provider's fields. Catching
 *      a blank field here saves a network call and gives the merchant a
 *      better message than any provider's "unauthorized".
 *
 *   2. Provider — the adapter's own check, which is the only thing that
 *      can say whether a key is real. Core does not know what it does.
 *
 *   3. Normalisation — the outcome is forced into the closed error
 *      taxonomy, the message is redacted, and a thrown adapter becomes a
 *      reported failure. A merchant's typo must not be a 500 on the
 *      settings screen.
 *
 * ⚠️ Credentials pass through in memory and are never logged, never
 * persisted by this service, and never returned. Redaction is applied to
 * the *message* because an adapter that echoes a provider response can
 * otherwise put a key fragment in `last_error`, which is read back by
 * the API.
 */

export interface CredentialValidationOutcome extends CredentialValidationResult {
  /** Which stage decided, for diagnostics and tests. */
  readonly stage: 'structural' | 'provider' | 'skipped'
}

/** Long enough that redacting it is not going to eat ordinary words. */
const REDACTABLE_MIN_LENGTH = 8

@Injectable()
export class CredentialValidationPipeline {
  private readonly logger = new Logger(CredentialValidationPipeline.name)

  constructor(private readonly providers: ProviderRegistry) {}

  async validate(input: {
    gateway: string
    credentials: Readonly<Record<string, string>>
    mode: Mode
  }): Promise<CredentialValidationOutcome> {
    const missing = missingRequiredFields(input.gateway, input.credentials)

    if (missing.length > 0) {
      return {
        stage: 'structural',
        valid: false,
        errorCode: 'configuration_error',
        message: `Missing required fields: ${missing.join(', ')}.`,
      }
    }

    if (!this.providers.has(input.gateway)) {
      // Nothing to validate against yet. Reported rather than treated as
      // a failure: a merchant may legitimately save a draft before the
      // adapter ships, and enabling is refused elsewhere.
      return { stage: 'skipped', valid: true }
    }

    const provider = this.providers.get(input.gateway)

    let result: CredentialValidationResult

    try {
      result = await provider.validateCredentials({
        credentials: input.credentials,
        mode: input.mode,
      })
    } catch (error) {
      // An adapter is supposed to report rather than throw. When one
      // does throw — a transport failure inside its test call, usually —
      // that is still a validation outcome, not a server fault.
      const normalized = normalizeProviderError(error, 'provider_unavailable')

      this.logger.warn(
        `Credential validation for "${input.gateway}" threw (${normalized.code}).`,
      )

      result = {
        valid: false,
        errorCode: normalized.code,
        message: normalized.message,
      }
    }

    return {
      stage: 'provider',
      valid: result.valid,
      errorCode: result.valid ? undefined : (result.errorCode ?? 'unknown'),
      message: result.valid
        ? undefined
        : redactSecrets(
            result.message ?? defaultMessage(result.errorCode),
            input.credentials,
          ),
    }
  }
}

/**
 * Fields the catalog marks required and the merchant left blank.
 *
 * Reads the catalog rather than a per-provider list in core, so a new
 * gateway's required fields are declared once, in the same place the
 * form is built from.
 */
export function missingRequiredFields(
  gateway: string,
  credentials: Readonly<Record<string, string>>,
): string[] {
  const definition = findGateway(gateway)
  if (!definition) return []

  return definition.credential_fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = credentials[field.key]
      return typeof value !== 'string' || value.trim().length === 0
    })
    .map((field) => field.key)
}

/**
 * Removes any credential value that appears in a message.
 *
 * The message is persisted on the account and returned by the settings
 * API, so an adapter quoting a provider response back verbatim is one
 * echo away from exposing a key. Cheap insurance; the alternative is
 * trusting every adapter, including ones not written yet.
 */
export function redactSecrets(
  message: string,
  credentials: Readonly<Record<string, string>>,
): string {
  let redacted = message

  for (const value of Object.values(credentials)) {
    if (typeof value !== 'string') continue

    const trimmed = value.trim()
    if (trimmed.length < REDACTABLE_MIN_LENGTH) continue

    redacted = redacted.split(trimmed).join('[redacted]')
  }

  return redacted
}

function defaultMessage(code: PaymentErrorCode | undefined): string {
  // A rejection the merchant cannot act on is worse than none, so there
  // is always something to show even when the adapter said nothing.
  return code === undefined
    ? 'The provider rejected these credentials.'
    : `The provider rejected these credentials (${code}).`
}
