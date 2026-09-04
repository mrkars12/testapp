# FINAL RELEASE AUDIT — Checkout / Payment / Inventory

**Date:** 2026-09-03
**Scope:** the current working tree at `/workspaces/testapp`, with Round 8, Round 9 and Round 10 treated as implemented.
**Nature:** audit only. No code, schema, migration, database row, policy, grant, commit or push was changed. Nothing found here was fixed.
**HEAD:** `e27031d2abed2d417318bbec6bd4f7566c570ac7` — unchanged throughout.

> **UPDATED 2026-09-03, after the release-hardening pass.**
> Everything below the next section is the **original audit, preserved unchanged** —
> its findings, its reasoning, its verdict and its wording. Section 0 records what
> was subsequently fixed and what evidence was produced. Where the original text
> says a thing is broken, it was true when written; Section 0 and the per-finding
> **STATUS** lines say whether it still is.

---

## 0. Status after the release-hardening pass

**F-01 through F-10 are CLOSED.** F-11 through F-18 were out of that pass's scope and
remain open exactly as written below.

The verdict in Section 1 (`NOT RELEASE READY`) was correct on 2026-09-03 before the
hardening pass and is preserved as the historical record. On the evidence in this
section the current state is:

# RELEASE READY WITH DOCUMENTED LIMITATIONS

The limitations are the ones in Section 9, and **none of them has been solved** — they
have been re-stated, not retired. See §0.4.

### 0.1 Finding status

| # | Original severity | Status | Fixed in |
|---|---|---|---|
| F-01 | BLOCKER — release not in version control | **CLOSED** | root `.gitignore`; all 17 migrations + all cart/inventory source staged |
| F-02 | BLOCKER — migration history cannot replay | **CLOSED** | `20260817164428_bootstrap_database_roles`, repaired `20260817164429_enable_payment_rls`, `20260903130000_platform_roles_grants_and_policies` |
| F-03 | BLOCKER — manual roles/grants/policies | **CLOSED** | the same two new migrations + `prisma/BOOTSTRAP.md`, `prisma/bootstrap/grant-login.sql`; `CheckoutExpiryJob` error boundaries split |
| F-04 | BLOCKER — two Orders / two charges for one cart | **CLOSED** | cart arm added to `CheckoutSuccessionFundsService`, wired into the applier and the G1 status guard |
| F-05 | HIGH — late finalisation over `expired` reservations | **CLOSED** | `checkout-finalizer.service.ts`, both reservation selections |
| F-06 | HIGH — cross-mode inventory | **CLOSED** | mode-blind netting; order/product paths follow the storefront's configured mode |
| F-07 | HIGH — reconciliation starvation | **CLOSED** | `payment_intents.last_reconciled_at` + `20260903140000_reconciliation_progress`; lag metric in `PaymentsHealthJob` |
| F-08 | HIGH — frontend suite never completes | **CLOSED** | re-entry guard in `SelectStoreClient.tsx`; unbounded render/fetch loop removed |
| F-09 | MEDIUM — integration suite not deterministic | **CLOSED** | `offline-refunds.integration.spec.ts` — assertion rewritten to the invariant; **no production change** |
| F-10 | MEDIUM — test DB bypasses migrations | **CLOSED** | `test/global-setup.ts` now runs `prisma migrate deploy` with the real `dartstore_app` / `dartstore_platform` roles |

### 0.2 Verification evidence

Every figure below was produced after the last code change.

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | **exit 0, no output** |
| Backend `npm run build` (`nest build`) | **exit 0** |
| Backend unit (`npx jest`) | **66 suites, 1351 / 1351 passed** |
| Backend integration (`npm run test:integration`) ×3 consecutive | **30 suites, 586 / 586 passed, every run** |
| Frontend `tsc --noEmit` | **exit 0, no output** |
| Frontend `npm run build` (`next build`) | **exit 0**, all routes emitted |
| Frontend `npx vitest run` ×2 consecutive | **44 / 44 files, 573 / 573 tests, 0 worker errors** |
| Migration replay (`scripts/verify-migration-replay.sh`) | **PASS on two independent empty PostgreSQL 16 databases**; `migrate diff` against `schema.prisma` returned "This is an empty migration" |

Earlier in the same pass, before the final sweep: backend integration ran **10 consecutive
times at 586/586** while hunting F-09, and the F-09 reproduction command ran **30 consecutive
times clean** after its fix (pre-fix rate 3 / 20).

### 0.3 Regression tests added

| Finding | Tests |
|---|---|
| F-02 | `src/common/database/migration-chain.spec.ts` — 6 static guards; `scripts/verify-migration-replay.sh` (`npm run test:migrations`) |
| F-03 | `src/stores/checkout/checkout-expiry.job.spec.ts` — 5 tests proving each sweep half fails and reports independently |
| F-04 | `funds-secured.integration.spec.ts` → `the cart arm — no supersession token, one basket` — 6 tests. Reverting only the cart arm reproduces **2 orders and 0 remediation events** |
| F-05 | `funds-secured.integration.spec.ts` tests 13 and 14. Reverting the fix reproduces stock stuck at 10 and an empty oversold array |
| F-06 | `checkout.service.integration.spec.ts` → F-06a/b/c |
| F-07 | `reconciliation.service.integration.spec.ts` — 6 tests; 4 lag tests in `payments-health.job.spec.ts` |
| F-08 | `SelectStoreClient.test.tsx` — 10 / 10, 221 s + OOM → 1.6 s |
| F-09 | `offline-refunds.integration.spec.ts` — assertion replaced by 7 invariant assertions; verified to still fail under two deliberate sabotages of `IdempotencyService` |

### 0.4 What has NOT been verified, and is NOT claimed

The hardening pass changed none of this. Section 9 stands in full:

- **No real-browser validation.** Two genuine tabs, the `dc` cookie surviving the gateway's
  top-level redirect under `SameSite=Lax`, provider-form teardown against a real iframe, and
  back/forward + bfcache after payment are all still unverified. The screenshots in
  `payment-browser-evidence/` predate Round 8's cart identity and do not describe current behaviour.
- **No real gateway test-mode validation.** Stripe's hosted Checkout Session → PaymentIntent
  resolution — the exact lifecycle Round 10's production fix addresses — is still asserted only
  against synthetic facts. Webhook redelivery from a real provider's retry machinery, real
  capture/refund/void idempotency, the Moyasar decline-then-retry sequence, 3DS abandonment, and
  every non-Stripe adapter remain unexercised against a live test account.
- **No load testing.** Every concurrency test runs in one Node process against one connection
  pool; the spec files say so themselves. Lock contention, lock wait times inside TX1 and
  `lock_timeout` behaviour on the hot path are unmeasured.
- **The live Neon database was never reached.** It was unreachable for the whole audit
  (`P1001`) and was deliberately not contacted during hardening. Nothing in §7's
  "what I could not verify" list has been checked since, and the `ROUND9` vs
  `FINAL_ROUND8_ROUND9_VERIFICATION` contradiction about whether the inventory guards are applied
  there is **still unresolved**. Deploying to it additionally requires
  `prisma migrate resolve --applied 20260817164429_enable_payment_rls`, because that migration was
  edited — see `prisma/BOOTSTRAP.md`.
- **Operational configuration is still required**: alert routing for the four
  `PaymentsHealthJob` alarms (now five, with `[reconciliation-lag]`), and explicit production
  values for `NODE_ENV`, `STOREFRONT_PAYMENT_MODE`, `CART_IDENTITY_ENABLED` and
  `OUTBOX_DISPATCHER_ENABLED`.
- **F-11 through F-18 remain open** as written below.

### 0.5 Repository state

Nothing has been committed or pushed. `HEAD` is still
`e27031d2abed2d417318bbec6bd4f7566c570ac7`; the whole release — original work plus these
fixes — is **staged**. The Neon database was not modified in any way.

---

## 1. Executive verdict

# NOT RELEASE READY

The application logic is, on the whole, genuinely good. Round 8's server-authoritative cart, Round 9's locked-and-netted inventory claim and Round 10's attempt-correlation fix are correctly reasoned, correctly implemented and backed by real concurrency tests that I re-ran and confirmed green. If the only question were "is the checkout algorithm sound?", the answer would be close to yes.

