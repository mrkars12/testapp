import type { Prisma } from '@prisma/client';

/**
 * Next per-store order number.
 *
 * The unique constraint on (store_id, order_number) is the real
 * guarantee; this only picks a starting point.
 *
 * Was `count(*) + 1001` at two call sites — the offline checkout commit
 * and the funds-secured finalizer — and two concurrent finalisations
 * both read the same count. The unique constraint then rejected one of
 * them outright, so a paid customer's order failed rather than simply
 * taking the next number.
 *
 * A row lock on the store serialises the read within the transaction.
 * Same visible format, no schema change, and the unique constraint
 * remains the real guarantee. Shared by both callers so the offline and
 * funds-secured paths cannot diverge onto two different algorithms
 * again.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  storeId: bigint,
): Promise<string> {
  await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`;

  const highest = await tx.order.findFirst({
    where: { store_id: storeId },
    orderBy: { id: 'desc' },
    select: { order_number: true },
  });

  const previous = highest ? Number.parseInt(highest.order_number, 10) : NaN;

  return String(Number.isFinite(previous) ? previous + 1 : 1001);
}
