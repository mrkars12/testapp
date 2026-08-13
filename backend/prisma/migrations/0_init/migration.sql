-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."MenuItemType" AS ENUM ('HOME', 'SEARCH', 'COLLECTION', 'PRODUCT', 'PAGE', 'BLOG', 'POLICY', 'ORDERS', 'PROFILE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PageType" AS ENUM ('STANDARD', 'PRODUCT_WITH_HERO', 'PRODUCT_WITHOUT_HERO');

-- CreateEnum
CREATE TYPE "public"."PaymentProviderKey" AS ENUM ('cod', 'bank_transfer', 'paymob', 'kashier', 'stripe', 'fawry', 'paypal', 'paytabs', 'moyasar', 'paylink', 'tap', 'tabby', 'taager', 'my_fatoorah', 'fawaterk', 'xpay', 'ziina', 'tamara', 'easykash', 'upay', 'fabmisr');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'UNLISTED');

-- CreateTable
CREATE TABLE "public"."Collection" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "image_key" TEXT,
    "storeId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seo_description" TEXT,
    "seo_title" TEXT,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MenuItem" (
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "id" BIGSERIAL NOT NULL,
    "menu_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "resource_id" BIGINT,
    "type" "public"."MenuItemType" NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "public"."PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payment_method" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "variant_id" BIGINT,
    "title" TEXT NOT NULL,
    "variant_title" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "qty" INTEGER NOT NULL,
    "image_url" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "handle" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_desc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "product_type_id" BIGINT,
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT,
    "charge_tax" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductCollection" (
    "productId" BIGINT NOT NULL,
    "collectionId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId","collectionId")
);

-- CreateTable
CREATE TABLE "public"."ProductImage" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductOption" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "colors" JSONB,
    "display_type" TEXT,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductOptionValue" (
    "id" BIGSERIAL NOT NULL,
    "option_id" BIGINT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductTag" (
    "product_id" BIGINT NOT NULL,
    "tag_id" BIGINT NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("product_id","tag_id")
);

