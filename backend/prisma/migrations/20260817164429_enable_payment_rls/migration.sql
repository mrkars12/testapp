-- 1. Cleanup: remove disposable RLS test debris.
--
-- `__rls_force_probe` was a scratch table created by hand in the
-- development database while this policy set was being worked out. It
-- was never created by any migration, so on every database except that
-- one this DROP referred to a table that had never existed and the
-- whole migration — and therefore every migration after it — failed.
-- IF EXISTS keeps the original intent (clear the debris where it is
-- present) and makes the statement a no-op everywhere else.
DROP TABLE IF EXISTS "__rls_force_probe";

-- 2. The Order policy.
--
-- This migration was originally written against a database where RLS on
-- "Order" had already been enabled by hand and `order_store_isolation`
-- already existed, so it only needed to RE-TARGET the policy from PUBLIC
-- to dartstore_app. Neither of those prerequisites was ever expressed in
-- a migration, so on a fresh database the ALTER referred to a policy
-- that did not exist.
--
-- Both halves are now stated here. The expression is the one the
-- application has always relied on and is byte-identical to the one the
-- test harness installs (`test/global-setup.ts`): "Order" carries no
-- `mode` column, so it is scoped by store alone — unlike every
-- payment-side table below, which is scoped by store AND mode.
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    WHERE cls.relname = 'Order' AND pol.polname = 'order_store_isolation'
  ) THEN
    -- The historical path: the policy is already there, only its role
    -- list is wrong. ALTER POLICY ... TO leaves USING/WITH CHECK alone,
    -- which is what the original statement relied on.
    ALTER POLICY order_store_isolation ON "Order" TO dartstore_app;
  ELSE
    -- The fresh-database path.
    CREATE POLICY order_store_isolation ON "Order"
    FOR ALL TO dartstore_app
    USING (
      store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
    )
    WITH CHECK (
      store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
    );
  END IF;
END
$$;

-- 3. Enable Row Level Security on the 17 remaining approved tables.
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_method_offerings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consumed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capture_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;

-- 4. Create the 17 approved policies, all TO dartstore_app.

-- Shape 3: OrderItem (no store_id column; scoped via parent Order).
CREATE POLICY order_item_store_isolation ON "OrderItem"
FOR ALL TO dartstore_app
USING (
  EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderItem".order_id
      AND o.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderItem".order_id
      AND o.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  )
);

-- Shape 1 (store_id and mode), 16 tables.
CREATE POLICY payment_method_offering_store_isolation ON "payment_method_offerings"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY payment_account_store_isolation ON "payment_accounts"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY payment_idempotency_store_isolation ON "payment_idempotency_records"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY outbox_store_isolation ON "outbox_messages"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY consumed_event_store_isolation ON "consumed_events"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY inventory_reservation_store_isolation ON "inventory_reservations"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY payment_intent_store_isolation ON "payment_intents"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY payment_attempt_store_isolation ON "payment_attempts"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY capture_store_isolation ON "captures"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY capture_allocation_store_isolation ON "capture_allocations"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY refund_store_isolation ON "refunds"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY refund_allocation_store_isolation ON "refund_allocations"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY beneficiary_store_isolation ON "beneficiaries"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY ledger_account_store_isolation ON "ledger_accounts"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY journal_entry_store_isolation ON "journal_entries"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

CREATE POLICY payment_event_store_isolation ON "payment_events"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);