That is not the question a release asks. Three things block it, and none of them is a matter of taste:

1. **The release does not exist in version control.** Every file Round 8 and Round 9 created is untracked, and **8 of the 14 migration directories are untracked**. A deployment from this repository ships a system with no cart tables, no inventory guards and no RLS at all.
2. **The migration history cannot be replayed.** I verified this directly: `prisma migrate deploy` against a fresh database fails at `20260817164429_enable_payment_rls`, which drops a table that no migration creates, alters a policy that no migration creates, and references a role that no migration creates. Every `GRANT` and every `CREATE ROLE` in this system is manual database state that exists nowhere in the repository.
3. **One real duplicate-charge path remains open.** The protection against two orders for one purchase is keyed on a supersession token held in browser memory, not on the server-authoritative cart that Round 8 built precisely to be that key. A page reload between a failed attempt and its retry breaks the chain, and a late-arriving payment on the first checkout then creates a second Order for a cart that is already converted.

The first two are fixable in a day and are entirely mechanical. The third is a real design gap that Round 8 left half-connected. Until all three are closed, this working tree is a good prototype of a production checkout, not a production checkout.

### Verdict by area

| Area | Verdict |
|---|---|
| 1. Cart / checkout identity | Sound, with one client-dependent seam (F-04) |
| 2. Checkout concurrency | **Sound.** Phase A/B, leasing and compensation are correct |
| 3. Inventory | Sound within one mode; **cross-mode netting is broken** (F-06) |
| 4. Payment reliability | Sound, but reconciliation — the stated backstop — can be starved (F-07) |
| 5. Tenant / security isolation | Sound in code; **the database half is manual and unreproducible** (F-02, F-03) |
| 6. Pricing / money | **Sound.** No finding |
| 7. Database / migrations | **BLOCKED** |
| 8. Operational safety | Adequate mechanisms, log-only surfacing, two silent-failure modes |
| 9. Test quality | Strong where it counts; not deterministic; migrations untested |
| 10. Real-world gaps | Substantial and unclosed (§9) |

---

## 2. Blockers

### F-01 — BLOCKER — The entire release is uncommitted, and most of it is untracked

**STATUS: CLOSED.** Root `.gitignore` added; all 17 migration directories and every cart/inventory source file are staged; 8 tracked archives untracked with `git rm --cached` and all still present on disk. See §0.

**Exact location**
- `git status --porcelain` → 382 entries; `HEAD` is `e27031d`, unchanged since before Round 8.
- Untracked (`??`), verified individually:
  - `backend/src/stores/cart/` — **all 8 files** (`cart.service.ts`, `cart-slot.ts`, `cart-token.ts`, `quote-hash.ts`, `storefront-cart.controller.ts`, `cart.module.ts`, `dto/`, `cart-isolation.integration.spec.ts`)
  - `backend/src/stores/inventory/` — **both files** (`inventory-claim.ts`, `inventory-claim.spec.ts`)
  - `backend/src/stores/payments/facts/checkout-succession-funds.service.ts`
  - `backend/prisma/migrations/` — **8 of 14 directories**: `20260817164429_enable_payment_rls`, `20260818120000_add_webhook_events`, `20260818140000_add_disputes`, `20260820120000_add_store_default`, `20260829120000_add_stc_pay_method`, `20260902090000_add_checkout_succession`, `20260903000000_add_storefront_cart`, `20260903120000_inventory_concurrency_guards`

`git ls-files backend/prisma/migrations/` returns only the six migrations up to `20260809205329`.

**Why it matters**
The claim under audit is that this working tree is ready to be *treated as a release*. A release is what a deployment pipeline can obtain. What the pipeline can obtain here is a codebase from 2026-08-09 with no carts, no inventory claim, no RLS, no webhook events, no disputes and no checkout succession. Every invariant Rounds 5 through 10 established is invisible to it.

**Concrete failure scenario**
CI checks out `main`, runs `prisma migrate deploy` (six migrations), builds, and deploys. The storefront has no `carts` table, so `CartService` is absent, so `claimCart()` returns `no_cart` for every request and the stateless path runs for everyone. Two tabs place two orders. No RLS policy exists on any payment table, so a single missing `store_id` predicate reads another merchant's payments.

| Question | Answer |
|---|---|
| Duplicate charge | **Yes** |
| Duplicate order | **Yes** |
| Lose money | **Yes** |
| Oversell | **Yes** |
| Break tenant isolation | **Yes** |

**Recommended next action** — Commit the working tree on a branch, with the migrations, and confirm `git ls-files` lists all 14 migration directories and every file in `src/stores/cart` and `src/stores/inventory`. Nothing else in this report can be assessed as a release until this is true.

---

### F-02 — BLOCKER — The migration history cannot be applied to a fresh database

**STATUS: CLOSED.** `DROP TABLE IF EXISTS`; `order_store_isolation` created-or-altered in a `DO` block with RLS enabled on `Order`; both roles created `NOLOGIN NOSUPERUSER NOBYPASSRLS` by a new bootstrap migration. Replay verified on two empty databases, `migrate diff` empty. See §0.

**Exact location** — `backend/prisma/migrations/20260817164429_enable_payment_rls/migration.sql`
- line 2: `DROP TABLE "__rls_force_probe";` — `grep -rn "__rls_force_probe" prisma/ src/` finds this line and nothing else. No migration ever creates that table.
- line 6: `ALTER POLICY order_store_isolation ON "Order" TO dartstore_app;` — `grep -rn "order_store_isolation" prisma/migrations/` finds this line and nothing else. No migration ever creates that policy.
- 20 references to the role `dartstore_app`. `grep -rn "CREATE ROLE\|CREATE USER" prisma/migrations/` returns **nothing**. `grep -rn "GRANT" prisma/migrations/` returns **nothing**.

**Verified, not inferred.** Run in this session against a throwaway PostgreSQL 16 container (created and destroyed; the project database was never touched):

```
$ npx prisma migrate diff --from-migrations ./prisma/migrations \
    --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url <throwaway>
Error: P3006
Migration `20260817164429_enable_payment_rls` failed to apply cleanly to the shadow database.
Error code: P1014
Error: The underlying table for model `__rls_force_probe` does not exist.
```

The migration written to *enable row-level security* is the one that cannot run. Everything after it — webhook events, disputes, store defaults, STC Pay, checkout succession, the cart, the inventory guards — is unreachable behind it.

**Why it matters** — The audit asks whether every repository migration is applied where required. The stronger fact is that the migration history has never been replayed from zero anywhere. The development database reached its current shape by accretion; the repository's record of how to get there is broken. This also means `prisma migrate status` reporting "up to date" against Neon says only that the `_prisma_migrations` table has 14 rows — it is not evidence that the DDL is replayable.

**Concrete failure scenario** — Provisioning a staging or production database, or a disaster-recovery rebuild: `prisma migrate deploy` fails on the third statement of migration 7. Recovery is impossible without hand-authoring the missing prerequisites.

| Question | Answer |
|---|---|
| Duplicate charge | No |
| Duplicate order | No |
| Lose money | No |
| Oversell | No |
| Break tenant isolation | **Yes** — a database provisioned by working around the failure has no RLS |

**Recommended next action** — Add a migration (or repair `20260817164429`) that creates `dartstore_app` and `dartstore_platform`, issues every `GRANT` the runtime needs, creates `order_store_isolation`, and removes the `__rls_force_probe` drop. Then prove it: `migrate deploy` into an empty container and diff the result against `schema.prisma`. Make that a CI gate.

---

### F-03 — BLOCKER — Roles, grants and the platform-read policies are manual database state

**STATUS: CLOSED.** Every grant and platform policy is now in `20260903130000_platform_roles_grants_and_policies`, least-privilege and enumerated per call site; `CheckoutExpiryJob.run()` has two error boundaries that name themselves. See §0.

**Exact location** — `grep -rn "dartstore_platform" backend/prisma/migrations/` returns **zero results**. The policy `dartstore_platform_carts_select` and `GRANT SELECT ON TABLE public.carts TO dartstore_platform` exist only in `out/ي/NEON_EXPIRY_GRANTS_APPLY_REPORT.md` as text a human was asked to paste into the Neon SQL editor. `out/ي/FINAL_ROUND8_ROUND9_VERIFICATION.md` §1 records that someone eventually did.

