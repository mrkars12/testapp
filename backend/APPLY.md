# Phase 1a — Apply Guide

## Prerequisites (verified against your uploaded files)

⚠️ **Phase 0 has not been applied to your repository.** Your uploaded
`package.json` has no `@nestjs/config`, and `src/common/crypto/` /
`src/common/config/` do not exist. `app.module.ts` in this bundle imports
`CryptoModule`, so the build fails without them.

This bundle therefore includes the Phase 0 crypto files (already reviewed
and F1–F6 fixed). Apply them together with Phase 1a.

Phase 0 items **not** in this bundle because Phase 1a does not depend on
them — apply separately if you still want them:
- `src/auth/jwt.strategy.ts` — remove the `'fallback_secret'` fallback
- `src/stores/store.module.ts` — remove the duplicate `PrismaService` provider
- `src/wallet/wallet.controller.ts` — legacy header comment
- `src/stores/store.service.ts` — `createStore` currency fallback (`'SAR'` → schema default `USD`)

## `prisma/schema.prisma`

**No change needed.** Your uploaded schema already contains the Phase 1a
block (`Mode`, `OutboxStatus`, `IdempotencyStatus`,
`PaymentIdempotencyRecord`, `OutboxMessage`, `ConsumedEvent`) at lines
1080–1209, and it matches the approved design exactly.

## Order of operations

1. Copy `backend/` and `docs/` and `AI_RULES.md` over the repository root.
2. `cd backend && npm install`
3. Set `PAYMENT_ENCRYPTION_KEY` — **the app will not boot without it**:
   `openssl rand -base64 32`
   Confirm `JWT_SECRET` and `FLOW_SECRET` are set in every environment.
4. Migration baseline — **check first**:
   - If `backend/prisma/migrations/` does not exist, baseline before
     migrating, or `prisma migrate dev` may offer to reset the database:
     ```
     mkdir -p prisma/migrations/0_init
     npx prisma migrate diff --from-empty \
       --to-schema-datamodel prisma/schema.prisma --script \
       > prisma/migrations/0_init/migration.sql
     npx prisma migrate resolve --applied 0_init
     ```
     No SQL runs against the database — this only writes history.
5. Back up, then `npx prisma migrate dev --name phase_1a_foundations`.
   Dry-run on a restored copy before `migrate deploy` in production.
6. `npx prisma generate`
7. `npx tsc --noEmit`
8. `npm test` (Docker-free)
9. `npm run test:integration` (requires Docker)

## What runs in production after this

Nothing new. No endpoint, no producer, no consumer. The outbox dispatcher
polls an empty table every 5s; the idempotency purge runs hourly on an
empty table; the tenant guard logs only and is registered against three
models that nothing queries yet. First production use is Phase 1b.
