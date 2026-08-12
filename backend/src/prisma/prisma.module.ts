import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EventEmitterModule } from '@nestjs/event-emitter'

@Global()
@Module({
  imports: [EventEmitterModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}