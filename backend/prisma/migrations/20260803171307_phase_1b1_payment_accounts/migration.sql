/*
  Warnings:

  - You are about to drop the `StorePaymentProvider` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentMethodKey" AS ENUM ('card', 'mada', 'knet', 'benefit', 'apple_pay', 'google_pay', 'wallet', 'kiosk', 'bank_transfer', 'cod', 'bnpl');

-- CreateEnum
CREATE TYPE "OwnershipModel" AS ENUM ('merchant_credentials', 'platform_managed');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('draft', 'verifying', 'active', 'disabled', 'errored');

-- CreateEnum
CREATE TYPE "CommitmentKind" AS ENUM ('funds_secured', 'promise_accepted', 'awaiting_offline_settlement');

-- CreateEnum
CREATE TYPE "CaptureMode" AS ENUM ('automatic', 'manual');

-- DropForeignKey
ALTER TABLE "StorePaymentProvider" DROP CONSTRAINT "StorePaymentProvider_store_id_fkey";

-- DropTable
DROP TABLE "StorePaymentProvider";

-- CreateTable
CREATE TABLE "payment_method_offerings" (
    "id" BIGSERIAL NOT NULL,
    "account_id" BIGINT NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "method" "PaymentMethodKey" NOT NULL,
    "gateway_method_config" VARCHAR(255) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "display_name_ar" VARCHAR(120),
    "display_name_en" VARCHAR(120),
    "constraints" JSONB,
    "commitment_kind" "CommitmentKind" NOT NULL DEFAULT 'funds_secured',
    "capture_mode" "CaptureMode" NOT NULL DEFAULT 'automatic',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_method_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    "gateway" "PaymentProviderKey" NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "ownership_model" "OwnershipModel" NOT NULL DEFAULT 'merchant_credentials',
    "connected_account_ref" VARCHAR(255),
    "credentials_envelope" TEXT,
    "credential_kek_version" INTEGER,
    "credential_dek_version" INTEGER,
    "credentials_fingerprint" VARCHAR(64),
    "credentials_hint" JSONB,
    "settlement_currency" VARCHAR(3),
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'draft',
    "last_verified_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_method_offerings_store_id_mode_idx" ON "payment_method_offerings"("store_id", "mode");

-- CreateIndex
CREATE INDEX "payment_method_offerings_account_id_idx" ON "payment_method_offerings"("account_id");

-- CreateIndex
CREATE INDEX "payment_method_offerings_store_id_mode_enabled_position_idx" ON "payment_method_offerings"("store_id", "mode", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_offerings_account_id_method_gateway_method_c_key" ON "payment_method_offerings"("account_id", "method", "gateway_method_config");

-- CreateIndex
CREATE INDEX "payment_accounts_store_id_mode_idx" ON "payment_accounts"("store_id", "mode");

-- CreateIndex
CREATE INDEX "payment_accounts_store_id_mode_status_idx" ON "payment_accounts"("store_id", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_store_id_mode_gateway_display_name_key" ON "payment_accounts"("store_id", "mode", "gateway", "display_name");

-- AddForeignKey
ALTER TABLE "payment_method_offerings" ADD CONSTRAINT "payment_method_offerings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "payment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
