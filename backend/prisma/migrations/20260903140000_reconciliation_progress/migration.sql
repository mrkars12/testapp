-- ══════════════════════════════════════════════════════════════════
-- RECONCILIATION PROGRESS — stop the sweep starving itself
-- ══════════════════════════════════════════════════════════════════
--
-- `ReconciliationService` is the system's only recovery from a lost or
-- misdelivered webhook. Its own header states the contract: "The system
-- is designed to be correct with every webhook dropped. That claim is
-- only true because this exists."
--
-- It was not true. The sweep selected the 50 OLDEST non-terminal
-- intents on every run, and several perfectly ordinary kinds of intent
-- can sit non-terminal indefinitely without ever being reconcilable:
--
--   * `authorized` under manual capture, waiting days or weeks for the
--     merchant to capture — a legitimate, long-lived business state;
--   * `partially_captured`, for the same reason;
--   * an intent whose latest attempt never got a gateway reference;
--   * an account whose provider has no status polling (cash on
--     delivery, bank transfer).
--
-- Every one of those stays in the result set forever AND stays the
-- oldest. Fifty of them is enough to occupy the entire batch
-- permanently: the sweep then re-reads the same fifty every five
-- minutes and never reaches a newer intent again. It fails silently by
-- construction, because `run()` only logs when it actually processed
-- something, so the count simply stays zero.
--
-- This column is the fix, and it is deliberately the smallest one that
-- works: a progress marker, stamped on EVERY visit rather than only on
-- successful ones. An intent that cannot be processed moves to the back
-- of the queue and is retried on a later pass — never dropped, never
-- resolved to a wrong state, and never able to hold the front.
--
-- What this migration explicitly does NOT do: change any intent's
-- status. Marking a long-lived `authorized` as failed to get it out of
-- the queue would destroy a real authorisation the merchant is still
-- entitled to capture. Manual-capture semantics are untouched.
--
-- Additive: one nullable column and one index. No backfill — NULL
-- already means "never visited", which is exactly right for every
-- existing row and sorts first.

ALTER TABLE "payment_intents"
  ADD COLUMN "last_reconciled_at" TIMESTAMPTZ(6);

-- The sweep's access path: filter on status, order by how long ago the
-- row was last visited.
CREATE INDEX "payment_intents_status_last_reconciled_at_idx"
  ON "payment_intents"("status", "last_reconciled_at");