The same is true of the five pre-existing platform reads (`outbox_messages`, `payment_accounts`, `payment_idempotency_records`, `payment_intents`, `webhook_events`) that `PrismaService.platform()` depends on.

**Why it matters** — This is precisely the "hidden/manual-only DB state that production deployment would miss" the audit asks about. It is not hypothetical: the history in `out/ي/` shows this exact grant being missed once already, and the earlier report noticed only because the job threw.

**Concrete failure scenario** — A new environment is provisioned. `CheckoutExpiryJob.run()` (`backend/src/stores/checkout/checkout-expiry.job.ts:37-62`) calls `releaseExpired()` then `sweepExpiredCarts()` inside **one** `try`. The second throws `42501 permission denied for table carts` every minute. The log line reads `Checkout expiry sweep failed: …` — it does not say which half failed, and the first half's work has already committed. An operator reads it as "the expiry sweep is broken" when reservations are in fact being released fine; carts are silently never abandoned. The identical confusion is documented in `NEON_EXPIRY_GRANTS_APPLY_REPORT.md` §3, where the previous report's diagnosis had to be retracted.

Worse, `ReconciliationService.sweep()` also runs on `this.prisma.platform()`. A missing platform grant there disables the system's only recovery from lost webhooks, and the failure is caught and logged at `warn`.

| Question | Answer |
|---|---|
| Duplicate charge | No |
| Duplicate order | No |
| Lose money | **Yes, indirectly** — a starved reconciliation leaves paid checkouts with no order |
| Oversell | **Yes** — unabandoned carts and unreleased holds distort availability |
| Break tenant isolation | **Yes** — the whole role model is unreproducible |

**Recommended next action** — Move every role, grant and policy into migrations (F-02). Separately, split `CheckoutExpiryJob.run()`'s single `try` into two so a failure names its half.

---

### F-04 — BLOCKER — Two Orders and two charges for one cart: the succession guard is keyed on browser state, not on the cart

**STATUS: CLOSED.** `isCartConvertedElsewhere()` + `lockCart()` added to `CheckoutSuccessionFundsService` and wired into both the applier (G2) and the status guard (G1). The chain arm is untouched; the cart arm only adds refusals. See §0.

**Exact location**
- `backend/src/stores/payments/facts/checkout-succession-funds.service.ts` — `rootOf()` and `isBlocked()` walk `supersedes_id` and nothing else.
- `backend/src/stores/checkout/checkout.service.ts:1718-1742` — `resolveSupersededCheckoutId()` returns `null` immediately when the request carries no `supersedes_checkout_token`.
- `frontend/app/stores/[slug]/checkout/page.tsx:480` — `supersedesTokenRef` is a `useRef`, written only at line 1997 by `releaseAttempt` and cleared at 1519/1633. It is browser memory.
- `backend/src/stores/payments/facts/checkout-finalizer.service.ts:69-120` — `finalize()` reads the checkout and its order id. It never reads `checkout.cart_id`, and there is no cart-level refusal anywhere in the finalisation path.

**Why it matters** — Round 8's entire thesis is that the *cart* is the server-authoritative identity of a purchase, and the migration comment says so explicitly. Round 5/6's superseded-funds protection — the thing that prevents a second Order and emits `payment.superseded_funds_detected` so the money can be returned — was built before Round 8 and still keys on a chain the **client** must assemble by sending a token it holds in RAM. Round 8 introduced `checkouts.cart_id`, the server-side answer to the same question, and never connected it.

`checkouts_one_live_per_cart` covers the common case: while checkout A is live, no second checkout exists for that cart. It stops covering the moment A is no longer live — expired by the sweep, or marked `failed` by `abandon()`.

**Concrete failure scenario**
1. Cart C. Checkout A created; the shopper is sent to the gateway; they pay.
2. The webhook is delayed (provider incident, firewall, retry backoff). The page times out and shows the failure panel; or the shopper simply reloads.
3. A expires, or a decline fact arrives first and `abandon()` marks it `failed`, releases its holds and returns the cart slot. Cart C is `active` again — by design, so retry works.
4. The shopper retries. Because the page was reloaded, `supersedesTokenRef.current` is `null`, so `supersedes_checkout_token` is absent and `supersedes_id` on checkout B is **null**. B is created on cart C, and pays. Order 2 exists; cart C is `converted`.
5. A's payment finally reports. The applier finds `SECURES_FUNDS`, asks `isBlocked()` — B is not in A's chain, so the answer is **no** — and calls `finalize(A)`. A's `order_id` is null, so **Order 1 is created**. `convertCartForCheckout` is a no-op (the cart is no longer `active`), so nothing even records the collision.

Two Orders, two real charges, one basket, and **no `payment.superseded_funds_detected` event**, so `PaymentsHealthJob`'s `[superseded-funds]` alarm never fires and nobody is told to refund.

| Question | Answer |
|---|---|
| Duplicate charge | **Yes** |
| Duplicate order | **Yes** |
| Lose money | **Yes** — the customer's second charge has no automatic remediation path |
| Oversell | **Yes** — both orders decrement, or the second silently cannot (see F-05) |
| Break tenant isolation | No |

**Recommended next action** — Give `isBlocked()` a second, server-side arm: a checkout whose `cart_id` names a cart that is already `converted` to a *different* order must be treated exactly as a superseded checkout — record the money, emit `payment.superseded_funds_detected`, create no Order. This uses the identity Round 8 already built and adds no new concept. It is not a new architecture; it is finishing the wiring between two rounds.

---

## 3. High / medium / low risks

### F-05 — HIGH RISK — A late finalisation over `expired` reservations takes no stock and raises no alarm

**STATUS: CLOSED.** `expired` added to both reservation selections in `checkout-finalizer.service.ts`. See §0.

**Exact location** — `backend/src/stores/payments/facts/checkout-finalizer.service.ts:241` and `:293`:
```ts
state: { in: ['held', 'released'] },
```
`CheckoutExpiryJob.releaseOne()` writes a third state: `backend/src/stores/checkout/checkout-expiry.job.ts:137` → `data: { state: 'expired', settled_at: now }`.

**Why it matters** — The comment above line 241 explains carefully why `released` is included: real money must take real goods. The reasoning is right and `expired` was missed. Because the selection is empty, the `for` loop never runs, `shortfalls` stays empty, and the `inventory.oversold` outbox event — the entire observability mechanism Round 9 §10 built for exactly this situation — is not emitted. This is the audit's "silently fails instead of surfacing an operational problem", in its purest form.

**Concrete failure scenario** — A shopper starts a checkout and abandons the tab. Ninety minutes later the expiry sweep marks the checkout `expired` and its reservations `expired`. The stock returns to the pool and is sold to someone else. The original shopper's provider session was still open and they complete payment (or a long-delayed webhook redelivery lands). `finalize()` runs: the order is created and marked `PAID`, `inventory_qty` is **not** decremented for it, and nothing anywhere records that goods were sold twice. The merchant discovers it when they run out of stock with an unexplained gap.

Contrast with the covered case: test 10 in `funds-secured.integration.spec.ts:1414` proves the `released` path correctly creates the order, refuses to go negative and emits `inventory.oversold`. The `expired` path has no test at all.

| Question | Answer |
|---|---|
| Duplicate charge | No |
| Duplicate order | No |
| Lose money | No (the merchant is paid) |
| Oversell | **Yes, and silently** |
| Break tenant isolation | No |

**Recommended next action** — Add `'expired'` to both selections, and add a regression test that expires a checkout's reservations, then applies a capture, and asserts an `inventory.oversold` row exists.

---

### F-06 — HIGH RISK — Inventory is shared across modes; reservations and the admin path are not

**STATUS: CLOSED.** Netting is mode-blind (one physical pool per variant); the admin order path and the product edit path both follow the storefront’s configured mode. Incidentally fixed a latent defect this surfaced: `assertAbsoluteEditIsSafe()` ran without tenant context and therefore always summed zero held units. See §0.

