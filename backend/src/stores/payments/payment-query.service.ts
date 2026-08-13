import { Injectable, NotFoundException } from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { LedgerService } from '../../ledger/ledger.service'
import { money, toDecimalString } from '../../common/money/money.util'

/**
 * ==================================================================
 * Merchant payment read surface
 * ==================================================================
 *
 * Read-only. Every query is scoped by store_id from the guard, never
 * from the request body.
 *
 * Two views:
 *   - summary: what the store is owed and what it has collected
 *   - order detail: the full payment trail behind one order
 *
 * Amounts are returned both as minor units (exact, for clients that do
 * arithmetic) and as a formatted decimal string (for display).
 */
@Injectable()
export class PaymentQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Money position for a store: outstanding receivables, cash collected,
   * recognised revenue, per currency.
   *
   * Balances are derived from ledger postings, never from a stored
   * column, so they cannot drift from the journal.
   */
  async summary(storeId: bigint, mode: Mode = 'live') {
    const balances = await this.ledger.summary(storeId, mode)

    const [unpaidOrders, openIntents, deadLetters] = await Promise.all([
      this.prisma.guarded().order.count({
        where: { store_id: storeId, payment_status: 'UNPAID' },
      }),
      this.prisma.guarded().paymentIntent.count({
        where: {
          store_id: storeId,
          mode,
          status: { notIn: ['captured', 'refunded', 'failed', 'cancelled', 'expired'] },
        },
      }),
      this.prisma.guarded().outboxMessage.count({
        where: { store_id: storeId, mode, status: 'dead' },
      }),
    ])

    return {
      mode,
      balances: balances.map((balance) => ({
        currency: balance.currency,
        account_type: balance.accountType,
        amount_minor: balance.balanceMinor.toString(),
        amount: this.format(balance.balanceMinor, balance.currency),
      })),
      counts: {
        unpaid_orders: unpaidOrders,
        open_intents: openIntents,
        // Non-zero here means an event was never delivered downstream.
        dead_letters: deadLetters,
      },
    }
  }

  /**
   * Full payment trail for one order: intent, attempts, captures and the
   * audit events, plus the journal entries that moved money.
   */
  async orderPayment(storeId: bigint, orderId: string, mode: Mode = 'live') {
    const order = await this.prisma.guarded().order.findFirst({
      where: { id: BigInt(orderId), store_id: storeId },
      select: {
        id: true,
        order_number: true,
        status: true,
        payment_status: true,
        payment_method: true,
        currency: true,
        total: true,
        paid_at: true,
        checkout_id: true,
        created_at: true,
      },
    })

    if (!order) throw new NotFoundException('Order not found.')

    const base = {
      order: {
        id: order.id.toString(),
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        currency: order.currency,
        total: String(order.total),
        paid_at: order.paid_at,
        created_at: order.created_at,
      },
    }

    // Orders created before checkout existed have no payment trail.
    if (order.checkout_id === null) {
      return {
        ...base,
        intent: null,
        attempts: [],
        captures: [],
        events: [],
        journal_entries: [],
      }
    }

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: storeId,
        mode,
        context_kind: 'checkout',
        context_id: order.checkout_id.toString(),
      },
    })

    if (!intent) {
      return {
        ...base,
        intent: null,
        attempts: [],
        captures: [],
        events: [],
        journal_entries: [],
      }
    }

    const [attempts, captures, events, entries] = await Promise.all([
      this.prisma.guarded().paymentAttempt.findMany({
        where: { intent_id: intent.id, store_id: storeId },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.guarded().capture.findMany({
        where: { intent_id: intent.id, store_id: storeId },
        orderBy: { id: 'asc' },
      }),
      this.prisma.guarded().paymentEvent.findMany({
        where: { intent_id: intent.id, store_id: storeId },
        orderBy: { recorded_at: 'asc' },
      }),
      this.prisma.guarded().journalEntry.findMany({
        where: { store_id: storeId, mode, source_kind: 'order', source_id: order.id.toString() },
        orderBy: { id: 'asc' },
      }),
    ])

    return {
      ...base,
      intent: {
        id: intent.id.toString(),
        status: intent.status,
        currency: intent.currency,
        amount_minor: intent.amount_minor.toString(),
        amount: this.format(intent.amount_minor, intent.currency),
        captured_total_minor: intent.captured_total_minor.toString(),
        refunded_total_minor: intent.refunded_total_minor.toString(),
        capture_method: intent.capture_method,
        created_at: intent.created_at,
        terminal_at: intent.terminal_at,
      },
      attempts: attempts.map((attempt) => ({
        id: attempt.id.toString(),
        sequence: attempt.sequence,
        status: attempt.status,
        next_action_kind: attempt.next_action_kind,
        // The payload can carry merchant bank details; the merchant owns
        // them, so it is safe here and only here.
        next_action_payload: attempt.next_action_payload ?? null,
        error_code: attempt.error_code,
        created_at: attempt.created_at,
      })),
      captures: captures.map((capture) => ({
        id: capture.id.toString(),
        status: capture.status,
        currency: capture.currency,
        amount_minor: capture.amount_minor.toString(),
        amount: this.format(capture.amount_minor, capture.currency),
        reference: capture.gateway_capture_ref,
        captured_at: capture.captured_at,
      })),
      events: events.map((event) => ({
        id: event.id.toString(),
        event_type: event.event_type,
        source: event.source,
        applied: event.applied,
        superseded_reason: event.superseded_reason,
        occurred_at: event.occurred_at,
        recorded_at: event.recorded_at,
      })),
      journal_entries: entries.map((entry) => ({
        id: entry.id.toString(),
        entry_type: entry.entry_type,
        currency: entry.currency,
        occurred_at: entry.occurred_at,
        memo: entry.memo,
      })),
    }
  }

  /** Formats minor units for display, tolerating an unknown currency. */
  private format(amountMinor: bigint, currency: string): string {
    try {
      return toDecimalString(money(amountMinor, currency))
    } catch {
      return amountMinor.toString()
    }
  }
}