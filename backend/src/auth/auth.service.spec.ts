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