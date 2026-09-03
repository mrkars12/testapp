-- Durable record of every inbound provider callback.
--
-- Platform-scoped by nature: a webhook arrives carrying only a payment
-- account id, so the owning store is not known at insert time. Written
-- through the platform connection, exactly like the account lookup that
-- resolves the tenant. store_id / mode are audit columns filled in once
-- the account is resolved, not an access boundary — which is why this
-- table is not part of the tenant RLS set.
--
-- The raw body is intentionally NOT stored. A payment callback carries
-- customer data; body_sha256 proves which bytes arrived without keeping
-- them, and payload_redacted follows the same policy as payment_events.
CREATE TABLE "webhook_events" (
    "id" BIGSERIAL NOT NULL,
    "gateway" VARCHAR(40) NOT NULL,
    "account_id" BIGINT NOT NULL,
    "store_id" BIGINT,
    "mode" "Mode",
    "provider_event_id" VARCHAR(255),
    "event_type" VARCHAR(100),
    "status" VARCHAR(40) NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" VARCHAR(60),
    "body_sha256" VARCHAR(64) NOT NULL,
    "body_bytes" INTEGER NOT NULL,
    "payload_redacted" JSONB,
    "fact_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- The deduplication guarantee. Postgres treats each NULL as distinct, so
-- rows that never reached a verified event id (a rejected signature, say)
-- do not collide with each other.
CREATE UNIQUE INDEX "webhook_events_account_id_provider_event_id_key"
    ON "webhook_events"("account_id", "provider_event_id");

CREATE INDEX "webhook_events_account_id_received_at_idx"
    ON "webhook_events"("account_id", "received_at");

CREATE INDEX "webhook_events_status_received_at_idx"
    ON "webhook_events"("status", "received_at");