**Exact location**
- `backend/prisma/schema.prisma:644-681` — `ProductVariant` has `inventory_qty` and **no `mode` column**.
- `backend/src/stores/inventory/inventory-claim.ts` — `heldQuantities()` filters `mode: input.mode`; `decrementInventory()` and `incrementInventory()` scope by `store_id` through `Product` but carry **no mode predicate**.
- `backend/src/stores/orders/order.service.ts:40` — `const ORDER_RLS_MODE = 'live';` — the admin manual-order path always nets `live` holds.
- `backend/prisma/schema.prisma:755` — `Order` has `store_id` and **no `mode`**.
- `backend/.env` — `STOREFRONT_PAYMENT_MODE=test`.

**Why it matters** — Availability is `inventory_qty` (mode-blind) minus a `held` sum (mode-scoped). Two claim paths in different modes therefore net **disjoint** reservation sets against **one shared** counter. The `FOR UPDATE` lock serialises them perfectly and they still both say yes, because each is subtracting only its own half of the holds. This is the same shape of bug Round 9 was created to fix, one dimension over.

The current configuration makes it live: the storefront runs in `test` mode, so every storefront hold is `mode='test'` and is invisible to the admin order path, which hardcodes `live`. Test-mode purchases also decrement real stock and create real Orders, because `Order` carries no mode.

**Concrete failure scenario** — One unit of a variant remains. A storefront shopper (test mode) claims it: reservation `held`, `mode='test'`, `inventory_qty` still 1. The merchant creates a manual order for the same variant. `assertAvailable` runs with `mode: 'live'`, sums `held` where `mode='live'` → 0, computes availability 1 − 0 = 1, passes, and decrements to 0. The shopper's payment then succeeds; `finalize()` decrements again; `decrementInventory`'s guard refuses (0 < 1) and the shortfall is emitted. One unit, two orders. If the variant is `continue_selling`, no guard fires at all and stock goes to −1 with no oversell event.

| Question | Answer |
|---|---|
| Duplicate charge | No |
| Duplicate order | No |
| Lose money | No |
| Oversell | **Yes** |
| Break tenant isolation | No — store scoping is correct throughout |

**Recommended next action** — Decide the intended semantics explicitly and write it down: either inventory becomes mode-scoped, or reservations stop being mode-scoped for netting purposes and `heldQuantities()` drops its mode filter. The second is the smaller change and matches the shared counter. Either way, `ORDER_RLS_MODE = 'live'` needs to agree with `STOREFRONT_PAYMENT_MODE`.

---

### F-07 — HIGH RISK — Reconciliation can be permanently starved, silently

**STATUS: CLOSED.** `payment_intents.last_reconciled_at` stamped on every visit and ordered `NULLS FIRST`; no intent status is changed, so manual-capture semantics are intact. Lag surfaced as `[reconciliation-lag]` in `PaymentsHealthJob`. See §0.

**Exact location** — `backend/src/stores/payments/facts/reconciliation.service.ts`
- `:28` `const BATCH_SIZE = 50`
- `:30-37` `NON_TERMINAL` includes `'authorized'` and `'partially_captured'`
- `:78-88` the query: `status IN NON_TERMINAL AND created_at < cutoff`, `orderBy: created_at asc`, `take: 50`
- `:108-116, :131-133, :147` `reconcileIntent()` returns `false` — changing nothing — for an intent with no account, an unregistered gateway, a provider without `statusPolling`, or an attempt with no `gateway_reference`.

**Why it matters** — The file's own header states the design contract: *"The system is designed to be correct with every webhook dropped. That claim is only true because this exists."* The sweep selects the 50 **oldest** matching intents. Intents that can never be reconciled — a manual-capture authorisation waiting weeks for the merchant, a `partially_captured` intent, an attempt that never got a reference — stay in the matching set forever and stay the oldest. Once 50 such intents accumulate, the sweep re-reads the same 50 every five minutes and never sees a newer one again.

It is silent by construction: `processed` stays 0, and `run()` only logs when `processed > 0`. There is no metric for reconciliation lag and nothing in `PaymentsHealthJob` watches it.

**Concrete failure scenario** — A merchant using manual capture accumulates 50+ `authorized` intents. A webhook endpoint is then misconfigured. Every affected customer pays and no order is created. Reconciliation, the designed recovery, has been dead for weeks and said nothing. The first signal is customer complaints.

| Question | Answer |
|---|---|
| Duplicate charge | No |
| Duplicate order | No |
| Lose money | **Yes** — customers charged with no order, undetected |
| Oversell | No |
| Break tenant isolation | No |

**Recommended next action** — Track a per-intent `last_reconciled_at` (or a skip marker) and order by it, so a batch cannot be occupied by permanent residents; exclude `authorized`/`partially_captured` intents that have no pending action. Add reconciliation lag — oldest unreconciled non-terminal intent age — to `PaymentsHealthJob`.

---

### F-08 — HIGH RISK — The frontend suite never completes in one run

**STATUS: CLOSED.** Root cause was a heap OOM from an unbounded render/fetch loop in `SelectStoreClient` (`authedHome()` force-refreshes, flipping the `settled` dependency that triggered it). Re-entry guard added. Suite now completes: 44/44 files, 573/573 tests, 0 worker errors, twice. See §0.

**Exact location** — `frontend/`, full `npx vitest run`. Measured twice in this session.

```
Test Files  43 passed (44)
     Tests  563 passed (573)
    Errors  1 error
Caused by: Error: Worker exited unexpectedly
```

**Why it matters** — There is no green frontend run. One file's worth of tests (10 tests) is never executed, and the Round 8 report records that the file which dies varies between runs. "Every file passes individually" is a fair mitigation but it is not the same claim, and a suite that cannot be run as a suite cannot be a CI gate.

I did confirm the three checkout-critical files pass together on their own: `checkout-payment-flow.test.tsx` + `cart-lock.test.tsx` + `checkoutSync.test.ts` → **3 files, 223 tests, all passed**.

**Recommended next action** — Diagnose the worker crash (likely memory; `checkout-payment-flow.test.tsx` alone runs ~2 minutes). Until it is fixed, no frontend release gate is meaningful.

---

### F-09 — MEDIUM RISK — The backend integration suite is not deterministic

**STATUS: CLOSED.** Root cause was test synchronisation, not an application race: the assertion pinned *which* of two correct idempotency outcomes the loser received (`in_flight` rejection vs `replay` fulfilment), which pure timing decides. 25 instrumented runs showed one refund row and a balanced ledger every time. The assertion was replaced with 7 stronger invariant assertions; no production code changed. See §0 and `out/F09_FLAKY_TEST_ROOT_CAUSE_AND_FIX.md`.

**Evidence, three consecutive full runs in this session:**

| Run | Suites | Tests |
|---|---|---|
| 1 | 29 passed / 29 | **569 passed / 569** |
| 2 | **1 failed**, 28 passed / 29 | **1 failed**, 568 passed / **569** |
| 3 | 29 passed / 29 | **569 passed / 569** |

Run 2's failure detail was lost to output truncation on my side; I did not capture which test it was, and I am not going to guess. Round 10's report names two historically flaky candidates — `offline-refunds › refunds once under a concurrent duplicate submission` and `capture-void › runs one operation only under a concurrent duplicate submission` — and both are concurrency tests, which is the right shape for this.

**Why it matters** — Round 10 reported "green twice in a row" and that was accurate for those two runs. Three runs shows the suite is green about two times in three. A concurrency test that fails one run in three is either a genuine intermittent bug in the code under test or a genuinely racy test; both need to be known before release, and neither is currently identified.

**Recommended next action** — Run the suite 10× capturing full output, identify the failing test by name, and classify it. Do not ship on "it passed twice".

---

### F-10 — MEDIUM RISK — The test database is built by `db push` + a hand-mirrored setup script

**STATUS: CLOSED.** `test/global-setup.ts` now provisions via `prisma migrate deploy` with the real `dartstore_app` / `dartstore_platform` roles and their production grants; no hand-written DDL remains. See §0.

**Exact location** — `backend/test/global-setup.ts`
- `pushSchema()` runs `prisma db push`. **No migration is ever executed by any test.**
- `configureRlsRole()` / `setupRls()` create a role named **`rls_test`**, not `dartstore_app`, and re-declare every policy `TO rls_test`.
- `:550, :571, :580, :588` re-create by hand the four objects Prisma cannot express: `checkouts_one_live_per_cart`, `product_variant_inventory_floor`, `inventory_reservation_quantity_positive`, `inventory_reservations_held_by_variant_idx`.

