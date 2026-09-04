import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

/**
 * AuthService بقى بياخد ConfigService في الـ constructor بعد ما اتشال
 * الـ fallback المكتوب في الكود لـ FLOW_SECRET.
 *
 * useMocker بيوفّر بديل تلقائي لأي اعتماد مش متسجّل صراحةً
 * (PrismaService و JwtService و RealtimeGateway)، فالاختبار مش هيتكسر
 * تاني لو الاعتماديات اتغيّرت في مرحلة جاية.
 */

/** بديل عام: أي خاصية بتتقرأ بترجع jest.fn() */
const autoMock = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, prop) => {
      // من غير ده الكائن بيبقى thenable و await بيتوه فيه
      if (prop === 'then') return undefined;
      if (!(prop in target)) target[prop] = jest.fn();
      return target[prop];
    },
  });

const mocker = (token: unknown): unknown => {
  if (token === ConfigService) {
    return {
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => `test-${String(key)}`),
    };
  }
  return autoMock();
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    })
      .useMocker(mocker)
      .compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

/**
 * Regression test for a brute-force finding from the security audit:
 * verifyOtp() previously compared the submitted code with zero attempt
 * limiting, letting an unauthenticated caller try all ~900,000 possible
 * 6-digit codes against a known email with no lockout. See
 * FINAL_SECURITY_AUDIT_REPORT.md.
 */
describe('AuthService.verifyOtp — brute-force lockout', () => {
  let service: AuthService;
  let prisma: {
    users: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      users: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    })
      .useMocker((token) => {
        if (token === ConfigService) {
          return {
            get: jest.fn(),
            getOrThrow: jest.fn((key: string) => `test-${String(key)}`),
          };
        }
        return autoMock();
      })
      .compile();

    service = module.get<AuthService>(AuthService);
    // Prisma is resolved via autoMock() above; overwrite it with our
    // controllable stub so each test can script findUnique()/update().
    (service as unknown as { prisma: unknown }).prisma = prisma;
  });

  it('rejects a wrong code and increments email_otp_attempts', async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: 1n,
      email_otp: '111111',
      email_otp_attempts: 0,
      email_otp_expires_at: new Date(Date.now() + 60_000),
    });

    const result = await service.verifyOtp(
      'user@example.com',
      '999999',
      'fp',
      'ua',
      {} as any,
    );

    expect(result.success).toBe(false);
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email_otp_attempts: { increment: 1 } },
      }),
    );
  });

  it('locks out further guesses once the attempt cap is reached, without re-checking the code', async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: 1n,
      email_otp: '111111',
      email_otp_attempts: 5,
      email_otp_expires_at: new Date(Date.now() + 60_000),
    });

    // Even the correct code must be rejected once locked out.
    const result = await service.verifyOtp(
      'user@example.com',
      '111111',
      'fp',
      'ua',
      {} as any,
    );

    expect(result.success).toBe(false);
    expect((result as { message?: string }).message).toContain(
      'تجاوز عدد المحاولات',
    );
    // Locked-out path must short-circuit before any attempt increment.
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});

/**
 * Unified signup (Part 1/2/3/31 of the account+store onboarding stage):
 * there is no personal/business choice, and registering produces a user
 * AND its first store in one transaction — never one without the other.
 */
