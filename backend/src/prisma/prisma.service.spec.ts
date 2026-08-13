import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

/**
 * PrismaService بياخد EventEmitter2، وبقى بياخد كمان ConfigService و
 * TenantContextService (المرحلة 1a — حارس عزل المستأجرين).
 *
 * useMocker بيوفّر بدائل للتلاتة.
 *
 * ⚠️ compile() مش init(): init() بتشغّل onModuleInit اللي بتنادي
 * $connect()، وده كان هيحتاج قاعدة بيانات حقيقية.
 */

// PrismaClient بيقرأ DATABASE_URL وقت الإنشاء، و jest مابيحمّلش .env.
// قيمة وهمية كفاية لأننا مش بنتصل بأي قاعدة بيانات هنا.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://test:test@localhost:5432/test?schema=public';

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
    // الحارس بيقرأ مساحة 'tenant' — بنطفّيه في الاختبار
    return {
      get: jest.fn(() => ({ guardEnabled: false })),
      getOrThrow: jest.fn(() => ({ guardEnabled: false })),
    };
  }
  return autoMock();
};

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    })
      .useMocker(mocker)
      .compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});