**Why it matters** — Three consequences, each independently real:
1. F-02 was invisible for weeks because nothing runs the migrations.
2. The production role split (`dartstore_app` vs `dartstore_platform`, and the grant boundary between them) is never exercised. The tests prove policies work for a role that does not exist in production.
3. All four database backstops live in exactly two places, both of which are outside the repository's tracked migration history (F-01) — an untracked migration file and this setup script. `schema.prisma:1519` and `:1600` document them only as comments. A database provisioned by `db push` — which is how the tests do it — has **none** of them.

**Recommended next action** — Build the test database with `prisma migrate deploy` (which requires F-02 fixed first), using the real role names.

---

### F-11 — MEDIUM RISK — `NODE_ENV=development`, so the cart cookie is not `Secure`

**Exact location** — `backend/.env` → `NODE_ENV=development`; `backend/src/common/config/configuration.ts:120` → `isProduction: process.env.NODE_ENV === 'production'`; `backend/src/stores/cart/cart-token.ts:cartCookieOptions()` → `secure: input.isProduction`.

The configuration file's own comment at `:26` warns that `NODE_ENV=development` is "the shared/deployed default". The cart token is the sole bearer credential for a shopper's cart; without `Secure` it is transmissible over plaintext HTTP. `HttpOnly` and `SameSite=Lax` are correctly set, and the per-store `Path` scoping is a genuinely good decision.

**Recommended next action** — Treat `NODE_ENV=production` as a deployment precondition and assert it at boot, or derive `secure` from the scheme rather than the environment name.

---

### F-12 — MEDIUM RISK — The `CART_IDENTITY_ENABLED` kill switch removes all duplicate-purchase protection

**Exact location** — `backend/src/stores/checkout/storefront-checkout.controller.ts:62-66` — when `cartIdentityEnabled === false`, `cartToken()` returns `null`, so `claimCart()` returns `no_cart` and `dto.items` becomes authoritative for contents. `storefront-cart.controller.ts:120` returns an empty view and mints no cookie.

This is a deliberate, well-documented rollback lever and the layered deployment reasoning behind it is sound. It is recorded here because flipping it in production silently reverts the system to the pre-Round-8 duplicate-order behaviour — a fact that belongs in a runbook, not only in a code comment.

**Recommended next action** — Document it as a production-incident lever with its consequence stated, and log a `warn` at boot when it is off.

---

### F-13 — MEDIUM RISK — A synchronous success applied outside every compensation boundary

**Exact location** — `backend/src/stores/checkout/checkout.service.ts:1655-1662`:
```ts
if (!offline) {
  const fact = this.synchronousFact(initializeResult, offering.account_id, currency);
  if (fact) { await this.applier.applyMany([fact], 'api'); }
}
```
This sits after TX2 and outside both `releaseHoldOnFailure` calls.

Being outside the compensation is **correct** — releasing the hold after a successful charge would be much worse. But if `applyMany` throws for a payment that already succeeded synchronously, the shopper receives an error, `createAndCommit`'s catch calls `idempotency.fail()`, and no Order exists for real money. Recovery depends entirely on the webhook or on reconciliation — which F-07 shows can be starved.

**Recommended next action** — Catch and log at `error` around this call so the customer's response reflects the payment rather than the bookkeeping, and so a distinct alertable signal exists. Do not add compensation here.

---

### F-14 — MEDIUM RISK — `assertAbsoluteEditIsSafe` aggregates held reservations with no mode filter

**NOTE (out of scope, but affected):** the F-06 work made mode-blindness the *documented rule* for every aggregate over `inventory_qty`, so this function is now consistent with `heldQuantities()` rather than inconsistent with it. Not re-audited and not claimed closed.

**Exact location** — `backend/src/stores/inventory/inventory-claim.ts` → `assertAbsoluteEditIsSafe()`'s aggregate filters `store_id` and `variant_id` and `state: 'held'`, but not `mode`. Every other reservation aggregate in the file scopes mode.

Direction of error is safe — it over-counts holds and refuses an edit it could have allowed — so it cannot cause an oversell. It is inconsistent with its neighbours and is the other half of F-06.

**Recommended next action** — Resolve together with F-06 so both sides use the same rule.

---

### F-15 — LOW RISK — `readAvailability` reads variants by bare id

**NOTE (out of scope, but affected):** `readAvailability()` gained the `product: { store_id }` predicate incidentally during the F-06 change, so the specific gap described below no longer exists in that function. Not re-audited and not claimed closed.

**Exact location** — `backend/src/stores/inventory/inventory-claim.ts` → `readAvailability()`:
```ts
const variants = await tx.productVariant.findMany({
  where: { id: { in: [...input.variantIds] } },
  select: { id: true, inventory_qty: true },
});
```
No store predicate. `ProductVariant` has no `store_id` and no RLS policy, so nothing below this catches an unscoped id.

Both current callers pre-filter: `resolveLines()` (`checkout.service.ts:2894`) constrains `product: { store_id: storeId }`, and the admin path resolves variants through a store-scoped query first. So this is safe today. It is noted because `decrementInventory` and `incrementInventory` in the same file both join `Product` for exactly this reason, and this function is the one that does not.

**Recommended next action** — Add the same `product: { store_id }` predicate for consistency and defence in depth.

---

### F-16 — LOW RISK — A stale or foreign cart cookie silently falls back to the stateless path

**Exact location** — `backend/src/stores/cart/cart.service.ts:401-402` — a token that resolves to no row in this store/mode returns `{ kind: 'no_cart' }`, and `commit()` then treats `dto.items` as authoritative.

Pricing stays server-side, so no money consequence. The consequence is that the failure of cart identity is indistinguishable from its absence, and a client can obtain the weaker path deliberately by dropping the cookie. `GET /cart` clears a dead cookie; `POST /checkout` does not.

**Recommended next action** — Log at `debug` when a presented cart token resolves to nothing, so the rate is observable.

---

### F-17 — LOW RISK — The `dc` cookie has no CSRF defence in depth

**Exact location** — `backend/src/common/csrf-protection.middleware.ts:35-39` — the check engages only when `req.cookies['access_token']` is present. The cart cookie is not considered.

`SameSite=Lax` does prevent cookies on cross-site `POST`, and all cart mutations are `POST`/`PATCH`/`DELETE`, so there is no exploitable path today. The middleware's own doc-comment explains the "simple form" gap it exists to close for session cookies; the cart cookie relies on `SameSite` alone.

**Recommended next action** — Extend the content-type check to requests carrying `dc`. Cheap, and removes the dependence on a single browser behaviour.

---

### F-18 — LOW RISK — Build artefacts and archives are tracked in the repository

**Exact location** — `git ls-files`: `New folder (5).zip`, `backend/awscliv2.zip`, `backend/dist.zip`, `backend/src.zip`, `backend/src/stores.zip`, `backend/src/stores/23.zip`, `backend/src/stores/stores.zip`, `backend/backup.sql` (0 bytes).

No secrets found: `backend/.env` is gitignored (`backend/.gitignore:39`) and untracked, `backup.sql` is empty, and no `postgres://` URL, private key or live provider key appears in any tracked file. `neon-backup.sql` / `neon-backup1.sql` / `neon-backup.dump` are present on disk but **untracked**.

**Recommended next action** — Remove the archives before the first real commit, so the release history does not start by carrying a snapshot of itself.

---

## 4. Accepted designs

Examined and agreed with. Each is a deliberate choice with the trade-off stated in the code.

