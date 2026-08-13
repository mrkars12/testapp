-- CreateEnum
CREATE TYPE "StorePaymentMode" AS ENUM ('MERCHANT_GATEWAY', 'MERCHANT_MOR');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RefundInitiator" AS ENUM ('merchant', 'customer', 'provider', 'system');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "payment_intents" ADD COLUMN     "payment_mode" "StorePaymentMode" NOT NULL DEFAULT 'MERCHANT_GATEWAY';

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "payment_mode" "StorePaymentMode" NOT NULL DEFAULT 'MERCHANT_GATEWAY';

-- CreateTable
CREATE TABLE "refunds" (
    "id" BIGSERIAL NOT NULL,
    "intent_id" BIGINT NOT NULL,
    "capture_id" BIGINT,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "initiated_by" "RefundInitiator" NOT NULL DEFAULT 'merchant',
    "reason" VARCHAR(400),
    "gateway_refund_ref" VARCHAR(255),
    "idempotency_key" VARCHAR(255),
    "failure_code" VARCHAR(60),
    "succeeded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_allocations" (
    "id" BIGSERIAL NOT NULL,
    "refund_id" BIGINT NOT NULL,
    "beneficiary_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "kind" "AllocationKind" NOT NULL DEFAULT 'revenue',

    CONSTRAINT "refund_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_intent_id_status_idx" ON "refunds"("intent_id", "status");

-- CreateIndex
CREATE INDEX "refunds_store_id_mode_created_at_idx" ON "refunds"("store_id", "mode", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_store_id_mode_idempotency_key_key" ON "refunds"("store_id", "mode", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_store_id_gateway_refund_ref_key" ON "refunds"("store_id", "gateway_refund_ref");

-- CreateIndex
CREATE INDEX "refund_allocations_refund_id_idx" ON "refund_allocations"("refund_id");

-- CreateIndex
CREATE INDEX "refund_allocations_beneficiary_id_idx" ON "refund_allocations"("beneficiary_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "captures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
