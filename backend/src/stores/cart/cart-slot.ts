import { Prisma } from '@prisma/client';
import type { Mode } from '@prisma/client';

/* ══════════════════════════════════════════════════════════════════════
   RELEASING AND CONVERTING THE CART SLOT.

   `Cart.active_checkout_id` is what stops a second tab creating a second
   checkout. That guarantee is only worth anything if the slot is
   reliably given back — a slot that leaks means a shopper whose card
   was declined can never retry, and a cart wedged for thirty days.

   So every one of these runs INSIDE the transaction that already
   changes the checkout's fate, never as a separate write that could be
   lost while the first one committed. They are plain functions taking a
   `Prisma.TransactionClient` rather than an injected service, precisely
   so they can join a transaction that another module owns without
   CheckoutModule and PaymentsModule having to import each other.

   All of them are no-ops for a checkout with no cart — which is every
   checkout that existed before this shipped, and every one created on
   the cookieless fallback path.
   ══════════════════════════════════════════════════════════════════════ */

/** The cart a checkout was priced from, or null. */
async function cartIdFor(
  tx: Prisma.TransactionClient,
  input: { checkoutId: bigint; storeId: bigint; mode: Mode },
): Promise<bigint | null> {
  const checkout = await tx.checkout.findFirst({
    where: {
      id: input.checkoutId,
      store_id: input.storeId,
      mode: input.mode,
    },
    select: { cart_id: true },
  });

  return checkout?.cart_id ?? null;
}

/**
 * Gives the slot back, leaving the cart ACTIVE.
 *
 * Runs when a checkout's payment will never complete: a decline, an
 * abandonment, an expiry, a cancelled order. The cart stays `active` on
 * purpose — that is exactly what makes "المحاولة مرة أخرى" work. The
 * retry creates a new checkout, claims the slot again, and records
 * `supersedes_id` pointing at its predecessor; `cart_id` is the same on
 * both, because it is the same basket.
 *
 * Scoped to the checkout that actually holds the slot, so a stale
 * release for an older attempt cannot take the slot away from the
 * successor that has since claimed it.
 */
export async function releaseCartSlot(
  tx: Prisma.TransactionClient,
  input: { checkoutId: bigint; storeId: bigint; mode: Mode },
): Promise<void> {
  const cartId = await cartIdFor(tx, input);
  if (cartId === null) return;

  await tx.$executeRaw`
    UPDATE carts
       SET active_checkout_id = NULL,
           claimed_until      = NULL,
           version            = version + 1
     WHERE id = ${cartId}
       AND store_id = ${input.storeId}
       AND mode::text = ${input.mode}
       AND active_checkout_id = ${input.checkoutId}
  `;
}

/**
 * The cart became an order. TERMINAL.
 *
 * Runs inside the very transaction that creates the Order, so there is
 * no window in which an order exists and its cart is still buyable. The
 * slot is cleared in the same statement: the cart is no longer waiting
 * on a checkout, it is finished.
 *
 * Guarded on `status = 'active'` so a redelivered capture — which
 * reaches the finalizer again with the order already created — cannot
 * rewrite `converted_at` or point `converted_order_id` somewhere new.
 */
export async function convertCartForCheckout(
  tx: Prisma.TransactionClient,
  input: {
    checkoutId: bigint;
    storeId: bigint;
    mode: Mode;
    orderId: bigint;
    occurredAt: Date;
  },
): Promise<void> {
  const cartId = await cartIdFor(tx, input);
  if (cartId === null) return;

  await tx.$executeRaw`
    UPDATE carts
       SET status             = 'converted',
           active_checkout_id = NULL,
           claimed_until      = NULL,
           converted_order_id = ${input.orderId},
           converted_at       = ${input.occurredAt},
           version            = version + 1
     WHERE id = ${cartId}
       AND store_id = ${input.storeId}
       AND mode::text = ${input.mode}
       AND status = 'active'
  `;
}