| # | Design | Where | Why it is right |
|---|---|---|---|
| A-1 | **Cookieless fallback** — no cookie means no cart identity and `dto.items` is authoritative | `checkout.service.ts:808-815` | A cookieless browser must still be able to buy, and it makes the change deployable and reversible one layer at a time. The residual (two tabs → two orders for that shopper) costs the shopper, not the merchant, and cannot oversell. Related to F-16 |
| A-2 | **`continue_selling` permits negative inventory, and the negative *is* the deficit** | `inventory-claim.ts`, `20260903120000` migration | The CHECK constraint is conditional rather than blanket for exactly this reason, and the constraint and the application guard carry the identical predicate. `assertInventoryFloor` refuses to switch backorder off against a deficit with an actionable message, so the raw constraint is never what a merchant sees |
| A-3 | **A capture arriving after a failure is applied, and creates the order** | `fact-decision.spec.ts:180-213`, Round 10 §Group 3 | Reproduced against a real Moyasar test account: ignoring it meant the provider had the money and this system had no order. Stripe reuses one PaymentIntent across retries, so `requires_payment_method` → `succeeded` is an ordinary sequence carrying real money. Round 10 correctly rewrote the test rather than the behaviour |
| A-4 | **A late capture over re-sold stock creates the order, refuses to go negative, and emits `inventory.oversold`** | `checkout-finalizer.service.ts:246-330` | Refusing the order while keeping the money is strictly worse than an inventory discrepancy the merchant can see. Covered by test 10. F-05 is the gap in *which* reservation states reach this code, not in the decision itself |
| A-5 | **A provider failure or decline leaves a terminal checkout with released reservations** | `checkout.service.ts:752-800`, Round 9 §3 | The durable pre-PSP hold makes "nothing was written" unavailable, so compensation replaces rollback. Moving `interpretResult()` inside the compensated region was a real defect found and fixed in Round 9 |
| A-6 | **`quote_hash` is a detector, not a lock** | `cart/quote-hash.ts` | The lock is the cart endpoints' `cart_locked` refusal. Sealing over the *priced* result and publishing only `public_id` (never the token) are both correct |
| A-7 | **Idempotency-Key and cart identity are separate mechanisms** | `checkout.service.ts:519-534` | "Is this the same request?" and "is this the same purchase?" are different questions. Deriving the key from the cart would replay a decline to a customer pressing "try again". The reasoning is explicit and correct |
| A-8 | **`PaymentsHealthJob` logs and does not route alerts** | `payments-health.job.ts:26` | Alert routing belongs to the monitoring stack. Noted as an operational-configuration dependency in §9 rather than a defect |
| A-9 | **R6 residual: a stale absolute stock edit whose sale already converted is last-writer-wins** | `inventory-claim.ts` `assertAbsoluteEditIsSafe()` | Distinguishing a genuine recount from an echoed stale number needs a version token on the request or a delta API. Under the lock this is now a documented, tested behaviour rather than an unexamined race. I agree it is out of scope; it should be on the roadmap |

---

## 5. Pre-existing issues

| # | Issue | Evidence | Assessment |
|---|---|---|---|
| P-1 | A database-side migration `20260826120000_add_user_personal_fields` exists in `_prisma_migrations` but not in the repository | Recorded in `ROUND8_CART_IMPLEMENTATION_REPORT.md` §2; I could not re-confirm it (Neon unreachable, §7) | **PRE-EXISTING**, and a second instance of the same class as F-02/F-03: the database and the repository disagree about history |
| P-2 | Repo-wide lint debt: ~14,810 errors / 202 warnings, ~13,061 auto-fixable | `ROUND9_IMPLEMENTATION_REPORT.md` §11; the `lint` script is a `--fix` script that has not been run against this tree | **PRE-EXISTING**. Not a release blocker, but it means "lint is clean" can never be a gate, and new problems land invisibly. Round 8/9/10 all correctly measured their own lines against the file baseline instead |
| P-3 | `Order` carries no `mode` | `schema.prisma:755` | **PRE-EXISTING**, and now load-bearing — see F-06 |
| P-4 | `ProductVariant` has no `store_id` and no RLS policy | `schema.prisma:644` | **PRE-EXISTING**. Tenant safety for variants is application-code only. Correctly handled at every current call site; see F-15 |

---

## 6. Test evidence

All figures below were produced in this session, not quoted from the prior reports.

### Exact counts

| Suite | Command | Result |
|---|---|---|
| **Backend unit** | `npx jest` | **64 suites, 1336 tests — 1336 passed, 0 failed** |
| **Backend integration, run 1** | `npm run test:integration` | **29 suites, 569 tests — 569 passed, 0 failed** (114.8 s) |
| **Backend integration, run 2** | `npm run test:integration` | **29 suites, 569 tests — 1 failed, 568 passed** (168.3 s) |
| **Backend integration, run 3** | `npm run test:integration` | **29 suites, 569 tests — 569 passed, 0 failed** (170.3 s) |
| **Frontend, full** | `npx vitest run` | **43 of 44 files passed; 563 of 573 tests ran; 1 worker crash** (457 s) |
| **Frontend, checkout-critical** | `vitest run checkout-payment-flow + cart-lock + checkoutSync` | **3 files, 223 tests — 223 passed** (127 s) |

These confirm the Round 10 report's headline numbers (1336 unit / 569 integration) exactly. They also correct two impressions it leaves: the integration suite is green about two runs in three, not reliably, and the full frontend suite does not complete at all.

### Are the critical concurrency tests real concurrency?

**Yes.** I read them rather than trusting the summary.

- `checkout.service.integration.spec.ts:2488` (test 1) — `Promise.allSettled` over two independent `createAndCommit` calls on two different carts against one unit. Asserts exactly one winner, `heldUnits === 1`, `inventory_qty === 1`, and — the assertion that actually proves the fix — **`pendingCalls === 1`**: the loser was refused *before* any provider call. That is the check-to-reserve window being closed, not merely a count coming out right.
- `:2524` (test 2) — 20 concurrent single-unit checkouts against 10 units, **repeated over three rounds** with a fresh database each round. Asserts exactly 10 winners, 10 provider calls, `inventory_qty === 10` and `>= 0` every round, and that all 10 rejections say `Not enough stock`.
- `:2555` (test 3) — opposite-order multi-line checkouts over `{A,B}` and `{B,A}`, proving the ascending-id lock order prevents deadlock. Zero rejections, no `40P01`.
- `capture-void.integration.spec.ts` test 12 additionally uses `createAdditionalClient()` — a genuinely separate connection pool.

These are real overlapping transactions on real connections with no mocked clock. The honest limitation — one Node process is not proof of behaviour under production parallelism — is written into the spec file itself rather than left implied, which is the right way to state it.

### Do the tests prove invariants or implementation details?

Predominantly invariants, and the good ones are notably good:

- Test 2 asserts *units sold never exceed units that existed* and *stock never goes negative* — properties, not call sequences.
- Three database-backstop tests read `pg_indexes` and provoke the CHECK constraints directly, proving the storage layer refuses what the application refuses.
- `fact-decision.spec.ts:180-213` documents a real-money incident in prose beside the assertion that prevents its recurrence. That is exemplary.
- Round 10's added test — "opens a second attempt when a DIFFERENT payment follows a terminal one" — covers the branch the fix *preserves*, which was previously untested anywhere. That is the correct instinct: test what you did not change.

### Tests that are weak or give false confidence

| Test | Problem | Class |
|---|---|---|
| The Round 9 suite as a whole | Never run against pre-Round-9 code, so there is no demonstrated before/after flip — the report says so plainly (§6), which is to its credit | **TEST/ENVIRONMENT LIMITATION** |
| Everything, with respect to migrations | `db push` + `global-setup.ts`, never `migrate deploy`. This is exactly why F-02 survived. The suite proves the *schema* works and says nothing about how a database reaches it | **HIGH — see F-10** |
| Everything, with respect to roles | Policies are created `TO rls_test`. The `dartstore_app`/`dartstore_platform` split, and the grant boundary that F-03 turns on, are untested | **HIGH — see F-10** |
| `funds-secured.integration.spec.ts:1414` (test 10) | Correct and valuable, but it runs on the **stateless** path — `body()` sends no cart token. It proves two orders result from a late capture and never checks the cart. The cart-level version of the same scenario is F-04, and it is untested | **HIGH — see F-04** |
| No test anywhere | A late finalisation over `expired` reservations (F-05). `funds-secured.integration.spec.ts:1099` asserts the expiry *produces* `expired` reservations; nothing then applies a capture to that checkout | **HIGH — see F-05** |
| Full frontend suite | Cannot complete; 10 tests never execute | **F-08** |

I found no test that is mocked incorrectly, and no test that asserts an implementation detail in place of a behaviour. The weaknesses above are all gaps in coverage, not misleading assertions — which is the better of the two problems to have.

### Flaky tests, by evidence

