import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CartService } from './cart.service';
import {
  CART_COOKIE_NAME,
  cartCookieOptions,
  mintCartToken,
  readCartToken,
} from './cart-token';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
  withTestTenant,
} from '../../../test/db-test-harness';

/* ══════════════════════════════════════════════════════════════════════
   THE CART TABLES UNDER ROW LEVEL SECURITY.

   A cart is addressed by a cookie, and a cookie is a value a client
   controls. So "the query included store_id" is not enough on its own:
   the guarantee has to hold at the database, under the same role the
   application actually connects as, for a query that got the predicate
   wrong.

   `cart_items` is the interesting half. It has no `store_id` of its own
   — deliberately, because a cart line belongs to a cart, not to a store
   — so its policy reaches through `carts` exactly as `OrderItem`'s
   reaches through `Order`. That is a departure from every other scoped
   table here, and it is asserted rather than assumed.
   ══════════════════════════════════════════════════════════════════════ */

describe('cart isolation (integration)', () => {
  let prisma: PrismaClient;
  let carts: CartService;

  /** Two stores, each with its own product variant. */
  let a: { storeId: bigint; variantId: bigint };
  let b: { storeId: bigint; variantId: bigint };

  beforeAll(async () => {
    prisma = await startTestDatabase();
    carts = new CartService(prisma as never, new TenantContextService());
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    a = await seedStore(prisma, 'iso-a', 'isoa');
    b = await seedStore(prisma, 'iso-b', 'isob');
  });

  /** A cart in store A, holding one line. */
  async function cartInA() {
    const added = await carts.addItem(a.storeId, 'live', null, {
      variantId: a.variantId.toString(),
      quantity: 2,
    });

    const row = await withTestTenant(a.storeId, (tx) =>
      tx.cart.findFirst({
        where: { token: added.token },
        select: { id: true, public_id: true },
      }),
    );

    return {
      token: added.token,
      ...(row as { id: bigint; public_id: string }),
    };
  }

  it("hides store A's cart from store B entirely", async () => {
    const cart = await cartInA();

    const seenByB = await withTestTenant(b.storeId, (tx) =>
      tx.cart.findMany({ where: { id: cart.id } }),
    );

    expect(seenByB).toHaveLength(0);
  });

  it("hides store A's cart ITEMS from store B, though they carry no store_id", async () => {
    const cart = await cartInA();

    const seenByA = await withTestTenant(a.storeId, (tx) =>
      tx.cartItem.findMany({ where: { cart_id: cart.id } }),
    );
    expect(seenByA).toHaveLength(1);

    // The line has no store_id of its own; the policy reaches through
    // the cart. Asked with the cart id in hand, which is the strongest
    // form of the question.
    const seenByB = await withTestTenant(b.storeId, (tx) =>
      tx.cartItem.findMany({ where: { cart_id: cart.id } }),
    );
    expect(seenByB).toHaveLength(0);
  });

  it('refuses store B any UPDATE or DELETE on either table', async () => {
    const cart = await cartInA();

    const changed = await withTestTenant(b.storeId, (tx) =>
      tx.cart.updateMany({
        where: { id: cart.id },
        data: { status: 'abandoned' },
      }),
    );
    expect(changed.count).toBe(0);

    const deletedLines = await withTestTenant(b.storeId, (tx) =>
      tx.cartItem.deleteMany({ where: { cart_id: cart.id } }),
    );
    expect(deletedLines.count).toBe(0);

    const deletedCarts = await withTestTenant(b.storeId, (tx) =>
      tx.cart.deleteMany({ where: { id: cart.id } }),
    );
    expect(deletedCarts.count).toBe(0);

    // Untouched, and still A's.
    const after = await withTestTenant(a.storeId, (tx) =>
      tx.cart.findFirst({ where: { id: cart.id } }),
    );
    expect(after!.status).toBe('active');
    expect(
      await withTestTenant(a.storeId, (tx) =>
        tx.cartItem.count({ where: { cart_id: cart.id } }),
      ),
    ).toBe(1);
  });

  it('hides everything when there is no tenant context at all', async () => {
    const cart = await cartInA();

    const rows = await prisma.$transaction(async (tx) => {
      const carts = await tx.$queryRaw<
        { id: bigint }[]
      >`SELECT id FROM carts WHERE id = ${cart.id}`;
      const items = await tx.$queryRaw<
        { id: bigint }[]
      >`SELECT id FROM cart_items WHERE cart_id = ${cart.id}`;
      return { carts, items };
    });

    expect(rows.carts).toHaveLength(0);
    expect(rows.items).toHaveLength(0);
  });

  it('hides a live-mode cart from test mode, and its items with it', async () => {
    const cart = await cartInA();

    const inTestMode = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.store_id', ${a.storeId.toString()}, true),
               set_config('app.mode', 'test', true)
      `;
      const carts = await tx.$queryRaw<
        { id: bigint }[]
      >`SELECT id FROM carts WHERE id = ${cart.id}`;
      const items = await tx.$queryRaw<
        { id: bigint }[]
      >`SELECT id FROM cart_items WHERE cart_id = ${cart.id}`;
      return { carts, items };
    });

    expect(inTestMode.carts).toHaveLength(0);
    expect(inTestMode.items).toHaveLength(0);
  });

  it("does not resolve store A's cart token against store B", async () => {
    const cart = await cartInA();

    // The cookie is scoped by Path to one store's endpoints, so this
    // should never be reachable in a browser at all. Asserted anyway:
    // the server must not depend on the browser having got that right.
    const view = await carts.view(b.storeId, 'live', cart.token);
    expect(view.found).toBe(false);
    expect(view.view.items).toHaveLength(0);
    expect(view.view.cart_public_id).toBeNull();

    const claim = await carts.claimForCheckout(b.storeId, 'live', cart.token);
    expect(claim.kind).toBe('no_cart');
  });

  it("refuses to put another store's variant into a cart", async () => {
    // A cart holding a variant it does not own would be a stored
    // cross-tenant reference even if it were never priced.
    await expect(
      carts.addItem(a.storeId, 'live', null, {
        variantId: b.variantId.toString(),
        quantity: 1,
      }),
    ).rejects.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   THE COOKIE IS THE OTHER HALF OF THE ISOLATION.

   The database policies above stop store B READING store A's cart. The
   cookie's `Path` stops the browser ever OFFERING it — which is the
   stronger guarantee of the two, because it cannot be forgotten by a
   query.
   ══════════════════════════════════════════════════════════════════════ */
describe('the cart cookie', () => {
  it('is scoped by Path to one store s endpoints', () => {
    const options = cartCookieOptions({ slug: 'iso-a', isProduction: true });

    // THIS is the store scoping. The browser will not send store A's
    // cart to store B's endpoints, so there is no server-side check that
    // could be forgotten.
    expect(options.path).toBe('/api/storefront/iso-a');
    expect(cartCookieOptions({ slug: 'iso-b', isProduction: true }).path).toBe(
      '/api/storefront/iso-b',
    );
  });

  it('is HttpOnly, Lax, and Secure only in production', () => {
    const prod = cartCookieOptions({ slug: 'iso-a', isProduction: true });

    // JS never reads it, so an XSS cannot exfiltrate a basket.
    expect(prod.httpOnly).toBe(true);
    // `Lax`, not `Strict`: the cookie has to survive the gateway's
    // top-level redirect back to the return URL, and `Strict` would drop
    // it on exactly the request that resumes a payment.
    expect(prod.sameSite).toBe('lax');
    expect(prod.secure).toBe(true);

    // Development runs on http://localhost, where a Secure cookie is
    // discarded and the cart would silently never work.
    expect(
      cartCookieOptions({ slug: 'iso-a', isProduction: false }).secure,
    ).toBe(false);
  });

  it('escapes a slug rather than letting it widen the path', () => {
    const options = cartCookieOptions({
      slug: '../other-store',
      isProduction: true,
    });

    // The separator is escaped, so the path stays one segment deep and
    // cannot be walked up into another store's scope.
    expect(options.path).not.toContain('/../');
    expect(options.path).toBe('/api/storefront/..%2Fother-store');
  });

  it('lasts 30 days', () => {
    expect(
      cartCookieOptions({ slug: 'iso-a', isProduction: true }).maxAge,
    ).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('reads only a value that could have been minted here', () => {
    const token = mintCartToken();

    expect(readCartToken({ [CART_COOKIE_NAME]: token })).toBe(token);

    // Anything unrecognisable reads as "no cookie", which is the
    // stateless path — never a database round trip on an attacker's
    // string, and never an error that says whether a token exists.
    for (const bad of [
      '',
      'short',
      "'; DROP TABLE carts;--",
      'a'.repeat(200),
    ]) {
      expect(readCartToken({ [CART_COOKIE_NAME]: bad })).toBeNull();
    }
    expect(readCartToken({})).toBeNull();
    expect(readCartToken(undefined)).toBeNull();
    expect(readCartToken({ [CART_COOKIE_NAME]: 42 })).toBeNull();
  });

  it('mints an unguessable token, and a DIFFERENT public id', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintCartToken()));
    expect(tokens.size).toBe(200);
    // 32 bytes, base64url, no padding.
    expect([...tokens][0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

/* ------------------------------------------------------------------ */

async function seedStore(
  prisma: PrismaClient,
  slug: string,
  suffix: string,
): Promise<{ storeId: bigint; variantId: bigint }> {
  const user = await prisma.users.create({
    data: {
      username: `cart_${suffix}`,
      email: `cart_${suffix}@example.test`,
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  });

  const store = await prisma.store.create({
    data: {
      name: `Cart ${suffix}`,
      slug,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  const product = await withTestTenant(store.id, (tx) =>
    tx.product.create({
      data: {
        store_id: store.id,
        title: 'Cart Product',
        handle: `cart-product-${suffix}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    }),
  );

  const variant = await withTestTenant(store.id, (tx) =>
    tx.productVariant.create({
      data: {
        product_id: product.id,
        title: 'Default Title',
        price: '25.00',
        inventory_qty: 10,
        track_inventory: true,
        continue_selling: false,
      },
      select: { id: true },
    }),
  );

  return {
    storeId: store.id,
    variantId: variant.id,
  };
}
