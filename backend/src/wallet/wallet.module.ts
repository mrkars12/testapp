import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
})
export class WalletModule {}