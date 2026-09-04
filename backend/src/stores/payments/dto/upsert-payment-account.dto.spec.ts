import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpsertPaymentAccountDto } from './upsert-payment-account.dto'

/**
 * Regression coverage for the "mode must be one of the following values:
 * test, live" bug: the frontend used to send `is_test_mode: boolean`
 * instead of `mode`, which whitelist-stripped silently and left this
 * required field missing on every save. These tests pin down exactly
 * what this DTO accepts so that regression can never reappear unnoticed.
 */
describe('UpsertPaymentAccountDto — mode validation', () => {
  async function validateMode(mode: unknown) {
    const dto = plainToInstance(UpsertPaymentAccountDto, { mode })
    return validate(dto)
  }

  it('accepts "test"', async () => {
    expect(await validateMode('test')).toHaveLength(0)
  })

  it('accepts "live"', async () => {
    expect(await validateMode('live')).toHaveLength(0)
  })

  it('rejects undefined (the missing-field regression)', async () => {
    const errors = await validateMode(undefined)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].constraints).toMatchObject({
      isIn: expect.stringContaining('mode must be one of the following values: test, live'),
    })
  })

  it('rejects an empty string', async () => {
    expect((await validateMode('')).length).toBeGreaterThan(0)
  })

  it.each(['sandbox', 'production', 'enabled', 'Test', 'LIVE', 'true', 'false'])(
    'rejects the string %p',
    async (value) => {
      expect((await validateMode(value)).length).toBeGreaterThan(0)
    },
  )

  it('rejects a boolean', async () => {
    expect((await validateMode(true)).length).toBeGreaterThan(0)
  })

  it('rejects a number', async () => {
    expect((await validateMode(1)).length).toBeGreaterThan(0)
  })

  it('rejects the legacy is_test_mode-style payload shape (no mode field at all)', async () => {
    const dto = plainToInstance(UpsertPaymentAccountDto, { is_test_mode: true })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'mode')).toBe(true)
  })
})
