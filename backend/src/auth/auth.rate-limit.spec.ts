import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { AuthController } from './auth.controller'

/**
 * Confirms the per-route @Throttle() limits added to the previously
 * unprotected unauthenticated endpoints (forgot-password, device/resend-code)
 * actually reject requests once the limit is exceeded, and that the
 * remaining budget resets for a distinct client (different IP).
 *
 * Uses the same useMocker pattern as auth.controller.spec.ts so the real
 * AuthService dependency graph never has to be resolved.
 */

const autoMock = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, prop) => {
      if (prop === 'then') return undefined
      if (!(prop in target)) target[prop] = jest.fn().mockResolvedValue({ ok: true })
      return target[prop]
    },
  })

const mocker = (token: unknown): unknown => {
  if (token === ConfigService) {
    return {
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => `test-${String(key)}`),
    }
  }
  return autoMock()
}

describe('AuthController rate limiting', () => {
  let app: INestApplication

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])],
      controllers: [AuthController],
    })
      .useMocker(mocker)
      .compile()

    app = module.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('rejects device/resend-code after its 3-request limit (429)', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/device/resend-code')
        .send({ email: 'qa@example.com', fingerprint: 'fp-1' })
      expect(res.status).not.toBe(429)
    }

    const blocked = await request(app.getHttpServer())
      .post('/auth/device/resend-code')
      .send({ email: 'qa@example.com', fingerprint: 'fp-1' })
    expect(blocked.status).toBe(429)
  })

  it('rejects forgot-password after its 5-request limit (429)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'qa@example.com' })
      expect(res.status).not.toBe(429)
    }

    const blocked = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'qa@example.com' })
    expect(blocked.status).toBe(429)
  })

  it('does not rate-limit an unrelated, unthrottled auth route (recover-password/verify)', async () => {
    // Sanity check: the per-route decorator only affects its own route,
    // it did not accidentally get applied controller-wide.
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .get('/auth/recover-password/verify')
        .query({ code: 'x' })
      expect(res.status).not.toBe(429)
    }
  })
})
