import type { LedgerAccountType, PostingDirection } from '@prisma/client'
import { LedgerError, PostingInput } from './ledger.types'

const debit = (
  accountType: LedgerAccountType,
  amountMinor: bigint,
  extra: Partial<PostingInput> = {},
): PostingInput => ({ accountType, direction: 'debit' as PostingDirection, amountMinor, ...extra })

const credit = (
  accountType: LedgerAccountType,
  amountMinor: bigint,
  extra: Partial<PostingInput> = {},
): PostingInput => ({ accountType, direction: 'credit' as PostingDirection, amountMinor, ...extra })

export interface AllocationLine {
  readonly beneficiaryId: bigint
  readonly amountMinor: bigint
}

function assertPositive(amountMinor: bigint, label: string): void {
  if (amountMinor <= 0n) throw new LedgerError(`${label} لازم يكون أكبر من صفر (استلمنا: ${amountMinor}).`)
}

function assertAllocationsMatch(allocations: readonly AllocationLine[], total: bigint): void {
  if (allocations.length === 0) throw new LedgerError('لازم مستفيد واحد على الأقل.')
  const sum = allocations.reduce((acc, a) => acc + a.amountMinor, 0n)
  if (sum !== total) throw new LedgerError(`مجموع توزيع المستفيدين (${sum}) مش مساوي للمبلغ (${total}).`)
}

export function captureSucceeded(input: {
  totalMinor: bigint; paymentAccountId: bigint; allocations: readonly AllocationLine[]
}): PostingInput[] {
  assertPositive(input.totalMinor, 'مبلغ التحصيل')
  assertAllocationsMatch(input.allocations, input.totalMinor)
  return [
    debit('psp_receivable', input.totalMinor, { paymentAccountId: input.paymentAccountId }),
    ...input.allocations.map((a) => credit('sales_revenue', a.amountMinor, { beneficiaryId: a.beneficiaryId })),
  ]
}

export function offlineCommitment(input: {
  totalMinor: bigint; allocations: readonly AllocationLine[]
}): PostingInput[] {
  assertPositive(input.totalMinor, 'مبلغ الالتزام')
  assertAllocationsMatch(input.allocations, input.totalMinor)
  return [
    debit('offline_receivable', input.totalMinor),
    ...input.allocations.map((a) => credit('sales_revenue', a.amountMinor, { beneficiaryId: a.beneficiaryId })),
  ]
}

export function offlineCollected(input: { totalMinor: bigint }): PostingInput[] {
  assertPositive(input.totalMinor, 'المبلغ المُحصَّل')
  return [debit('cash_collected', input.totalMinor), credit('offline_receivable', input.totalMinor)]
}

export function platformFee(input: { amountMinor: bigint; platformBeneficiaryId: bigint }): PostingInput[] {
  assertPositive(input.amountMinor, 'عمولة المنصة')
  return [
    debit('platform_fee_expense', input.amountMinor),
    credit('platform_fee_payable', input.amountMinor, { beneficiaryId: input.platformBeneficiaryId }),
  ]
}

/**
 * Refund of money captured through a gateway.
 *
 *   debit  refunds_contra   (per beneficiary, proportional to the capture)
 *   credit psp_receivable   (the account that took the payment)
 *
 * refunds_contra rather than reversing sales_revenue: the original sale
 * happened and stays on the books. Netting it away would make revenue
 * and refunds indistinguishable in any report.
 *
 * ⚠️ This rule is for MERCHANT_GATEWAY only. Other payment modes settle
 * through different accounts and must supply their own rule rather than
 * reusing this one.
 */
export function refundIssued(input: {
  totalMinor: bigint
  paymentAccountId: bigint
  allocations: readonly AllocationLine[]
}): PostingInput[] {
  assertPositive(input.totalMinor, 'مبلغ الاسترداد')
  assertAllocationsMatch(input.allocations, input.totalMinor)

  return [
    ...input.allocations.map((a) =>
      debit('refunds_contra', a.amountMinor, { beneficiaryId: a.beneficiaryId }),
    ),
    credit('psp_receivable', input.totalMinor, {
      paymentAccountId: input.paymentAccountId,
    }),
  ]
}

/**
 * Refund of money that never went through a gateway.
 *
 *   debit  refunds_contra
 *   credit cash_collected | offline_receivable
 *
 * Which credit leg depends on whether the merchant had actually
 * collected the cash yet, so the caller decides from the order's
 * payment status rather than this rule guessing.
 */
export function refundIssuedOffline(input: {
  totalMinor: bigint
  collected: boolean
  allocations: readonly AllocationLine[]
}): PostingInput[] {
  assertPositive(input.totalMinor, 'مبلغ الاسترداد')
  assertAllocationsMatch(input.allocations, input.totalMinor)

  return [
    ...input.allocations.map((a) =>
      debit('refunds_contra', a.amountMinor, { beneficiaryId: a.beneficiaryId }),
    ),
    credit(
      input.collected ? 'cash_collected' : 'offline_receivable',
      input.totalMinor,
    ),
  ]
}

export function pspFeeEstimated(input: { amountMinor: bigint; paymentAccountId: bigint }): PostingInput[] {
  assertPositive(input.amountMinor, 'رسوم البوابة')
  return [
    debit('psp_fee_expense', input.amountMinor),
    credit('psp_receivable', input.amountMinor, { paymentAccountId: input.paymentAccountId }),
  ]
}