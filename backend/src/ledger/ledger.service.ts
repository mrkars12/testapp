import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { LedgerAccountType, Mode, PostingDirection } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../common/idempotency/idempotency.types'
import { JournalEntryInput, LedgerError, PostResult, PostingInput } from './ledger.types'

/**
 * Row shapes for the raw queries below.
 *
 * Declared as named types on purpose: an inline generic immediately
 * followed by a template literal produces the `>` + backtick sequence,
 * which is fragile to copy and hard to read.
 */
interface DirectionTotalRow {
  direction: PostingDirection
  total: bigint | null
}

interface EntryIdRow {
  entry_id: bigint
}

interface AccountBalanceRow {
  currency: string
  account_type: LedgerAccountType
  balance: bigint
}

/** One ledger account's derived balance. */
export interface LedgerBalance {
  currency: string
  accountType: LedgerAccountType
  balanceMinor: bigint
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name)
  constructor(private readonly prisma: PrismaService) {}

  async post(tx: Prisma.TransactionClient, input: JournalEntryInput): Promise<PostResult> {
    this.validate(input)
    const existing = await tx.journalEntry.findFirst({ where: { dedupe_key: input.dedupeKey }, select: { id: true } })
    if (existing) return { entryId: existing.id, duplicate: true }
    const accountIds = await this.resolveAccounts(tx, input)
    try {
      const entry = await tx.journalEntry.create({
        data: {
          store_id: input.storeId, mode: input.mode, currency: input.currency,
          entry_type: input.entryType, source_kind: input.sourceKind, source_id: input.sourceId,
          dedupe_key: input.dedupeKey, occurred_at: input.occurredAt, memo: input.memo ?? null,
        },
        select: { id: true },
      })
      await tx.ledgerPosting.createMany({
        data: input.postings.map((posting, index) => ({
          entry_id: entry.id, ledger_account_id: accountIds[index],
          direction: posting.direction, amount_minor: posting.amountMinor,
        })),
      })
      return { entryId: entry.id, duplicate: false }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await tx.journalEntry.findFirstOrThrow({ where: { dedupe_key: input.dedupeKey }, select: { id: true } })
        return { entryId: raced.id, duplicate: true }
      }
      throw error
    }
  }

  async reverse(tx: Prisma.TransactionClient, entryId: bigint, dedupeKey: string, memo?: string): Promise<PostResult> {
    const original = await tx.journalEntry.findFirstOrThrow({ where: { id: entryId }, include: { postings: true } })
    const existing = await tx.journalEntry.findFirst({ where: { dedupe_key: dedupeKey }, select: { id: true } })
    if (existing) return { entryId: existing.id, duplicate: true }
    const reversal = await tx.journalEntry.create({
      data: {
        store_id: original.store_id, mode: original.mode, currency: original.currency,
        entry_type: `${original.entry_type}.reversal`, source_kind: original.source_kind,
        source_id: original.source_id, dedupe_key: dedupeKey, occurred_at: new Date(),
        reverses_entry_id: original.id, memo: memo ?? `Reversal of entry ${original.id}`,
      },
      select: { id: true },
    })
    await tx.ledgerPosting.createMany({
      data: original.postings.map((posting) => ({
        entry_id: reversal.id, ledger_account_id: posting.ledger_account_id,
        direction: (posting.direction === 'debit' ? 'credit' : 'debit') as PostingDirection,
        amount_minor: posting.amount_minor,
      })),
    })
    return { entryId: reversal.id, duplicate: false }
  }

  async balance(params: {
    storeId: bigint; mode: Mode; currency: string; accountType: LedgerAccountType
    beneficiaryId?: bigint | null; paymentAccountId?: bigint | null
  }): Promise<bigint> {
    const account = await this.prisma.guarded().ledgerAccount.findFirst({
      where: {
        store_id: params.storeId, mode: params.mode, currency: params.currency,
        account_type: params.accountType,
        beneficiary_id: params.beneficiaryId ?? null,
        payment_account_id: params.paymentAccountId ?? null,
      },
      select: { id: true },
    })
    if (!account) return 0n
    const rows = await this.prisma.$queryRaw<DirectionTotalRow[]>`
      SELECT direction, SUM(amount_minor) AS total
      FROM ledger_postings WHERE ledger_account_id = ${account.id} GROUP BY direction
    `
    let balance = 0n
    for (const row of rows) {
      const total = row.total === null ? 0n : BigInt(row.total)
      balance += row.direction === 'debit' ? total : -total
    }
    return balance
  }

  /**
   * All non-zero balances for a store, grouped by currency and account
   * type.
   *
   * Additive read path for the merchant dashboard; posting behaviour is
   * unchanged. The ::bigint cast keeps the declared type honest, since
   * SUM() over a bigint column returns numeric.
   */
  async summary(storeId: bigint, mode: Mode): Promise<LedgerBalance[]> {
    const rows = await this.prisma.$queryRaw<AccountBalanceRow[]>`
      SELECT la.currency,
             la.account_type,
             SUM(
               CASE WHEN lp.direction = 'debit'
                    THEN lp.amount_minor
                    ELSE -lp.amount_minor
               END
             )::bigint AS balance
      FROM ledger_accounts la
      JOIN ledger_postings lp ON lp.ledger_account_id = la.id
      WHERE la.store_id = ${storeId}
        AND la.mode::text = ${mode}
      GROUP BY la.currency, la.account_type
      ORDER BY la.currency ASC, la.account_type ASC
    `

    return rows
      .map((row) => ({
        currency: row.currency,
        accountType: row.account_type,
        balanceMinor: BigInt(row.balance),
      }))
      .filter((row) => row.balanceMinor !== 0n)
  }

  async findUnbalancedEntries(limit = 50): Promise<bigint[]> {
    const rows = await this.prisma.$queryRaw<EntryIdRow[]>`
      SELECT entry_id FROM ledger_postings GROUP BY entry_id
      HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)
          <> SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)
      LIMIT ${limit}
    `
    return rows.map((row) => BigInt(row.entry_id))
  }

  private validate(input: JournalEntryInput): void {
    if (input.postings.length < 2) {
      throw new LedgerError('A journal entry needs at least two postings.')
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new LedgerError(`Invalid currency code: "${input.currency}".`)
    }
    let debits = 0n, credits = 0n
    for (const posting of input.postings) {
      if (posting.amountMinor <= 0n) {
        throw new LedgerError(
          `Posting amount must be positive (direction carries the sign). Received: ${posting.amountMinor}.`,
        )
      }
      if (posting.direction === 'debit') debits += posting.amountMinor
      else credits += posting.amountMinor
    }
    if (debits !== credits) {
      throw new LedgerError(
        `Unbalanced journal entry: debits ${debits} vs credits ${credits}.`,
      )
    }
  }

  private async resolveAccounts(tx: Prisma.TransactionClient, input: JournalEntryInput): Promise<bigint[]> {
    const lockKey = `ledger:${input.storeId}:${input.mode}:${input.currency}`
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
    // Prisma has no deserializer for that type, so $queryRaw fails with
    // "Failed to deserialize column of type 'void'". Nothing reads the
    // result here — the statement is executed purely for the lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    const ids: bigint[] = []
    for (const posting of input.postings) ids.push(await this.resolveAccount(tx, input, posting))
    return ids
  }

  private async resolveAccount(
    tx: Prisma.TransactionClient, input: JournalEntryInput, posting: PostingInput,
  ): Promise<bigint> {
    const where = {
      store_id: input.storeId, mode: input.mode, currency: input.currency,
      account_type: posting.accountType,
      beneficiary_id: posting.beneficiaryId ?? null,
      payment_account_id: posting.paymentAccountId ?? null,
    }
    const existing = await tx.ledgerAccount.findFirst({ where, select: { id: true } })
    if (existing) return existing.id
    const created = await tx.ledgerAccount.create({ data: where, select: { id: true } })
    this.logger.log(
      `Ledger account created: ${posting.accountType} / ${input.currency} / store ${input.storeId} / ${input.mode}`,
    )
    return created.id
  }
}