-- CreateTable
CREATE TABLE "public"."ProductType" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductVariant" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(10,2),
    "compare_at_price" DECIMAL(10,2),
    "cost_per_item" DECIMAL(10,2),
    "sku" TEXT,
    "barcode" TEXT,
    "inventory_qty" INTEGER NOT NULL DEFAULT 0,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "continue_selling" BOOLEAN NOT NULL DEFAULT false,
    "option1" TEXT,
    "option2" TEXT,
    "option3" TEXT,
    "image_id" BIGINT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "image_key" TEXT,
    "image_url" TEXT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreMenu" (
    "name" TEXT NOT NULL,
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "handle" TEXT NOT NULL,

    CONSTRAINT "StoreMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StorePage" (
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "public"."PageType" NOT NULL DEFAULT 'STANDARD',
    "content" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,

    CONSTRAINT "StorePage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StorePaymentProvider" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "provider" "public"."PaymentProviderKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_test_mode" BOOLEAN NOT NULL DEFAULT true,
    "credentials_encrypted" TEXT,
    "settings" JSONB DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePaymentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreTheme" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "settings" JSONB,
    "content" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "colors" JSONB NOT NULL DEFAULT '{}',
    "footer" JSONB NOT NULL DEFAULT '{}',
    "header" JSONB NOT NULL DEFAULT '{}',
    "typography" JSONB NOT NULL DEFAULT '{}',
    "menu_id" BIGINT,

    CONSTRAINT "StoreTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreThemePublished" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "theme" JSONB NOT NULL,
    "sections" JSONB NOT NULL,
    "menus" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreThemePublished_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tag" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ThemeSection" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "page_type" TEXT NOT NULL DEFAULT 'home',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Upload" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "store_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attached_type" TEXT,
    "attached_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cache" (
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "expiration" INTEGER NOT NULL,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."cache_locks" (
    "key" VARCHAR(255) NOT NULL,
    "owner" VARCHAR(255) NOT NULL,
    "expiration" INTEGER NOT NULL,

    CONSTRAINT "cache_locks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."device_verification_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "fingerprint" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "ip_address" VARCHAR(255) NOT NULL,
    "user_agent" TEXT NOT NULL,
    "expires_at" TIMESTAMP(0) NOT NULL,
    "used_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "device_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."device_verifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "fingerprint" VARCHAR(255) NOT NULL,
    "ip_address" VARCHAR(255),
    "user_agent" VARCHAR(255),
    "device_name" VARCHAR(255),
    "platform" VARCHAR(255),
    "browser" VARCHAR(255),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(0),
    "last_used_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "code" TEXT NOT NULL,

    CONSTRAINT "device_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."devices" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "fingerprint" VARCHAR(255),
    "browser" VARCHAR(255),
    "ip_address" VARCHAR(255),
    "verification_token" VARCHAR(255),
    "verified_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "last_active_at" TIMESTAMP(0),
    "os" VARCHAR(255),
    "trust_token" VARCHAR(64),
    "session_id" VARCHAR(255),
    "logged_out_at" TIMESTAMP(0),
    "platform" VARCHAR(255),
    "hardware_signature" TEXT,
    "device_name" VARCHAR(255),
    "verification_expires_at" TIMESTAMP(0),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_verifications" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."failed_jobs" (
    "id" BIGSERIAL NOT NULL,
    "uuid" VARCHAR(255) NOT NULL,
    "connection" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "exception" TEXT NOT NULL,
    "failed_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_batches" (
    "id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "total_jobs" INTEGER NOT NULL,
    "pending_jobs" INTEGER NOT NULL,
    "failed_jobs" INTEGER NOT NULL,
    "failed_job_ids" TEXT NOT NULL,
    "options" TEXT,
    "cancelled_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "finished_at" INTEGER,

    CONSTRAINT "job_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" BIGSERIAL NOT NULL,
    "queue" VARCHAR(255) NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" SMALLINT NOT NULL,
    "reserved_at" INTEGER,
    "available_at" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."login_blocks" (
    "id" BIGSERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,

    CONSTRAINT "login_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."migrations" (
    "id" SERIAL NOT NULL,
    "migration" VARCHAR(255) NOT NULL,
    "batch" INTEGER NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "type" VARCHAR(255) NOT NULL DEFAULT 'system',
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSON,
    "read_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_providers" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_id" VARCHAR(255) NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(0),
    "profile_data" JSON,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "oauth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "email" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(0),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "public"."personal_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "tokenable_type" VARCHAR(255) NOT NULL,
    "tokenable_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "abilities" TEXT,
    "last_used_at" TIMESTAMP(0),
    "expires_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."security_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "event" VARCHAR(255) NOT NULL,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" VARCHAR(255) NOT NULL,
    "user_id" BIGINT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "payload" TEXT NOT NULL,
    "last_activity" INTEGER NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store" (
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "logo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ownerId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" BIGINT NOT NULL DEFAULT 1,
    "id" BIGSERIAL NOT NULL,
    "description" TEXT,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."trusted_devices" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "device_fingerprint" VARCHAR(255) NOT NULL,
    "ip_address" VARCHAR(255),
    "user_agent" TEXT,
    "device_name" VARCHAR(255),
    "last_login_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_devices" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "device_token" UUID NOT NULL,
    "fingerprint" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "platform" VARCHAR(255),
    "browser" VARCHAR(255),
    "type" VARCHAR(255),
    "browser_version" VARCHAR(255),
    "ip_address" VARCHAR(255) NOT NULL,
    "location" JSON,
    "is_trusted" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(0),
    "last_login_at" TIMESTAMP(0),
    "last_activity_at" TIMESTAMP(0),
    "logged_out_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "deleted_at" TIMESTAMP(0),
    "session_id" VARCHAR(255),

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" BIGSERIAL NOT NULL,
    "fullname" VARCHAR(255),
    "username" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "email_verified_at" TIMESTAMP(0),
    "password" VARCHAR(255) NOT NULL,
    "country" VARCHAR(255),
    "country_code" VARCHAR(10),
    "mobile_code" VARCHAR(10),
    "avatar" VARCHAR(255),
    "business_name" VARCHAR(255),
    "completed_trade" INTEGER NOT NULL DEFAULT 0,
    "rating" REAL NOT NULL DEFAULT 0,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "remember_token" VARCHAR(100),
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),
    "entity_type" CHAR(255),
    "email_verification_token" VARCHAR(64),
    "email_verification_expires_at" TIMESTAMP(0),
    "accounttype" VARCHAR(255) NOT NULL DEFAULT 'individual',
    "email_otp" VARCHAR(255),
    "email_otp_expires_at" TIMESTAMP(0),
    "email_otp_attempts" SMALLINT NOT NULL DEFAULT 0,
    "email_otp_last_sent_at" TIMESTAMP(0),
    "account_locked_until" TIMESTAMP(0),
    "email_otp_blocked_until" TIMESTAMPTZ(0),
    "email_otp_resend_attempts" INTEGER NOT NULL DEFAULT 0,
    "two_factor_secret" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_confirmed_at" TIMESTAMP(0),
    "session_id" VARCHAR(255),
    "login_attempts" SMALLINT NOT NULL DEFAULT 0,
    "login_locked_until" TIMESTAMP(0),
    "last_login_attempt_at" TIMESTAMP(0),
    "timezone" VARCHAR(255) NOT NULL DEFAULT 'UTC',
    "last_activity_at" TIMESTAMP(0),
    "password_reset_expires_at" TIMESTAMP(0),
    "password_reset_code" VARCHAR(255),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallets" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" VARCHAR(5) NOT NULL DEFAULT 'USDDC',
    "created_at" TIMESTAMP(0),
    "updated_at" TIMESTAMP(0),

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_storeId_handle_key" ON "public"."Collection"("storeId" ASC, "handle" ASC);

-- CreateIndex
CREATE INDEX "Order_store_id_idx" ON "public"."Order"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_store_id_order_number_key" ON "public"."Order"("store_id" ASC, "order_number" ASC);

-- CreateIndex
CREATE INDEX "Order_store_id_status_idx" ON "public"."Order"("store_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Product_deleted_at_idx" ON "public"."Product"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "Product_product_type_id_idx" ON "public"."Product"("product_type_id" ASC);

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "public"."Product"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Product_store_id_handle_key" ON "public"."Product"("store_id" ASC, "handle" ASC);

-- CreateIndex
CREATE INDEX "Product_store_id_idx" ON "public"."Product"("store_id" ASC);

-- CreateIndex
CREATE INDEX "ProductImage_product_id_idx" ON "public"."ProductImage"("product_id" ASC);

-- CreateIndex
CREATE INDEX "ProductOption_product_id_idx" ON "public"."ProductOption"("product_id" ASC);

-- CreateIndex
CREATE INDEX "ProductOptionValue_option_id_idx" ON "public"."ProductOptionValue"("option_id" ASC);

-- CreateIndex
CREATE INDEX "ProductTag_tag_id_idx" ON "public"."ProductTag"("tag_id" ASC);

-- CreateIndex
CREATE INDEX "ProductType_store_id_idx" ON "public"."ProductType"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_store_id_name_key" ON "public"."ProductType"("store_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "ProductVariant_product_id_idx" ON "public"."ProductVariant"("product_id" ASC);

-- CreateIndex
CREATE INDEX "ProductVariant_sku_idx" ON "public"."ProductVariant"("sku" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StoreMenu_handle_key" ON "public"."StoreMenu"("handle" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StorePage_store_id_slug_key" ON "public"."StorePage"("store_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "StorePaymentProvider_store_id_idx" ON "public"."StorePaymentProvider"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StorePaymentProvider_store_id_provider_key" ON "public"."StorePaymentProvider"("store_id" ASC, "provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StoreTheme_store_id_key" ON "public"."StoreTheme"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StoreThemePublished_store_id_key" ON "public"."StoreThemePublished"("store_id" ASC);

-- CreateIndex
CREATE INDEX "Tag_store_id_idx" ON "public"."Tag"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_store_id_name_key" ON "public"."Tag"("store_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "ThemeSection_store_id_page_type_sort_order_idx" ON "public"."ThemeSection"("store_id" ASC, "page_type" ASC, "sort_order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_key_key" ON "public"."Upload"("key" ASC);

-- CreateIndex
CREATE INDEX "Upload_status_created_at_idx" ON "public"."Upload"("status" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "Upload_store_id_idx" ON "public"."Upload"("store_id" ASC);

-- CreateIndex
CREATE INDEX "cache_expiration_index" ON "public"."cache"("expiration" ASC);

-- CreateIndex
CREATE INDEX "cache_locks_expiration_index" ON "public"."cache_locks"("expiration" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "device_verification_tokens_token_unique" ON "public"."device_verification_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "device_verifications_fingerprint_index" ON "public"."device_verifications"("fingerprint" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "device_verifications_user_id_fingerprint_unique" ON "public"."device_verifications"("user_id" ASC, "fingerprint" ASC);

-- CreateIndex
CREATE INDEX "devices_fingerprint_index" ON "public"."devices"("fingerprint" ASC);

-- CreateIndex
CREATE INDEX "devices_session_id_index" ON "public"."devices"("session_id" ASC);

-- CreateIndex
CREATE INDEX "email_verifications_email_index" ON "public"."email_verifications"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "failed_jobs_uuid_unique" ON "public"."failed_jobs"("uuid" ASC);

-- CreateIndex
CREATE INDEX "jobs_queue_index" ON "public"."jobs"("queue" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "login_blocks_fingerprint_key" ON "public"."login_blocks"("fingerprint" ASC);

-- CreateIndex
CREATE INDEX "notifications_type_index" ON "public"."notifications"("type" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_index" ON "public"."notifications"("user_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_providers_provider_provider_id_key" ON "public"."oauth_providers"("provider" ASC, "provider_id" ASC);

-- CreateIndex
CREATE INDEX "oauth_providers_user_id_idx" ON "public"."oauth_providers"("user_id" ASC);

-- CreateIndex
CREATE INDEX "personal_access_tokens_expires_at_index" ON "public"."personal_access_tokens"("expires_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_unique" ON "public"."personal_access_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "personal_access_tokens_tokenable_type_tokenable_id_index" ON "public"."personal_access_tokens"("tokenable_type" ASC, "tokenable_id" ASC);

-- CreateIndex
CREATE INDEX "sessions_last_activity_index" ON "public"."sessions"("last_activity" ASC);

-- CreateIndex
CREATE INDEX "sessions_user_id_index" ON "public"."sessions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "store_customDomain_key" ON "public"."store"("customDomain" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "store_slug_key" ON "public"."store"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_user_id_device_fingerprint_unique" ON "public"."trusted_devices"("user_id" ASC, "device_fingerprint" ASC);

-- CreateIndex
CREATE INDEX "trusted_devices_user_id_last_login_at_index" ON "public"."trusted_devices"("user_id" ASC, "last_login_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_device_token_unique" ON "public"."user_devices"("device_token" ASC);

-- CreateIndex
CREATE INDEX "user_devices_fingerprint_idx" ON "public"."user_devices"("fingerprint" ASC);

-- CreateIndex
CREATE INDEX "user_devices_fingerprint_index" ON "public"."user_devices"("fingerprint" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_device_token_unique" ON "public"."user_devices"("user_id" ASC, "device_token" ASC);

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "public"."user_devices"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_devices_user_id_index" ON "public"."user_devices"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_users_accounttype" ON "public"."users"("accounttype" ASC);

-- CreateIndex
CREATE INDEX "idx_users_email" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "idx_users_email_verified" ON "public"."users"("email" ASC, "email_verified_at" ASC);

-- CreateIndex
CREATE INDEX "idx_users_username" ON "public"."users"("username" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_session_id_index" ON "public"."users"("session_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_unique" ON "public"."users"("username" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "public"."wallets"("user_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."Collection" ADD CONSTRAINT "Collection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MenuItem" ADD CONSTRAINT "MenuItem_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "public"."StoreMenu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MenuItem" ADD CONSTRAINT "MenuItem_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."ProductType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "public"."Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductImage" ADD CONSTRAINT "ProductImage_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductOption" ADD CONSTRAINT "ProductOption_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductTag" ADD CONSTRAINT "ProductTag_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductTag" ADD CONSTRAINT "ProductTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductType" ADD CONSTRAINT "ProductType_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductVariant" ADD CONSTRAINT "ProductVariant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreMenu" ADD CONSTRAINT "StoreMenu_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorePage" ADD CONSTRAINT "StorePage_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorePaymentProvider" ADD CONSTRAINT "StorePaymentProvider_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreTheme" ADD CONSTRAINT "StoreTheme_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ThemeSection" ADD CONSTRAINT "ThemeSection_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."device_verification_tokens" ADD CONSTRAINT "device_verification_tokens_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."device_verifications" ADD CONSTRAINT "device_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."devices" ADD CONSTRAINT "devices_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."oauth_providers" ADD CONSTRAINT "oauth_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."store" ADD CONSTRAINT "store_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_devices" ADD CONSTRAINT "user_devices_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "1" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

