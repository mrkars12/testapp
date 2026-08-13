import { CodAdapter } from './cod.adapter'
import { BankTransferAdapter } from './bank-transfer.adapter'
import { ProviderError, type PaymentCallContext } from '../provider.types'

const ctx = (credentials: Record<string, string> = {}): PaymentCallContext => ({
  storeId: 1n,
  mode: 'live',
  accountId: 2n,
  offeringId: 3n,
  method: 'cod',
  gatewayMethodConfig: '',
  intentId: 4n,
  attemptId: 5n,
  attemptSequence: 1,
  amountMinor: 5000n,
  currency: 'USD',
  credentials,
})

describe('CodAdapter', () => {
  const adapter = new CodAdapter()

  it('declares an offline commitment and no provider features', () => {
    const c = adapter.capabilities
    expect(c.gateway).toBe('cod')
    expect(c.methods).toEqual(['cod'])
    expect(c.offlineCommitmentKind).toBe('promise_accepted')
    expect(c.webhooks).toBe(false)
    expect(c.statusPolling).toBe(false)
    expect(c.partialRefund).toBe(false)
  })

  it('needs no credentials', async () => {
    await expect(adapter.validateCredentials()).resolves.toEqual({ valid: true })
  })

  it('returns no_gateway with a promise commitment', async () => {
    const result = await adapter.initializePayment(ctx())
    expect(result).toEqual({ kind: 'no_gateway', commitmentKind: 'promise_accepted' })
  })

  it('has nothing to poll', async () => {
    await expect(
      adapter.fetchStatus({
        accountId: 1n, gatewayReference: 'x', credentials: {}, mode: 'live',
      }),
    ).resolves.toEqual([])
  })
})

describe('BankTransferAdapter', () => {
  const adapter = new BankTransferAdapter()

  const complete = {
    bank_name: 'Test Bank',
    account_holder: 'Spec Store',
    account_number: '123',
    iban: 'EG123',
    swift: 'TESTEG',
    instructions: 'Send within 3 days',
  }

  it('declares an offline settlement commitment', () => {
    expect(adapter.capabilities.gateway).toBe('bank_transfer')
    expect(adapter.capabilities.offlineCommitmentKind).toBe('awaiting_offline_settlement')
  })

  it('validates required bank details', async () => {
    await expect(adapter.validateCredentials({ credentials: complete })).resolves.toEqual({
      valid: true,
    })

    const missing = await adapter.validateCredentials({ credentials: { bank_name: 'X' } })
    expect(missing.valid).toBe(false)
    expect(missing.errorCode).toBe('configuration_error')
    expect(missing.message).toContain('account_holder')
  })

  it('treats a blank value as missing', async () => {
    const result = await adapter.validateCredentials({
      credentials: { bank_name: 'X', account_holder: '   ' },
    })
    expect(result.valid).toBe(false)
  })

  it('returns bank instructions as the next action', async () => {
    const result = await adapter.initializePayment(ctx(complete))

    expect(result.kind).toBe('no_gateway')
    if (result.kind !== 'no_gateway') throw new Error('unexpected')

    expect(result.commitmentKind).toBe('awaiting_offline_settlement')
    expect(result.nextAction).toEqual({
      kind: 'bank_instructions',
      fields: {
        bank_name: 'Test Bank',
        account_holder: 'Spec Store',
        account_number: '123',
        iban: 'EG123',
        swift: 'TESTEG',
        instructions: 'Send within 3 days',
      },
    })
  })

  it('nulls optional fields it was not given', async () => {
    const result = await adapter.initializePayment(
      ctx({ bank_name: 'B', account_holder: 'H' }),
    )
    if (result.kind !== 'no_gateway' || !result.nextAction) throw new Error('unexpected')
    if (result.nextAction.kind !== 'bank_instructions') throw new Error('unexpected')

    expect(result.nextAction.fields).toMatchObject({ iban: null, swift: null })
  })

  it('refuses to initialise when the merchant has not configured it', async () => {
    await expect(adapter.initializePayment(ctx({}))).rejects.toBeInstanceOf(ProviderError)

    try {
      await adapter.initializePayment(ctx({}))
    } catch (error) {
      expect((error as ProviderError).code).toBe('configuration_error')
    }
  })

  it('never leaks a credential key it was not asked to expose', async () => {
    const result = await adapter.initializePayment(
      ctx({ ...complete, secret_key: 'sk_live_should_not_appear' }),
    )
    if (result.kind !== 'no_gateway' || !result.nextAction) throw new Error('unexpected')

    expect(JSON.stringify(result.nextAction)).not.toContain('sk_live_should_not_appear')
  })

  it('has nothing to poll', async () => {
    await expect(
      adapter.fetchStatus({
        accountId: 1n, gatewayReference: 'x', credentials: {}, mode: 'live',
      }),
    ).resolves.toEqual([])
  })
})