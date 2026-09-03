-- Checkout succession — identity only.
--
-- A retry does not reopen the checkout that failed; it creates a new one.
-- Nothing recorded which checkout a new one was created to replace, so a
-- browser history entry carrying an older checkout's token resolved that
-- checkout in isolation and rendered its (truthful) failure as the current,
-- actionable state of a purchase that had already been paid for.
--
-- This column records the relation, and nothing else: no payment status, no
-- amount, no order number, no provider data, no secret. It is written once,
-- in the INSERT that creates the successor, and never updated — so it cannot
-- mutate a settled row and two tabs retrying the same failure simply produce
-- two successors, which the read side resolves honestly.
--
-- Deliberately a plain nullable BIGINT with no foreign key, exactly like
-- `checkouts.order_id` above it: same lookup pattern, and no new referential
-- action interacting with the store-level cascade.
--
-- Additive and nullable with no default: no table rewrite, no backfill, and
-- every existing row and every existing query keeps working unchanged.
ALTER TABLE "checkouts" ADD COLUMN "supersedes_id" BIGINT;

-- The reverse lookup this exists for: "which checkout replaced this one?"
CREATE INDEX "checkouts_supersedes_id_idx" ON "checkouts"("supersedes_id");
