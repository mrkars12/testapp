import { ProviderRegistry } from '../provider-registry.service'
import type { IPaymentProvider } from '../payment-provider.interface'
import { isWebhookCapable } from '../payment-provider.interface'
import {
  PAYMENT_ERROR_CODES,
  ProviderError,
  callContextIdempotencyKey,
  capabilityContradictions,
  classifyPaymentError,
  isCustomerActionable,
  isRetryable,
  shouldFailover,
  type InitializeResult,
  type ObservedFact,
  type PaymentCallContext,
  type PaymentErrorCode,
} from '../provider.types'
import { resolveWebhookAccountRef } from '../webhook-resolution'

/**
 * ==================================================================
 * Provider conformance suite
 * ==================================================================
 *
 * One executable definition of what `IPaymentProvider` actually
 * promises, run against every adapter the module registers.
 *
 * The point is that the contract stops being prose. A capability matrix
 * nobody enforces becomes a lie, and the lie surfaces when a customer's
 * payment fails — so every claim an adapter makes about itself is
 * checked here against code that must exist and behave.
 *
 * Adding a provider means adding one entry to the list in the spec.
 * Nothing in this file changes.
 *
 * ⚠️ This suite deliberately does not reach a network. Adapters are
 * given whatever transport stub they already accept for unit testing
 * (Stripe takes a client factory; the manual adapters take nothing), so
 * what is under test is the adapter's own logic and its honesty about
 * its capabilities — not the provider's uptime.
 */

/**
 * Every error code an adapter is allowed to produce.
 *
 * The taxonomy itself, not a copy of it. A second hand-written list here
 * would pass while core and the suite disagreed about what the closed
 * set contains.
 */
const ERROR_CODES: readonly PaymentErrorCode[] = PAYMENT_ERROR_CODES

const RESULT_KINDS = [
  'no_gateway',
  'requires_action',
  'pending',
  'authorized',
  'succeeded',
] as const

/**
 * What a spec supplies for one adapter.
 *
 * Everything beyond `build` is optional: an adapter that cannot fail in
 * a way the suite can trigger simply does not describe a failure, and
 * the corresponding assertions are skipped rather than faked.
 */
export interface ConformanceCase {
  /** Gateway key, used only to name the tests. */
  readonly gateway: string

  /** A fresh adapter. Called per assertion so state cannot leak between them. */
  readonly build: () => IPaymentProvider

  /** Credentials that should satisfy validateCredentials(). */
  readonly validCredentials: Readonly<Record<string, string>>

  /**
   * Call-context fields this adapter cannot work without.
   *
   * Most adapters need none. One whose provider issues a per-method
   * integration id — Paymob does — cannot start a payment with an empty
   * `gatewayMethodConfig`, and refusing is the correct behaviour rather
   * than something to work around. Merged over the shared context so the
   * rest of the contract is still exercised identically.
   */
  readonly context?: Partial<PaymentCallContext>

  /**
   * Credentials the adapter must reject.
   *
   * Omit only when the adapter genuinely has nothing to validate — cash
   * on delivery has no account to reach.
   */
  readonly invalidCredentials?: Readonly<Record<string, string>>

  /**
   * Builds an adapter whose provider call fails, plus the code it must
   * map that failure to. Omitted when the suite cannot trigger a
   * failure without inventing provider behaviour.
   */
  readonly failure?: {
    readonly build: () => IPaymentProvider
    readonly expectedCode: PaymentErrorCode
  }

  /**
   * Runs `initializePayment` twice and returns the idempotency keys the
   * adapter sent outbound.
   *
   * Only meaningful for adapters that call a provider. The suite cannot
   * inspect an arbitrary transport itself, so the adapter's own spec
   * supplies this.
   */
  readonly outboundIdempotencyKeys?: (
    context: PaymentCallContext,
  ) => Promise<readonly (string | undefined)[]>

