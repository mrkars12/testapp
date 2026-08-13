-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('test', 'live');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'claimed', 'published', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('in_flight', 'completed', 'failed');

-- CreateTable
CREATE TABLE "payment_idempotency_records" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'in_flight',
    "response_status_code" INTEGER,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "claimed_by" VARCHAR(100),
    "claim_expires_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumed_events" (
    "id" BIGSERIAL NOT NULL,
    "consumer_name" VARCHAR(100) NOT NULL,
    "message_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" VARCHAR(255),

    CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_idempotency_records_expires_at_idx" ON "payment_idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "payment_idempotency_records_store_id_mode_idx" ON "payment_idempotency_records"("store_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotency_records_store_id_mode_scope_idempotency_key" ON "payment_idempotency_records"("store_id", "mode", "scope", "idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_messages_aggregate_type_aggregate_id_idx" ON "outbox_messages"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_messages_store_id_mode_idx" ON "outbox_messages"("store_id", "mode");

-- CreateIndex
CREATE INDEX "outbox_messages_created_at_idx" ON "outbox_messages"("created_at");

-- CreateIndex
CREATE INDEX "consumed_events_message_id_idx" ON "consumed_events"("message_id");

-- CreateIndex
CREATE INDEX "consumed_events_store_id_mode_idx" ON "consumed_events"("store_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "consumed_events_consumer_name_message_id_key" ON "consumed_events"("consumer_name", "message_id");

-- AddForeignKey
ALTER TABLE "consumed_events" ADD CONSTRAINT "consumed_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "outbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
