import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { LedgerService } from './ledger.service'

/**
 * دفتر المدفوعات.
 *
 * مالوش سطح HTTP: الوحدات التانية بترحّل فيه جوه transaction بتاعتها.
 */
@Module({
  imports: [PrismaModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
