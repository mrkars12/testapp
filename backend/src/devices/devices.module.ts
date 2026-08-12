import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller'; // تأكد من اسم الملف لديك
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule }
from '../realtime/realtime.module'

@Module({

  imports: [

    RealtimeModule
  ],

  controllers: [

    DevicesController
  ]
})
export class DevicesModule {}