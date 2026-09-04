import { PrismaClient } from '@prisma/client';
import { UploadsService } from './uploads.service';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../test/db-test-harness';

const STORE = 1n;
const OTHER_STORE = 2n;

async function seedStores(prisma: PrismaClient): Promise<void> {
  for (const id of [STORE, OTHER_STORE]) {
    const user = await prisma.users.create({
      data: {
        id,
        username: `spec_upload_${id}`,
        email: `spec_upload_${id}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await prisma.store.create({
      data: {
        id,
        name: `Spec Upload Store ${id}`,
        slug: `spec-upload-store-${id}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
    });
  }
}

describe('UploadsService cross-store isolation (integration)', () => {
  let prisma: PrismaClient;
  let service: UploadsService;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    service = new UploadsService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await prisma.upload.deleteMany();
    await truncateTables(ALL_TEST_TABLES);
    await seedStores(prisma);
  });

  describe('confirm', () => {
    it('rejects confirming an upload owned by another store', async () => {
      const upload = await prisma.upload.create({
        data: {
          key: '2/products/foreign-image.jpg',
          url: 'https://example.test/2/products/foreign-image.jpg',
          mime_type: 'image/jpeg',
          size: 1024,
          store_id: OTHER_STORE,
          status: 'pending',
        },
      });

      await expect(
        service.confirm(STORE, upload.key, 'product', '123'),
      ).rejects.toThrow('ملف غير موجود أو غير مصرح به');

      const saved = await prisma.upload.findUniqueOrThrow({
        where: {
          id: upload.id,
        },
      });

      expect(saved.store_id).toBe(OTHER_STORE);
      expect(saved.status).toBe('pending');
      expect(saved.attached_type).toBeNull();
      expect(saved.attached_id).toBeNull();
    });

    it('confirms only an upload owned by the requested store', async () => {
      const upload = await prisma.upload.create({
        data: {
          key: '1/products/own-image.jpg',
          url: 'https://example.test/1/products/own-image.jpg',
          mime_type: 'image/jpeg',
          size: 1024,
          store_id: STORE,
          status: 'pending',
        },
      });

      const result = await service.confirm(STORE, upload.key, 'product', '123');

      expect(result).toEqual({ success: true });

      const saved = await prisma.upload.findUniqueOrThrow({
        where: {
          id: upload.id,
        },
      });

      expect(saved.store_id).toBe(STORE);
      expect(saved.status).toBe('attached');
      expect(saved.attached_type).toBe('product');
      expect(saved.attached_id).toBe(123n);
    });
  });

  describe('remove', () => {
    it('rejects removing an upload owned by another store before touching R2', async () => {
      const upload = await prisma.upload.create({
        data: {
          key: '2/products/foreign-delete.jpg',
          url: 'https://example.test/2/products/foreign-delete.jpg',
          mime_type: 'image/jpeg',
          size: 1024,
          store_id: OTHER_STORE,
          status: 'pending',
        },
      });

      const sendSpy = jest
        .spyOn(service.getS3Client(), 'send')
        .mockResolvedValue({} as never);

      await expect(service.remove(STORE, upload.key)).rejects.toThrow(
        'غير مصرح لك بحذف هذا الملف',
      );

      expect(sendSpy).not.toHaveBeenCalled();

      const saved = await prisma.upload.findUniqueOrThrow({
        where: {
          id: upload.id,
        },
      });

      expect(saved.store_id).toBe(OTHER_STORE);

      sendSpy.mockRestore();
    });

    it('removes only an upload owned by the requested store', async () => {
      const upload = await prisma.upload.create({
        data: {
          key: '1/products/own-delete.jpg',
          url: 'https://example.test/1/products/own-delete.jpg',
          mime_type: 'image/jpeg',
          size: 1024,
          store_id: STORE,
          status: 'pending',
        },
      });

      const sendSpy = jest
        .spyOn(service.getS3Client(), 'send')
        .mockResolvedValue({} as never);

      const result = await service.remove(STORE, upload.key);

      expect(result).toEqual({ success: true });
      expect(sendSpy).toHaveBeenCalledTimes(1);

      const saved = await prisma.upload.findUnique({
        where: {
          id: upload.id,
        },
      });

      expect(saved).toBeNull();

      sendSpy.mockRestore();
    });
  });
});
