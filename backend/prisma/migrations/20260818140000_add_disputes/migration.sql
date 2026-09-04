-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'won', 'lost');

-- CreateTable
CREATE TABLE "disputes" (
    "id" BIGSERIAL NOT NULL,
    "intent_id" BIGINT NOT NULL,
    "capture_id" BIGINT,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "reason" VARCHAR(120),
    "gateway_dispute_ref" VARCHAR(255),
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_intent_id_status_idx" ON "disputes"("intent_id", "status");

-- CreateIndex
CREATE INDEX "disputes_store_id_mode_status_idx" ON "disputes"("store_id", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_store_id_gateway_dispute_ref_key" ON "disputes"("store_id", "gateway_dispute_ref");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "captures"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row Level Security.
--
-- Not a change to the RLS design: disputes is a tenant table carrying
-- store_id and mode, so it gets exactly the policy shape every other
-- tenant payment table already has (see
-- 20260817164429_enable_payment_rls). Leaving it off would make disputes
-- the one payment table readable across tenants.
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispute_store_isolation ON "disputes"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);
