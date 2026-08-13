// src/uploads/uploads.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsCleanupCron } from './uploads-cleanup.cron';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsCleanupCron],
})
export class UploadsModule {}