import type { LedgerAccountType, Mode, PostingDirection } from '@prisma/client'

/** طرف واحد في قيد محاسبي */
export interface PostingInput {
  readonly accountType: LedgerAccountType
  readonly direction: PostingDirection
  /** دايماً موجب — الاتجاه في direction */
  readonly amountMinor: bigint
  readonly beneficiaryId?: bigint | null
  readonly paymentAccountId?: bigint | null
}

export interface JournalEntryInput {
  readonly storeId: bigint
  readonly mode: Mode
  /** عملة واحدة للقيد كله */
  readonly currency: string
  readonly entryType: string
  readonly sourceKind: string
  readonly sourceId: string
  /**
   * مشتق من المحتوى مش من وسيلة النقل. نفس الحقيقة الجاية من webhook
   * أو مطابقة أو رجوع العميل بتدي نفس المفتاح، فالترحيل بيبقى idempotent.
   */
  readonly dedupeKey: string
  readonly occurredAt: Date
  readonly memo?: string
  readonly postings: readonly PostingInput[]
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerError'
    Object.setPrototypeOf(this, LedgerError.prototype)
  }
}

/** نتيجة الترحيل. duplicate = القيد كان مرحّل قبل كده ومحصلش حاجة. */
export interface PostResult {
  readonly entryId: bigint
  readonly duplicate: boolean
}