describe('AuthService.processRegistration — fused account + first store', () => {
  let service: AuthService;
  let prisma: {
    users: { findUnique: jest.Mock };
    store: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    users: { create: jest.Mock; update: jest.Mock };
    store: { create: jest.Mock };
    storeTheme: { create: jest.Mock };
  };
  const res = { cookie: jest.fn() } as any;

  // No `username` — it's not a registration-form field anymore (Part 1 of
  // the registration-form refinement); AuthService derives one.
  const validPayload = {
    email: 'new@example.com',
    password: 'Sup3r$ecret',
    first_name: 'Ahmed',
    last_name: 'Mohamed',
    phone: '+201234567890',
    country: 'SA',
    store_name: 'My Store',
    store_slug: 'my-store',
    store_currency: 'SAR',
    accounttype: 'business', // must be ignored — Part 1: no public business choice
  };

  beforeEach(async () => {
    tx = {
      users: {
        create: jest.fn().mockResolvedValue({
          id: 1n,
          email: validPayload.email,
          username: 'ahmedmohamed',
          two_factor_enabled: false,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      store: {
        create: jest.fn().mockResolvedValue({
          id: 10n,
          slug: 'my-store',
          name: 'My Store',
          currency: 'SAR',
        }),
      },
      storeTheme: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      // Used for both the duplicate-email pre-check and
      // generateUniqueUsername's availability loop — null means "not
      // taken" for both.
      users: { findUnique: jest.fn().mockResolvedValue(null) },
      store: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb) => cb(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    })
      .useMocker(mocker)
      .compile();

    service = module.get<AuthService>(AuthService);
    (service as unknown as { prisma: unknown }).prisma = prisma;
    // FLOW_SECRET comes from ConfigService.getOrThrow, mocked to a fixed
    // value above — sign the same way processRegistration verifies.
    const crypto = require('crypto');
    (service as any).signature = crypto
      .createHmac('sha256', 'test-security.flowSecret')
      .update('flow-token')
      .digest('hex');
  });

  it('creates the user and the first store in the same transaction, forcing accounttype to individual', async () => {
    const result = await service.processRegistration(
      validPayload,
      'flow-token',
      (service as any).signature,
      res,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accounttype: 'individual', // never trusted from the client
          // `users` has no first_name/last_name/phone columns (see
          // FINAL_AUTH_SIGNUP_TECHNICAL_REPAIR_REPORT.md) — they're folded
          // into `fullname` instead of written as separate fields.
          fullname: 'Ahmed Mohamed',
          // Not user-supplied (Part 1: no username field) — derived from
          // first_name+last_name via generateUniqueUsername.
          username: 'ahmedmohamed',
        }),
      }),
    );
    expect(tx.store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'my-store',
          currency: 'SAR',
          ownerId: 1n,
          is_default: true,
        }),
      }),
    );
    expect(tx.storeTheme.create).toHaveBeenCalled();
    expect((result as any).store).toEqual({
      slug: 'my-store',
      name: 'My Store',
      currency: 'SAR',
    });
  });

  it('rejects an unsupported store currency before opening a transaction', async () => {
    await expect(
      service.processRegistration(
        { ...validPayload, store_currency: 'XXX' },
        'flow-token',
        (service as any).signature,
        res,
      ),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a store slug that is already taken before opening a transaction', async () => {
    prisma.store.findUnique.mockResolvedValueOnce({ id: 99n, slug: 'my-store' });

    await expect(
      service.processRegistration(validPayload, 'flow-token', (service as any).signature, res),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email before opening a transaction', async () => {
    prisma.users.findUnique.mockResolvedValueOnce({ id: 5n });

    await expect(
      service.processRegistration(validPayload, 'flow-token', (service as any).signature, res),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('derives a unique username automatically instead of accepting one from the client', async () => {
    // First lookup (by username) is taken, forcing the counter suffix; the
    // duplicate-email check above it must have already resolved null for
    // this call to even be reached.
    prisma.users.findUnique
      .mockResolvedValueOnce(null) // email not taken
      .mockResolvedValueOnce({ id: 1n }) // 'ahmedmohamed' taken
      .mockResolvedValueOnce(null); // 'ahmedmohamed1' available

    await service.processRegistration(validPayload, 'flow-token', (service as any).signature, res);

    expect(tx.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ username: 'ahmedmohamed1' }),
      }),
    );
  });
});
/**
 * The login/2FA/device-verify/email-OTP success response is AUTHORITATIVE:
 * the frontend seeds its auth cache straight from it. If it omits
 * `email_verified_at`, a freshly-logged-in VERIFIED account momentarily
 * looks unverified to the client and gets bounced to `/verify-email`
 * (AUTH_STATE_AND_EARLY_STORE_AUTHZ_FINAL_REPORT.md). It must therefore
 * carry the same verification/profile facts `sanitizeUser` returns.
 */
describe('AuthService.generateAuthResponse — authoritative user payload', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    })
      .useMocker(mocker)
      .compile();
    service = module.get<AuthService>(AuthService);
    (service as unknown as { jwtService: unknown }).jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    };
    (service as unknown as { prisma: unknown }).prisma = {
      devices: { findFirst: jest.fn().mockResolvedValue(null) },
      users: { update: jest.fn().mockResolvedValue({}) },
    };
  });

  const run = (user: Record<string, unknown>) =>
    service.generateAuthResponse(
      user as never,
      'fingerprint',
      'ua',
      { cookie: jest.fn() } as never,
    );

  it('includes email_verified_at (verified account → timestamp preserved)', async () => {
    const ts = new Date('2026-01-02T03:04:05.000Z');
    const res: any = await run({
      id: 7n, email: 'v@example.com', username: 'v',
      two_factor_enabled: false, email_verified_at: ts,
      accounttype: 'individual', password: 'hash',
    });
    expect(res.authenticated).toBe(true);
    expect(res.user).toHaveProperty('email_verified_at', ts);
    expect(res.user).toHaveProperty('accounttype', 'individual');
    expect(res.user).toHaveProperty('has_password', true);
  });

  it('includes email_verified_at as null for a genuinely unverified account (never absent)', async () => {
    const res: any = await run({
      id: 8n, email: 'u@example.com', username: 'u',
      two_factor_enabled: false, email_verified_at: null, password: null,
    });
    expect(res.user).toHaveProperty('email_verified_at', null);
    expect('email_verified_at' in res.user).toBe(true);
    expect(res.user.has_password).toBe(false);
  });
});
