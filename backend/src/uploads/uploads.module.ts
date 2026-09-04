// src/uploads/uploads.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsCleanupCron } from './uploads-cleanup.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { ActiveStoreModule } from '../stores/active-store.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, ActiveStoreModule],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsCleanupCron],
})
export class UploadsModule {}