- **Confirmed this session:** the integration suite failed 1 of 569 tests on run 2 of 3. Identity not captured (F-09).
- **By history:** `offline-refunds › refunds once under a concurrent duplicate submission` and `capture-void › runs one operation only under a concurrent duplicate submission`, named as flaky in both `FINAL_ROUND8_ROUND9_VERIFICATION.md` §5 and `ROUND10_IMPLEMENTATION_REPORT.md` §5. Both passed in all three of my runs.
- **By history and reproduced:** the frontend `Worker exited unexpectedly` crash — a sandbox/worker failure, not an assertion failure, with the affected file varying between runs (F-08).

---

## 7. Database evidence

### What I could verify

| Check | Method | Result |
|---|---|---|
| Migration files on disk | `ls prisma/migrations/` | 14 directories + `migration_lock.toml` |
| Migration files in the repository | `git ls-files prisma/migrations/` | **6 directories.** 8 untracked — **F-01** |
| Migration history replays from zero | `prisma migrate diff --from-migrations` against a throwaway container | **FAILS** — P3006 / P1014 at `20260817164429_enable_payment_rls` — **F-02** |
| `CREATE ROLE` in migrations | `grep -rn "CREATE ROLE\|CREATE USER" prisma/migrations/` | **none** — F-02 |
| `GRANT` in migrations | `grep -rn "GRANT" prisma/migrations/` | **none** — F-02 |
| `dartstore_platform` in migrations | `grep -rn "dartstore_platform" prisma/migrations/` | **none** — **F-03** |
| `order_store_isolation` created anywhere | `grep -rn` across migrations | Only the `ALTER POLICY` at line 6 — F-02 |
| `__rls_force_probe` created anywhere | `grep -rn` across `prisma/` and `src/` | Only the `DROP TABLE` at line 2 — F-02 |
| RLS enabled, by table | migration text | 20 tables + `Order` (via `ALTER POLICY`). **Not** RLS-protected: `Checkout`, `CheckoutLineItem`, `QuoteComponent`, `Product`, `ProductVariant`, `store` — application-scoped only, backed by `TENANT_SCOPED_MODELS` and `registry-completeness.spec.ts` |
| Partial indexes / CHECK constraints present in the repository | migration text | `checkouts_one_live_per_cart`, `product_variant_inventory_floor`, `inventory_reservation_quantity_positive`, `inventory_reservations_held_by_variant_idx` — all four exist **only** in untracked migrations and in `test/global-setup.ts:550-590`. `schema.prisma:1519` and `:1600` document them as comments. **A `db push`-provisioned database has none of them** |
| Cart RLS policy shape | `20260903000000_add_storefront_cart` | `cart_store_isolation` (store + mode, `FOR ALL TO dartstore_app`) and `cart_item_store_isolation` (scoped through the parent cart, carrying both store and mode). Both correct; the cart-item shape correctly mirrors `OrderItem` |
| Secrets in tracked files | `git ls-files` + grep for connection strings, keys | **None.** `backend/.env` gitignored and untracked; `backup.sql` empty; the Neon dumps untracked |

### What I could not verify

**The live database was unreachable for the whole session.**

```
$ npx prisma migrate status
Error: P1001: Can't reach database server at
  `ep-ancient-lab-ay0fpotf-pooler.c-5.us-east-2.aws.neon.tech:5432`
```

Retried with a 180-second timeout; same result. So I cannot independently confirm, and do not assert, any of the following, all of which are reported by `FINAL_ROUND8_ROUND9_VERIFICATION.md` and are plausible but second-hand:

- `prisma migrate status` clean, 14 migrations applied
- `product_variant_inventory_floor`, `inventory_reservation_quantity_positive` and `inventory_reservations_held_by_variant_idx` present and validated on Neon (note that `ROUND9_IMPLEMENTATION_REPORT.md` §4 states they were **not** applied to Neon; the later report states they were — the two disagree and I could not adjudicate)
- `dartstore_platform_carts_select` present with `SELECT` only
- `cart_store_isolation` byte-unchanged
- `rolsuper=false`, `rolbypassrls=false` on `dartstore_platform`
- the absence of the drift item P-1

**Re-verifying these against the live database is a required pre-release step**, not an optional one — F-02 and F-03 mean the database's shape cannot be derived from the repository, so the database itself is the only source of truth about it.

---

## 8. Security evidence

### Verified sound

| Control | Evidence |
|---|---|
| **Cart cookie** | `HttpOnly`, `SameSite=Lax`, `Path=/api/storefront/<slug>` — per-store scoping so the browser will not offer store A's cart to store B, which is stronger than a server-side check that could be forgotten. Not `__Host-` for a stated, correct reason (that prefix mandates `Path=/`). 32 CSPRNG bytes, base64url. Public id is a *separate* 12-byte value, so the published name is not derived from the secret |
| **Cart token validation** | `readCartToken()` shape-checks `/^[A-Za-z0-9_-]{16,64}$/` before any database round trip |
| **Store isolation on the cart claim** | `cart.service.ts:391-399` — `store_id` and `mode` are in the SQL predicate *as well as* in the RLS context, so a token from another merchant is not a token at all |
| **Cross-store variant protection** | `resolveLines()` constrains `product: { store_id }`; `decrementInventory()` and `incrementInventory()` join `Product` and predicate on `store_id` (R7). One inconsistency: F-15 |
| **Application-level tenant guard** | `TENANT_SCOPED_MODELS` + `tenant-scope.inspector.ts` + `registry-completeness.spec.ts`, which fails if a model with `store_id` is not registered. `Cart` is registered; `CartItem` is recorded in `DELIBERATELY_UNSCOPED` with its reason |
| **Webhooks** | HMAC verified before the body is trusted; unique `(account_id, provider_event_id)` enforces once-only application in the database, with the applier's fact dedupe as an independent second layer; always returns 200 so a provider cannot be driven to disable the endpoint |
| **`return_url`** | `sanitizeReturnUrl()` validates against this deployment's own origins before the value is handed to a third party for redirection. "Parses as a URL" is correctly treated as insufficient |
| **Payment data never persisted client-side** | No card field anywhere in `frontend/app` or `frontend/lib`. Provider SDKs take the PAN in-browser; only `publishable_key` and `client_secret` cross to the client, and `lib/paymentErrors.ts:32` scrubs both from error text |
| **Browser storage** | `localStorage` is explicitly demoted to a first-paint cache (`StoreContext.tsx:244`); the server cart is authoritative. `checkoutSync.ts:22` and `returnContext.ts:7` both state in prose that they store nothing. **No correctness depends on browser storage** — with the one exception in F-04, which is browser *memory*, not storage |
| **Secrets** | None in tracked files; `.env` gitignored and untracked; `PAYMENT_ENCRYPTION_KEY` with a version, credentials decrypted through `revealCredentialsForGateway` |
| **CSRF** | `csrfProtection` closes the simple-form gap for the session cookie; CORS is an explicit allowlist. F-17 is the defence-in-depth gap |
| **Currency safety** | `currency_mismatch` facts are recorded but never applied. Marking an order paid because 100 of *something* arrived is refused outright |

### Findings

- **F-03** — the role/grant/policy model is manual database state (blocker).
- **F-11** — `NODE_ENV=development` leaves the cart cookie without `Secure`.
- **F-17** — the `dc` cookie relies on `SameSite=Lax` alone.
- **F-15** — one unscoped variant read, safe at every current call site.

### Money and pricing — no finding

Examined against every item in §6 of the brief and I could not fault it. Pricing is resolved server-side from `ProductVariant` inside the tenant transaction; `resolveLines()` prices and no longer judges stock, so there is exactly one stock gate; the server cart wins outright over `dto.items` when a cart exists; no client-supplied amount reaches any provider; `quote_total_minor` is one figure that becomes the `PaymentIntent` amount, the amount handed to the provider and the Order total; the ledger posts within the same transactions; and the only path that creates an Order without secured funds is the explicitly-intended offline/COD one, which creates it `UNPAID` with `AWAITING_PAYMENT`. The `quote_hash` seal is computed over the priced result and published as a hash of the *public* id, never the token.

---

## 9. Real-browser / gateway validation gaps

Not one of these is closed by a passing test, and none should be treated as closed.

### Requires real browser validation