  /** A signed, well-formed webhook body plus its headers, if the adapter takes webhooks. */
  readonly webhook?: {
    readonly rawBody: Buffer
    readonly headers: Record<string, string | string[] | undefined>
    /** For providers that sign in the query string rather than a header. */
    readonly query?: Record<string, string | string[] | undefined>
    /**
     * The same callback with its authentication removed.
     *
     * Needed only by providers that authenticate from the *body* rather
     * than a header or the query string — Moyasar sends a shared secret
     * token inside the payload, so stripping the transport around it
     * proves nothing. Omit it and the suite strips the headers and query
     * instead, which is the right test for a signature-based provider.
     */
    readonly unsignedRawBody?: Buffer
    readonly signingSecret: string
  }
}

export function conformanceContext(
  over: Partial<PaymentCallContext> = {},
): PaymentCallContext {
  return {
    storeId: 1n,
    mode: 'live',
    accountId: 9n,
    offeringId: 2n,
    method: 'card',
    gatewayMethodConfig: '',
    intentId: 77n,
    attemptId: null,
    attemptSequence: 1,
    amountMinor: 10_000n,
    currency: 'USD',
    credentials: {},
    ...over,
  }
}

/**
 * Runs the shared contract against one adapter.
 *
 * Call inside a spec file; it declares its own `describe`/`it` blocks.
 */
