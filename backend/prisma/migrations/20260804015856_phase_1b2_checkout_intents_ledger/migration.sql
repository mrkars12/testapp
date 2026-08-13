/*
  Warnings:

  - A unique constraint covering the columns `[checkout_id]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('open', 'pending_payment', 'committed', 'expired', 'abandoned', 'failed');

-- CreateEnum
CREATE TYPE "QuoteComponentKind" AS ENUM ('line_subtotal', 'shipping', 'tax', 'discount', 'payment_fee', 'adjustment');

-- CreateEnum
CREATE TYPE "ReservationState" AS ENUM ('held', 'converted', 'released', 'expired');

-- CreateEnum
CREATE TYPE "PaymentIntentContextKind" AS ENUM ('checkout', 'order_balance', 'subscription_cycle', 'invoice', 'manual');

-- CreateEnum
CREATE TYPE "PaymentIntentUsage" AS ENUM ('one_time', 'setup', 'recurring');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('created', 'requires_payment_method', 'requires_action', 'processing', 'authorized', 'partially_captured', 'captured', 'partially_refunded', 'refunded', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('initialized', 'requires_action', 'processing', 'authorized', 'succeeded', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "NextActionKind" AS ENUM ('none', 'redirect', 'iframe', 'client_sdk', 'reference_code', 'bank_instructions', 'poll');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('revenue', 'platform_fee', 'vendor_share');

-- CreateEnum
CREATE TYPE "BeneficiaryKind" AS ENUM ('store', 'vendor', 'platform');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('psp_receivable', 'offline_receivable', 'cash_collected', 'settled_out', 'sales_revenue', 'refunds_contra', 'psp_fee_expense', 'platform_fee_expense', 'platform_fee_payable', 'disputes_held', 'chargeback_loss', 'fx_conversion', 'suspense');

-- CreateEnum
CREATE TYPE "PostingDirection" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "PaymentEventSource" AS ENUM ('api', 'webhook', 'reconciliation', 'return_url', 'merchant', 'system');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkout_id" BIGINT,
ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "paid_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "checkouts" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'open',
    "customer_name" VARCHAR(160),
    "customer_email" VARCHAR(160),
    "customer_phone" VARCHAR(40),
    "shipping_address" JSONB,
    "currency" VARCHAR(3) NOT NULL,
    "quote_total_minor" BIGINT NOT NULL DEFAULT 0,
    "quote_hash" VARCHAR(64),
    "selected_offering_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "committed_at" TIMESTAMPTZ(6),
    "order_id" BIGINT,
    "client_ip" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_line_items" (
    "id" BIGSERIAL NOT NULL,
    "checkout_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "variant_id" BIGINT,
    "title" VARCHAR(255) NOT NULL,
    "variant_title" VARCHAR(255),
    "image_url" VARCHAR(600),
    "unit_price_minor" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_components" (
    "id" BIGSERIAL NOT NULL,
    "checkout_id" BIGINT NOT NULL,
    "kind" "QuoteComponentKind" NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "source_ref" VARCHAR(120),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" BIGSERIAL NOT NULL,
    "checkout_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" "ReservationState" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "settled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "context_kind" "PaymentIntentContextKind" NOT NULL DEFAULT 'checkout',
    "context_id" VARCHAR(64) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "capture_method" "CaptureMode" NOT NULL DEFAULT 'automatic',
    "usage" "PaymentIntentUsage" NOT NULL DEFAULT 'one_time',
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'created',
    "authorized_total_minor" BIGINT NOT NULL DEFAULT 0,
    "captured_total_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_total_minor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(255),
    "account_id" BIGINT,
    "offering_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6),
    "terminal_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" BIGSERIAL NOT NULL,
    "intent_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "account_id" BIGINT,
    "offering_id" BIGINT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'initialized',
    "authorized_amount_minor" BIGINT,
    "authorization_expires_at" TIMESTAMPTZ(6),
    "gateway_reference" VARCHAR(255),
    "gateway_payment_id" VARCHAR(255),
    "next_action_kind" "NextActionKind" NOT NULL DEFAULT 'none',
    "next_action_payload" JSONB,
    "next_action_expires_at" TIMESTAMPTZ(6),
    "psp_idempotency_key" VARCHAR(255),
    "error_code" VARCHAR(60),
    "error_message_raw" TEXT,
    "request_snapshot" JSONB,
    "response_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captures" (
    "id" BIGSERIAL NOT NULL,
    "intent_id" BIGINT NOT NULL,
    "attempt_id" BIGINT,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'pending',
    "gateway_capture_ref" VARCHAR(255),
    "captured_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_allocations" (
    "id" BIGSERIAL NOT NULL,
    "capture_id" BIGINT NOT NULL,
    "beneficiary_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "kind" "AllocationKind" NOT NULL DEFAULT 'revenue',

    CONSTRAINT "capture_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "kind" "BeneficiaryKind" NOT NULL,
    "external_ref" VARCHAR(120),
    "default_currency" VARCHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "account_type" "LedgerAccountType" NOT NULL,
    "beneficiary_id" BIGINT,
    "payment_account_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "entry_type" VARCHAR(60) NOT NULL,
    "source_kind" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(64) NOT NULL,
    "dedupe_key" VARCHAR(120) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reverses_entry_id" BIGINT,
    "memo" VARCHAR(400),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" BIGSERIAL NOT NULL,
    "entry_id" BIGINT NOT NULL,
    "ledger_account_id" BIGINT NOT NULL,
    "direction" "PostingDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" BIGSERIAL NOT NULL,
    "intent_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "dedupe_key" VARCHAR(120) NOT NULL,
    "source" "PaymentEventSource" NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "superseded_reason" VARCHAR(120),
    "payload_redacted" JSONB,
    "occurred_at" TIMESTAMPTZ(6),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_token_key" ON "checkouts"("token");

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_order_id_key" ON "checkouts"("order_id");

-- CreateIndex
CREATE INDEX "checkouts_store_id_mode_status_idx" ON "checkouts"("store_id", "mode", "status");

-- CreateIndex
CREATE INDEX "checkouts_expires_at_idx" ON "checkouts"("expires_at");

-- CreateIndex
CREATE INDEX "checkouts_store_id_mode_created_at_idx" ON "checkouts"("store_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "checkout_line_items_checkout_id_idx" ON "checkout_line_items"("checkout_id");

-- CreateIndex
CREATE INDEX "quote_components_checkout_id_idx" ON "quote_components"("checkout_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_state_expires_at_idx" ON "inventory_reservations"("state", "expires_at");

-- CreateIndex
CREATE INDEX "inventory_reservations_store_id_mode_variant_id_idx" ON "inventory_reservations"("store_id", "mode", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_checkout_id_variant_id_key" ON "inventory_reservations"("checkout_id", "variant_id");

-- CreateIndex
CREATE INDEX "payment_intents_store_id_mode_status_idx" ON "payment_intents"("store_id", "mode", "status");

-- CreateIndex
CREATE INDEX "payment_intents_context_kind_context_id_idx" ON "payment_intents"("context_kind", "context_id");

-- CreateIndex
CREATE INDEX "payment_intents_status_expires_at_idx" ON "payment_intents"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payment_intents_store_id_mode_created_at_idx" ON "payment_intents"("store_id", "mode", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_store_id_mode_idempotency_key_key" ON "payment_intents"("store_id", "mode", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_attempts_store_id_mode_status_idx" ON "payment_attempts"("store_id", "mode", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_gateway_reference_idx" ON "payment_attempts"("gateway_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_intent_id_sequence_key" ON "payment_attempts"("intent_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_account_id_gateway_reference_key" ON "payment_attempts"("account_id", "gateway_reference");

-- CreateIndex
CREATE INDEX "captures_intent_id_status_idx" ON "captures"("intent_id", "status");

-- CreateIndex
CREATE INDEX "captures_store_id_mode_status_idx" ON "captures"("store_id", "mode", "status");

-- CreateIndex
CREATE INDEX "capture_allocations_capture_id_idx" ON "capture_allocations"("capture_id");

-- CreateIndex
CREATE INDEX "capture_allocations_beneficiary_id_idx" ON "capture_allocations"("beneficiary_id");

-- CreateIndex
CREATE INDEX "beneficiaries_store_id_mode_idx" ON "beneficiaries"("store_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_store_id_mode_kind_external_ref_key" ON "beneficiaries"("store_id", "mode", "kind", "external_ref");

-- CreateIndex
CREATE INDEX "ledger_accounts_store_id_mode_currency_idx" ON "ledger_accounts"("store_id", "mode", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_identity_key" ON "ledger_accounts"("store_id", "mode", "currency", "account_type", "beneficiary_id", "payment_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_dedupe_key_key" ON "journal_entries"("dedupe_key");

-- CreateIndex
CREATE INDEX "journal_entries_store_id_mode_currency_occurred_at_idx" ON "journal_entries"("store_id", "mode", "currency", "occurred_at");

-- CreateIndex
CREATE INDEX "journal_entries_source_kind_source_id_idx" ON "journal_entries"("source_kind", "source_id");

-- CreateIndex
CREATE INDEX "ledger_postings_entry_id_idx" ON "ledger_postings"("entry_id");

-- CreateIndex
CREATE INDEX "ledger_postings_ledger_account_id_idx" ON "ledger_postings"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_dedupe_key_key" ON "payment_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "payment_events_intent_id_recorded_at_idx" ON "payment_events"("intent_id", "recorded_at");

-- CreateIndex
CREATE INDEX "payment_events_store_id_mode_event_type_idx" ON "payment_events"("store_id", "mode", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkout_id_key" ON "Order"("checkout_id");

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_line_items" ADD CONSTRAINT "checkout_line_items_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_components" ADD CONSTRAINT "quote_components_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captures" ADD CONSTRAINT "captures_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_allocations" ADD CONSTRAINT "capture_allocations_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