1. **Two genuine tabs.** Every two-tab invariant was verified over real HTTP against the real stack — including a completed payment yielding one checkout, one intent, one attempt, one order — but never in an actual browser. No browser automation exists in this environment. Specifically unverified: that the `dc` cookie is actually shared between two tabs of the same browser under the `Path=/api/storefront/<slug>` scope; that the converged 200 response renders the incumbent's `next_action` correctly in tab B; that the §4.3.9 provider-form teardown works against a real Moyasar/Stripe iframe.
2. **The gateway return trip with `SameSite=Lax`.** The cookie must survive the provider's top-level redirect back. This is the reason `Lax` was chosen over `Strict`, and it has not been observed happening.
3. **Back/forward and bfcache after payment.** `payment-browser-evidence/paid-over-stale-history/` holds screenshots from rounds 4b–6, i.e. from **before** Round 8's cart identity shipped. Those results do not describe the current behaviour.
4. **The frontend suite's crashing file (F-08)** — 10 tests never run in any full-suite execution.

### Requires real gateway test-mode validation

5. **Stripe hosted Checkout Session → PaymentIntent resolution.** This is the exact lifecycle Round 10's production fix addresses, and the fix's correctness is asserted only against synthetic facts in `webhook-ingestion.integration.spec.ts`. A real `cs_…` attempt receiving a real early `payment_intent.succeeded` has not been observed end to end.
6. **Webhook redelivery and out-of-order delivery** from a real provider's retry machinery, rather than from a test harness replaying a fact.
7. **Capture / refund / void** against real provider idempotency semantics.
8. **The Moyasar decline-then-retry sequence** that motivated the terminal/non-terminal discriminator, replayed against the fix.
9. **3DS challenge, abandonment and timeout** on a real card.
10. **Apple Pay / STC Pay / mada / Paymob / Kashier** — adapters exist with reports in `3/` and `report/`, none re-validated against the current tree.

### Requires production deployment validation

11. **F-02 in practice** — that `migrate deploy` can build a database at all.
12. **The `dartstore_app` / `dartstore_platform` split** in a real environment (F-03, F-10). Never exercised by any test.
13. **`Secure` cookies under `NODE_ENV=production`** (F-11) — flipping this changes cookie behaviour on the path that carries the cart.
14. **Multi-instance operation.** The outbox dispatcher's `FOR UPDATE SKIP LOCKED` leasing is designed for it and `CheckoutExpiryJob`/`ReconciliationService` guard only in-process re-entry with a `running` boolean. Two instances running the sweeps concurrently is safe by the per-row compare-and-set but has not been observed.

### Requires load testing

15. **The claim under genuine parallelism.** Every concurrency test runs in one Node process against one connection pool; the spec file says so itself. Row locks under sustained contention, lock wait times inside TX1, and `lock_timeout` behaviour on the hot path are unmeasured.
16. **Reconciliation throughput** — 50 intents per 5 minutes is 600/hour, before F-07's starvation.
17. **The expiry sweep** — `BATCH_SIZE = 200` per minute against a real abandonment rate.
18. **Cart table growth** at a 30-day TTL, and whether `sweepExpiredCarts` keeps up.

### Requires operational configuration

19. **Alert routing.** `PaymentsHealthJob` logs `[ledger-invariant]`, `[outbox-dead-letter]`, `[superseded-funds]` and `[outbox-stale]` and routes nothing (A-8). Until something watches those strings, every one of them is a message to an empty room — including `[superseded-funds]`, which means real customer money is held with no order.
20. **`inventory.oversold`** reaches the merchant as a notification. There is no *operator* alert for it.
21. **No reconciliation-lag metric** (F-07).
22. **`OUTBOX_DISPATCHER_ENABLED`, `CART_IDENTITY_ENABLED`, `STOREFRONT_PAYMENT_MODE`, `NODE_ENV`** all need explicit production values and a runbook (F-11, F-12, F-06).

### Requires manual verification

23. **Live database state** (§7) — everything the prior reports assert about Neon, which I could not reach.
24. **The `ROUND9_IMPLEMENTATION_REPORT` §4 vs `FINAL_ROUND8_ROUND9_VERIFICATION` §4 contradiction** about whether the inventory guards are applied to Neon.
25. **Verification fixtures left in the development database** — carts 1–6, checkouts 269/271/272, reservations 238/240/241, intent 352, plus one unused Stripe test-mode Checkout Session (`FINAL_ROUND8_ROUND9_VERIFICATION.md` §7).

---

## 10. Exact final recommendation

## NOT RELEASE READY

### Must be closed before any release

| # | Finding | Effort |
|---|---|---|
| **1** | **F-01** — commit the working tree; confirm all 14 migration directories and all of `src/stores/cart` and `src/stores/inventory` are tracked | Hours |
| **2** | **F-02** — make the migration history replayable from empty: create the roles, issue every grant, create `order_store_isolation`, drop the `__rls_force_probe` statement. Prove it by running `migrate deploy` into an empty container and diffing against `schema.prisma`. Make it a CI gate | 1 day |
| **3** | **F-03** — bring `dartstore_platform_carts_select` and every other grant into migrations; split `CheckoutExpiryJob.run()`'s single `try` so a failure names its half | Hours, with #2 |
| **4** | **F-04** — key the superseded-funds guard on `cart_id` as well as `supersedes_id`: a checkout whose cart is already `converted` to another order must record the money, emit `payment.superseded_funds_detected`, and create no Order. Add the cart-level version of `funds-secured` test 10 | 1–2 days |
| **5** | **F-05** — add `'expired'` to both reservation selections in `checkout-finalizer.service.ts` (:241, :293); add the missing regression test | Hours |
| **6** | **F-06** — decide and document the mode/inventory semantics, and make `heldQuantities()`, `decrementInventory()` and `ORDER_RLS_MODE` agree | 1 day |
| **7** | **F-09** — identify the intermittent integration failure by name over 10 runs and classify it. Do not ship on "green twice" | Hours |

### Should be closed before release

| # | Finding |
|---|---|
| 8 | **F-07** — stop reconciliation being starved; add a lag metric to `PaymentsHealthJob` |
| 9 | **F-10** — build the test database with `migrate deploy` and the real role names (depends on #2) |
| 10 | **F-08** — fix the frontend worker crash so the suite can be a gate |
| 11 | **F-11** — assert `NODE_ENV=production` at boot, or derive `secure` from the scheme |
| 12 | **F-13** — log at `error` around the synchronous-fact apply |
| 13 | Route the four `PaymentsHealthJob` alarms somewhere a human reads (§9.19) |

### May follow the release

F-12 (kill-switch runbook), F-14, F-15, F-16, F-17, F-18, A-9 (the R6 stale-edit residual), P-2 (lint debt).

### On architecture

**No new architecture is warranted, and none is proposed.** The current design is not proven insufficient — it is proven mostly right and incompletely wired. Round 8 built the correct server-side identity for a purchase and Round 5/6 built the correct protection against paying twice for one; F-04 is those two not being connected to each other, and the fix is a second `WHERE` clause, not a redesign. F-05 is a missing enum value. F-06 is one column's scope. F-02 and F-03 are migrations that were never written. Every blocker in this report is a gap in wiring, packaging or record-keeping — not a flaw in the model.

### On the classification of old findings

Nothing here was graded down for being old. F-02, F-03 and F-06 all predate Round 8 and are all graded on what they can still do in production, which is exactly why F-02 and F-03 are blockers rather than "pre-existing". The four entries in §5 are listed as pre-existing because they are genuinely inert or genuinely out of this system's blast radius — not because of their age.

### Once #1–#7 are closed

The verdict becomes **RELEASE READY WITH DOCUMENTED LIMITATIONS**, the limitations being §9 in full: no real-browser two-tab verification, no real gateway test-mode validation, no load testing, and alert routing still to be configured. Those are real and should ship as known gaps with owners — they are not blockers, but they must not be silently dropped either.

---

*This audit modified nothing. `HEAD` remains `e27031d2abed2d417318bbec6bd4f7566c570ac7`; `git status --porcelain` reports the same 382 entries it did at the start, plus this file. No migration was created, no schema changed, no database row, policy or grant was altered, and nothing was committed or pushed. The one database created — a throwaway PostgreSQL 16 container used to prove F-02 — was destroyed; the project's own databases were never written to and, as §7 records, could not even be read.*
