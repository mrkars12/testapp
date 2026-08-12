import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';

/**
 * الكونترولر بيعتمد على AuthService اللي بقى محتاج ConfigService،
 * فحل الاعتماديات كان بيفشل.
 *
 * useMocker بيعمل بديل تلقائي لأي اعتماد بيطلبه الكونترولر، من غير ما
 * الاختبار يحتاج يعرف شكل الـ constructor.
 */

const autoMock = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, prop) => {
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

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
    })
      .useMocker(mocker)
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});