export function runProviderConformance(testCase: ConformanceCase): void {
  const { gateway } = testCase

  describe(`${gateway} — provider contract`, () => {
    /* ---------------------------------------------------------- */
    /* 1 & 2. Identity, and registration through the real registry */
    /* ---------------------------------------------------------- */

    describe('registration', () => {
      it('registers under the gateway it names in its capabilities', () => {
        const adapter = testCase.build()
        const registry = new ProviderRegistry([adapter])
        registry.onModuleInit()

        expect(adapter.capabilities.gateway).toBe(gateway)
        expect(registry.has(gateway)).toBe(true)
        expect(registry.get(gateway)).toBe(adapter)
        expect(registry.registeredGateways()).toEqual([gateway])
      })

      it('passes the registry boot check', () => {
        // The registry refuses an adapter whose capabilities are not
        // backed by methods. Booting it is the check.
        expect(() => new ProviderRegistry([testCase.build()]).onModuleInit()).not.toThrow()
      })
    })

    /* ---------------------------------------------------------- */
    /* 3 & 13. Capabilities are consistent and backed by code      */
    /* ---------------------------------------------------------- */

    describe('capabilities', () => {
      it('declares at least one payment method', () => {
        expect(testCase.build().capabilities.methods.length).toBeGreaterThan(0)
      })

      it('backs every declared capability with a method', () => {
        const adapter = testCase.build()
        const c = adapter.capabilities

        // The other direction of the registry's boot check, asserted
        // per capability so a failure names which one is unbacked.
        if (c.manualCapture) expect(typeof adapter.capture).toBe('function')
        if (c.voidSupported) expect(typeof adapter.voidAuthorization).toBe('function')
        if (c.refundSupported) expect(typeof adapter.refund).toBe('function')
        if (c.webhooks) expect(typeof adapter.parseWebhook).toBe('function')

        // Payload-scoped routing is a claim about code as much as any
        // other: without the extractor there is no way to find the
        // account a callback belongs to.
        if (c.webhooks && c.webhookResolution === 'payload_scoped') {
          expect(typeof adapter.extractWebhookAccountRef).toBe('function')
        }
      })

      it('does not carry a method for a capability it disclaims', () => {
        // Orchestration decides what to call from the descriptor alone.
        // A method present while the flag is false is a trap: it reads
        // as supported to anyone grepping, and is never reachable.
        const adapter = testCase.build()
        const c = adapter.capabilities

        if (!c.manualCapture) expect(adapter.capture).toBeUndefined()
        if (!c.voidSupported) expect(adapter.voidAuthorization).toBeUndefined()
        if (!c.refundSupported) expect(adapter.refund).toBeUndefined()
        if (!c.webhooks) expect(adapter.parseWebhook).toBeUndefined()
      })

      it('declares a descriptor with no internal contradictions', () => {
        // The same rule set the registry enforces at boot, asserted here
        // so a failure names the contradiction instead of a boot error.
        expect(capabilityContradictions(testCase.build().capabilities)).toEqual([])
      })

      it('implements the two methods every adapter must have', () => {
        const adapter = testCase.build()

        // fetchStatus is deliberately not optional: it is what makes the
        // system correct when webhooks are lost.
        expect(typeof adapter.fetchStatus).toBe('function')
        expect(typeof adapter.validateCredentials).toBe('function')
      })

      it('keeps capture flags coherent', () => {
        const c = testCase.build().capabilities

        // Partial or multi capture without manual capture describes an
        // operation the orchestrator can never reach.
        if (c.partialCapture) expect(c.manualCapture).toBe(true)
        if (c.multiCapture) expect(c.manualCapture).toBe(true)

        // An online adapter that can take money neither way could start
        // a payment it can never complete.
        if (c.offlineCommitmentKind === null) {
          expect(c.automaticCapture || c.manualCapture).toBe(true)
        }
      })

      it('keeps refund flags coherent', () => {
        const c = testCase.build().capabilities

        // Partial refund is a narrowing of refund, not a separate
        // ability: claiming it without the base leaves the refund path
        // refusing an operation the adapter can perform.
        if (c.partialRefund) expect(c.refundSupported).toBe(true)
      })

      it('names a webhook resolution strategy when it takes webhooks', () => {
        const c = testCase.build().capabilities

        if (c.webhooks) {
          expect(c.webhookResolution).not.toBe('none')
        } else {
          expect(c.webhookResolution).toBe('none')
        }
      })

      it('claims no gateway-only capability when it settles offline', () => {
        const c = testCase.build().capabilities

        // offlineCommitmentKind means there is no provider behind this
        // method, so there is nothing to capture, void, refund or call
        // back.
        if (c.offlineCommitmentKind !== null) {
          expect(c.automaticCapture).toBe(false)
          expect(c.manualCapture).toBe(false)
          expect(c.voidSupported).toBe(false)
          expect(c.refundSupported).toBe(false)
          expect(c.partialRefund).toBe(false)
          expect(c.webhooks).toBe(false)
          expect(c.statusPolling).toBe(false)
        }
      })
    })

    /* ---------------------------------------------------------- */
    /* Credential validation                                       */
    /* ---------------------------------------------------------- */

    describe('validateCredentials', () => {
      it('accepts credentials it considers usable', async () => {
        const result = await testCase
          .build()
          .validateCredentials({
            credentials: testCase.validCredentials,
            mode: 'live',
          })

        expect(result.valid).toBe(true)
      })

      it('rejects unusable credentials with a supported error code', async () => {
        if (!testCase.invalidCredentials) return

        const result = await testCase
          .build()
          .validateCredentials({
            credentials: testCase.invalidCredentials,
            mode: 'live',
          })

        expect(result.valid).toBe(false)
        // A rejection the merchant cannot act on is worse than none.
        expect(result.message ?? '').not.toHaveLength(0)

        if (result.errorCode !== undefined) {
          expect(ERROR_CODES).toContain(result.errorCode)
        }
      })

      it('reports rather than throws when credentials are unusable', async () => {
        if (!testCase.invalidCredentials) return

        // A rejected key is a domain outcome. Throwing would turn a
        // merchant's typo into a 500 at the settings screen.
        await expect(
          testCase.build().validateCredentials({
            credentials: testCase.invalidCredentials,
            mode: 'live',
          }),
        ).resolves.toBeDefined()
      })
    })

    /* ---------------------------------------------------------- */
    /* 4, 6, 12. initializePayment                                 */
    /* ---------------------------------------------------------- */

    describe('initializePayment', () => {
      const context = () =>
        conformanceContext({
          credentials: testCase.validCredentials,
          ...testCase.context,
        })

      it('returns one of the normalised result kinds', async () => {
        const result = await testCase.build().initializePayment(context())

        expect(RESULT_KINDS).toContain(result.kind)
      })

      it('returns amounts as bigint minor units', async () => {
        const result = await testCase.build().initializePayment(context())

        // The whole codebase moves money as bigint minor units. A number
        // here silently loses precision above 2^53.
        assertResultAmountsAreBigInt(result)
      })

      it('carries a gateway reference on every result that has one', async () => {
        const result = await testCase.build().initializePayment(context())

        if (
          result.kind === 'authorized' ||
          result.kind === 'succeeded' ||
          result.kind === 'requires_action' ||
          result.kind === 'pending'
        ) {
          // Without a reference nothing downstream can match a webhook
          // or a status poll back to this attempt.
          expect(result.refs?.gatewayReference ?? '').not.toHaveLength(0)
        }
      })

      it('honours the offline commitment contract', async () => {
        const adapter = testCase.build()
        const offlineKind = adapter.capabilities.offlineCommitmentKind

        const result = await adapter.initializePayment(context())

        if (offlineKind !== null) {
          expect(result.kind).toBe('no_gateway')
          if (result.kind === 'no_gateway') {
            // The commitment the checkout records must be the one the
            // adapter declares, not a second opinion.
            expect(result.commitmentKind).toBe(offlineKind)
          }
        } else {
          expect(result.kind).not.toBe('no_gateway')
        }
      })

      it('returns only next-action kinds it declared', async () => {
        const adapter = testCase.build()
        const result = await adapter.initializePayment(context())

        const action =
          result.kind === 'requires_action'
            ? result.nextAction
            : result.kind === 'no_gateway'
              ? result.nextAction
              : undefined

        if (!action || action.kind === 'none') return

        // A storefront decides what it can render from the descriptor
        // alone. An undeclared kind reaches a checkout with no way to
        // display it, and the customer sees a blank step.
        expect(adapter.capabilities.nextActionKinds).toContain(action.kind)
      })

      it('accepts a zero-decimal and a three-decimal currency', async () => {
        const adapter = testCase.build()

        if (adapter.capabilities.currencies !== 'all') return

        // JPY has no minor unit and KWD has three. An adapter claiming
        // every currency must not assume two.
        for (const currency of ['JPY', 'KWD']) {
          await expect(
            adapter.initializePayment(context1(context(), currency)),
          ).resolves.toBeDefined()
        }
      })
    })

    /* ---------------------------------------------------------- */
    /* 5. Deterministic outbound idempotency                       */
    /* ---------------------------------------------------------- */

    describe('provider idempotency', () => {
      it('sends the same key for the same call twice', async () => {
        if (!testCase.outboundIdempotencyKeys) return

        const keys = await testCase.outboundIdempotencyKeys(
          conformanceContext({
            credentials: testCase.validCredentials,
            ...testCase.context,
          }),
        )

        expect(keys.length).toBeGreaterThanOrEqual(2)
        // Derived, never random: a retry carrying a fresh key is how a
        // customer gets charged twice.
        expect(keys[0]).toBeDefined()
        expect(new Set(keys).size).toBe(1)
      })

      it('sends the key core derived, not one of its own', async () => {
        if (!testCase.outboundIdempotencyKeys) return

        const context = conformanceContext({
          credentials: testCase.validCredentials,
          ...testCase.context,
          idempotencyKey: 'psp:1:77:1:conformance-supplied',
        })

        const [sent] = await testCase.outboundIdempotencyKeys(context)

        // Core records this key on the attempt. An adapter deriving its
        // own instead means the recorded key and the sent key can drift,
        // and the drift is only visible as a double charge.
        expect(sent).toBe(callContextIdempotencyKey(context, 'initialize'))
        expect(sent).toBe('psp:1:77:1:conformance-supplied')
      })

      it('reshapes the key purely, if it reshapes it at all', () => {
        const adapter = testCase.build()

        if (!adapter.idempotencyKeyFor) return

        const input = { base: 'psp:1:77:1:capture', operation: 'capture' as const }

        // The hook exists to fit a provider's length or charset rules.
        // A value that changes between calls is a fresh key wearing a
        // hook's clothes.
        expect(adapter.idempotencyKeyFor(input)).toBe(
          adapter.idempotencyKeyFor(input),
        )
        expect(adapter.idempotencyKeyFor(input)).not.toHaveLength(0)
      })
    })

    /* ---------------------------------------------------------- */
    /* 7. Error mapping                                            */
    /* ---------------------------------------------------------- */

    describe('error mapping', () => {
      it('maps a provider failure to a supported code', async () => {
        if (!testCase.failure) return

        const adapter = testCase.failure.build()

        const error = await adapter
          .initializePayment(
            conformanceContext({
              credentials: testCase.validCredentials,
              ...testCase.context,
            }),
          )
          .then(
            () => null,
            (caught: unknown) => caught,
          )

        expect(error).toBeInstanceOf(ProviderError)

        const code = (error as ProviderError).code
        expect(ERROR_CODES).toContain(code)
        expect(code).toBe(testCase.failure.expectedCode)
      })

      it('produces a code the retry and failover policies understand', async () => {
        if (!testCase.failure) return

        const code = testCase.failure.expectedCode

        // Every code must be classifiable without throwing; these are
        // what the orchestrator keys its behaviour off.
        expect(typeof isRetryable(code)).toBe('boolean')
        expect(typeof shouldFailover(code)).toBe('boolean')
        expect(typeof isCustomerActionable(code)).toBe('boolean')

        // The four fields are the whole of what core is allowed to know
        // about a failure — no provider string crosses the boundary.
        const classification = classifyPaymentError(code)
        expect(classification.code).toBe(code)
        expect(classification.retryable).toBe(isRetryable(code))
        expect(classification.failover).toBe(shouldFailover(code))
        expect(classification.customerActionable).toBe(isCustomerActionable(code))
      })
    })

    /* ---------------------------------------------------------- */
    /* 8. Webhook contract                                         */
    /* ---------------------------------------------------------- */

    describe('webhooks', () => {
      it('parses a well-formed signed callback into facts', async () => {
        const adapter = testCase.build()

        if (!adapter.capabilities.webhooks || !testCase.webhook) return

        const facts = await adapter.parseWebhook!({
          accountId: 9n,
          rawBody: testCase.webhook.rawBody,
          headers: testCase.webhook.headers,
          query: testCase.webhook.query ?? {},
          signingSecret: testCase.webhook.signingSecret,
          mode: 'live',
        })

        expect(Array.isArray(facts)).toBe(true)
        for (const fact of facts) assertFactShape(fact)
      })

      it('refuses an unsigned callback with a ProviderError', async () => {
        const adapter = testCase.build()

        if (!adapter.capabilities.webhooks || !testCase.webhook) return

        // Authentication removed: an adapter that throws a bare Error
        // here turns a forged callback into a 500 instead of a
        // rejection.
        const error = await adapter
          .parseWebhook!({
            accountId: 9n,
            // Whichever transport the adapter reads its authentication
            // from — header, query or body — this is the callback with
            // that authentication absent.
            rawBody: testCase.webhook.unsignedRawBody ?? testCase.webhook.rawBody,
            headers: {},
            query: {},
            signingSecret: testCase.webhook.signingSecret,
            mode: 'live',
          })
          .then(
            () => null,
            (caught: unknown) => caught,
          )

        expect(error).toBeInstanceOf(ProviderError)
        expect(ERROR_CODES).toContain((error as ProviderError).code)
      })

      it('routes a callback by the strategy it declares', () => {
        const adapter = testCase.build()
        const c = adapter.capabilities

        if (!isWebhookCapable(adapter) || !testCase.webhook) return

        const outcome = resolveWebhookAccountRef({
          strategy: c.webhookResolution,
          request: {
            gateway: gateway,
            endpointAccountId: '9',
            rawBody: testCase.webhook.rawBody,
            headers: testCase.webhook.headers,
          },
          extract: adapter.extractWebhookAccountRef
            ? (input) => adapter.extractWebhookAccountRef!(input)
            : undefined,
        })

        // Whatever the strategy, a well-formed callback delivered to an
        // account's own endpoint must be routable. An adapter whose
        // declared strategy cannot resolve one is unusable in production
        // and the failure would first appear as a lost payment.
        expect(outcome.kind).toBe('ref')
      })

      it('never throws while extracting an account from raw bytes', () => {
        const adapter = testCase.build()

        if (!adapter.extractWebhookAccountRef) return

        // The bytes come from an unauthenticated endpoint. A throw here
        // is a 500 an attacker can trigger at will.
        for (const body of [
          Buffer.from('not json', 'utf8'),
          Buffer.alloc(0),
          Buffer.from('{"unexpected":true}', 'utf8'),
        ]) {
          expect(() =>
            adapter.extractWebhookAccountRef!({ rawBody: body, headers: {} }),
          ).not.toThrow()
        }
      })

      it('describes a callback without trusting it, where supported', () => {
        const adapter = testCase.build()

        if (!adapter.describeWebhook || !testCase.webhook) return

        const descriptor = adapter.describeWebhook({
          rawBody: testCase.webhook.rawBody,
        })

        if (descriptor !== null) {
          expect(descriptor.eventId).not.toHaveLength(0)
          expect(descriptor.eventType).not.toHaveLength(0)
          expect(typeof descriptor.recognised).toBe('boolean')
        }

        // Garbage in must not throw: it arrives from an unauthenticated
        // endpoint.
        expect(() =>
          adapter.describeWebhook!({ rawBody: Buffer.from('not json', 'utf8') }),
        ).not.toThrow()
      })
    })

    /* ---------------------------------------------------------- */
    /* 9, 10, 11. Capture / void / refund follow the capability    */
    /* ---------------------------------------------------------- */

    describe('capture, void and refund', () => {
      it('returns facts from capture when it claims manual capture', async () => {
        const adapter = testCase.build()

        if (!adapter.capabilities.manualCapture) return

        const facts = await adapter.capture!({
          accountId: 9n,
          gatewayReference: 'ref_1',
          gatewayPaymentId: 'txn_1',
          amountMinor: 5_000n,
          currency: 'USD',
          credentials: testCase.validCredentials,
          idempotencyKey: 'psp:1:77:1:capture',
          mode: 'live',
        })

        expect(Array.isArray(facts)).toBe(true)
        for (const fact of facts) assertFactShape(fact)
      })

      it('returns facts from void when it claims void support', async () => {
        const adapter = testCase.build()

        if (!adapter.capabilities.voidSupported) return

        const facts = await adapter.voidAuthorization!({
          accountId: 9n,
          gatewayReference: 'ref_1',
          gatewayPaymentId: 'txn_1',
          credentials: testCase.validCredentials,
          idempotencyKey: 'psp:1:77:1:void',
          mode: 'live',
        })

        expect(Array.isArray(facts)).toBe(true)
        for (const fact of facts) assertFactShape(fact)
      })

      it('returns facts from refund when it claims refund support', async () => {
        const adapter = testCase.build()

        if (!adapter.capabilities.refundSupported) return

        const facts = await adapter.refund!({
          accountId: 9n,
          gatewayReference: 'ref_1',
          gatewayPaymentId: 'txn_1',
          gatewayCaptureRef: null,
          amountMinor: 2_500n,
          currency: 'USD',
          credentials: testCase.validCredentials,
          idempotencyKey: 'psp:1:77:1:refund:2500',
          mode: 'live',
        })

        expect(Array.isArray(facts)).toBe(true)
        for (const fact of facts) assertFactShape(fact)
      })
    })

    /* ---------------------------------------------------------- */
    /* fetchStatus                                                 */
    /* ---------------------------------------------------------- */

    describe('fetchStatus', () => {
      it('returns facts, never null', async () => {
        const facts = await testCase.build().fetchStatus({
          accountId: 9n,
          gatewayReference: 'ref_1',
          credentials: testCase.validCredentials,
          mode: 'live',
        })

        expect(Array.isArray(facts)).toBe(true)
        for (const fact of facts) assertFactShape(fact)
      })
    })
  })
}

/* ------------------------------------------------------------------ */

function context1(
  base: PaymentCallContext,
  currency: string,
): PaymentCallContext {
  return { ...base, currency }
}

/** Every fact must be routable and self-describing. */
function assertFactShape(fact: ObservedFact): void {
  expect(fact.dedupeKey).not.toHaveLength(0)
  expect(typeof fact.accountId).toBe('bigint')
  expect(fact.gatewayReference).not.toHaveLength(0)
  expect(fact.factType).not.toHaveLength(0)

  if (fact.cumulativeAmountMinor !== undefined) {
    expect(typeof fact.cumulativeAmountMinor).toBe('bigint')
  }
}

function assertResultAmountsAreBigInt(result: InitializeResult): void {
  if (result.kind === 'authorized') {
    expect(typeof result.authorizedAmountMinor).toBe('bigint')
  }

  if (result.kind === 'succeeded') {
    expect(typeof result.capturedAmountMinor).toBe('bigint')
  }
}
