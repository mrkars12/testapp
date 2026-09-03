// src/uploads/uploads.service.ts
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/jpg',
  'video/mp4',
];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

@Injectable()
export class UploadsService {
  /**
   * FIX: @aws-sdk/client-s3 (v3.729.0+) enables "flexible checksums" by
   * default — it silently adds x-amz-checksum-crc32 / x-amz-sdk-checksum-
   * algorithm to presigned PutObject URLs. R2 doesn't implement this
   * feature, so browsers uploading to these URLs get rejected (surfaces as
   * a CORS failure, or a 501 "NotImplemented" for that header). Setting
   * requestChecksumCalculation to WHEN_REQUIRED restores the old behavior
   * (no checksum unless explicitly requested), which R2 is compatible with.
   * See: https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637
   */
  private client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  constructor(private prisma: PrismaService) {}

  async presign(
    storeId: bigint,
    body: {
      fileName: string;
      mimeType: string;
      size: number;
      folder: 'products' | 'variants';
    },
  ) {
    if (!ALLOWED_MIME.includes(body.mimeType)) {
      throw new BadRequestException(
        'نوع الملف غير مسموح به. المسموح: png, jpg, mp4',
      );
    }

    const isVideo = body.mimeType === 'video/mp4';
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

    if (body.size > maxSize) {
      throw new BadRequestException(
        `حجم الملف أكبر من المسموح (${isVideo ? '50' : '10'} ميجا)`,
      );
    }

    const ext = (body.fileName.split('.').pop() || 'jpg').toLowerCase();

    const key = `${storeId}/${body.folder}/${randomUUID()}.${ext}`;
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: body.mimeType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 300,
    });

    await this.prisma.guarded().upload.create({
      data: {
        key,
        url: publicUrl,
        mime_type: body.mimeType,
        size: body.size,
        store_id: storeId,
        status: 'pending',
      },
    });

    return {
      uploadUrl,
      key,
      publicUrl,
    };
  }

  async confirm(
    storeId: bigint,
    key: string,
    attachedType?: string,
    attachedId?: string,
  ) {
    const upload = await this.prisma.guarded().upload.findFirst({
      where: {
        key,
        store_id: storeId,
      },
    });

    if (!upload) {
      throw new UnauthorizedException('ملف غير موجود أو غير مصرح به');
    }

    const result = await this.prisma.guarded().upload.updateMany({
      where: {
        key,
        store_id: storeId,
      },
      data: {
        status: 'attached',
        attached_type: attachedType,
        attached_id: attachedId ? BigInt(attachedId) : null,
      },
    });

    if (result.count !== 1) {
      throw new UnauthorizedException('ملف غير موجود أو غير مصرح به');
    }

    return { success: true };
  }

  async remove(storeId: bigint, key: string) {
    const upload = await this.prisma.guarded().upload.findFirst({
      where: {
        key,
        store_id: storeId,
      },
    });

    if (!upload) {
      throw new UnauthorizedException('غير مصرح لك بحذف هذا الملف');
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
    );

    const result = await this.prisma.guarded().upload.deleteMany({
      where: {
        key,
        store_id: storeId,
      },
    });

    if (result.count !== 1) {
      throw new UnauthorizedException('غير مصرح لك بحذف هذا الملف');
    }

    return { success: true };
  }

  // بيستخدمها الـ cron job
  getS3Client() {
    return this.client;
  }
}
