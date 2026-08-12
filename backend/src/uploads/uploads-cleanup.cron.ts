// src/uploads/uploads-cleanup.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from './uploads.service';

@Injectable()
export class UploadsCleanupCron {
  private readonly logger = new Logger(UploadsCleanupCron.name);

  constructor(private prisma: PrismaService, private uploadsService: UploadsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOrphaned() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const orphaned = await this.prisma.upload.findMany({
      where: { status: 'pending', created_at: { lt: oneHourAgo } },
    });

    const client = this.uploadsService.getS3Client();
    for (const u of orphaned) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: u.key }));
        await this.prisma.upload.delete({ where: { id: u.id } });
      } catch (err) {
        this.logger.error(`فشل حذف ${u.key}: ${err}`);
      }
    }
    if (orphaned.length) this.logger.log(`تم تنظيف ${orphaned.length} ملف يتيم`);
  }
}