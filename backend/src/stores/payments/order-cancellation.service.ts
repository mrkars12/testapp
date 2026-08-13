import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Mode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { canTransitionIntent } from './payment-intent.state';

/**
 * ==================================================================
 * Cancelling an unpaid order
 * ==================================================================
 *
 * Closes two leaks that commitment opens:
 *
 *  1. The receivable. Committing a cash-on-delivery order recognises
 *     revenue and opens offline_receivable. If the order is cancelled
 *     and nothing reverses that entry, the store is shown as owed money
 *     it will never receive, forever.
 *
 *  2. The stock. Commitment decrements inventory. Cancelling without
 *     restocking silently destroys sellable units.
 *
 * A paid order is rejected: unwinding money that was actually collected
 * is a refund, which needs a Refund model and is out of scope here.
 */
@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async cancelOrder(
    storeId: bigint,
    orderId: string,
    options: {
      mode?: Mode;
      reason?: string;
      restock?: boolean;
    } = {},
  ) {
    const mode: Mode = options.mode ?? 'live';
    const restock = options.restock ?? true;

    const order = await this.prisma.guarded().order.findFirst({
      where: {
        id: BigInt(orderId),
        store_id: storeId,
      },
      include: {
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    if (order.status === 'CANCELLED') {
      throw new ConflictException('Order is already cancelled.');
    }

    if (order.payment_status === 'PAID') {
      throw new BadRequestException(
        'A paid order cannot be cancelled here. Refunds are not supported yet.',
      );
    }

    if (order.checkout_id === null) {
      throw new BadRequestException(
        'This order was not created through checkout and has no ledger entry to reverse.',
      );
    }

    const checkoutId = order.checkout_id;

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: storeId,
        mode,
        context_kind: 'checkout',
        context_id: checkoutId.toString(),
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (intent && !canTransitionIntent(intent.status, 'cancelled')) {
      throw new ConflictException(
        `Payment is ${intent.status} and can no longer be cancelled.`,
      );
    }

    // The entry opened at commitment. Its absence means nothing to reverse.
    const commitmentEntry = await this.prisma.guarded().journalEntry.findFirst({
      where: {
        dedupe_key: `checkout:${checkoutId}:commit`,
        store_id: storeId,
        mode,
      },
      select: {
        id: true,
      },
    });

    const now = new Date();

    const result = await this.prisma.guarded().$transaction(async (tx) => {
      // Compare-and-set claim: only one caller can move the order out of
      // its current status, so restock and reversal happen exactly once.
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          store_id: storeId,
          status: {
            not: 'CANCELLED',
          },
          payment_status: 'UNPAID',
        },
        data: {
          status: 'CANCELLED',
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'Order was cancelled or paid by another request.',
        );
      }

      let restocked = 0;

      if (restock) {
        for (const item of order.items) {
          if (item.variant_id === null) {
            continue;
          }

          /**
           * ProductVariant does not have its own store_id.
           * Ownership therefore comes through Product.store_id.
           *
           * The relation predicate prevents a variant belonging to
           * another store from being selected for a restock operation.
           */
          const variant = await tx.productVariant.findFirst({
            where: {
              id: item.variant_id,
              product: {
                store_id: storeId,
              },
            },
            select: {
              id: true,
              track_inventory: true,
            },
          });

          if (!variant || !variant.track_inventory) {
            continue;
          }

          await tx.productVariant.update({
            where: {
              id: variant.id,
            },
            data: {
              inventory_qty: {
                increment: item.qty,
              },
            },
          });

          restocked += 1;
        }
      }

      await tx.inventoryReservation.updateMany({
        where: {
          checkout_id: checkoutId,
          store_id: storeId,
          mode,
        },
        data: {
          state: 'released',
          settled_at: now,
        },
      });

      await tx.checkout.updateMany({
        where: {
          id: checkoutId,
          store_id: storeId,
          mode,
        },
        data: {
          status: 'failed',
        },
      });

      if (intent) {
        await tx.paymentIntent.update({
          where: {
            id: intent.id,
            store_id: storeId,
            mode,
          },
          data: {
            status: 'cancelled',
            terminal_at: now,
            version: {
              increment: 1,
            },
          },
        });

        await tx.paymentAttempt.updateMany({
          where: {
            intent_id: intent.id,
            store_id: storeId,
            mode,
            status: {
              notIn: ['succeeded', 'failed', 'cancelled'],
            },
          },
          data: {
            status: 'cancelled',
            next_action_kind: 'none',
          },
        });

        await tx.paymentEvent.create({
          data: {
            intent_id: intent.id,
            store_id: storeId,
            mode,
            event_type: 'payment.cancelled',
            dedupe_key: `intent:${intent.id}:cancelled`,
            source: 'merchant',
            applied: true,
            payload_redacted: {
              orderId: order.id.toString(),
              reason: options.reason ?? null,
              restocked,
            } as Prisma.InputJsonValue,
            occurred_at: now,
          },
        });
      }

      // Reversal, not deletion: the journal stays immutable.
      if (commitmentEntry) {
        await this.ledger.reverse(
          tx as unknown as Prisma.TransactionClient,
          commitmentEntry.id,
          `checkout:${checkoutId}:commit:reversed`,
          `Cancellation of order ${order.order_number}`,
        );
      }

      await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
        storeId,
        mode,
        aggregateType: 'order',
        aggregateId: order.id.toString(),
        eventType: 'order.cancelled',
        payload: {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          checkoutId: checkoutId.toString(),
          intentId: intent ? intent.id.toString() : null,
          restockedLines: restocked,
          reason: options.reason ?? null,
        },
        occurredAt: now,
      });

      const saved = await tx.order.findFirstOrThrow({
        where: {
          id: order.id,
          store_id: storeId,
        },
        select: {
          id: true,
          order_number: true,
          status: true,
          payment_status: true,
        },
      });

      return {
        saved,
        restocked,
      };
    });

    this.logger.log(
      `Order cancelled: store ${storeId} order ${result.saved.order_number} (${result.restocked} lines restocked)`,
    );

    return {
      id: result.saved.id.toString(),
      order_number: result.saved.order_number,
      status: result.saved.status,
      payment_status: result.saved.payment_status,
      restocked_lines: result.restocked,
    };
  }
}
