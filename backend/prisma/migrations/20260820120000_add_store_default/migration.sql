-- Default Store feature: add the column, backfill it safely, then enforce
-- the "at most one default per owner" invariant at the database level.
--
-- Backfill policy (documented, not guessed):
--   * Owners with 0 stores            -> no row to touch, no default.
--   * Owners with exactly 1 store     -> that single store becomes default.
--     There is no ambiguity to resolve: it is the only store the owner has.
--   * Owners with 2+ stores           -> left with is_default = false on
--     every row. The existing GET /stores contract has no ordering
--     guarantee and no prior default concept, so picking one for these
--     owners would be an invented, unauthorized choice. They keep seeing
--     the existing store picker until they explicitly set a default via
--     PATCH /stores/:slug/default.

-- 1. Add the column. Safe default of false — every existing row stays valid.
ALTER TABLE "store" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill: mark the store as default only for owners who have exactly
--    one store. Nothing is deleted or overwritten beyond this new column.
WITH single_store_owners AS (
  SELECT "ownerId"
  FROM "store"
  GROUP BY "ownerId"
  HAVING COUNT(*) = 1
)
UPDATE "store"
SET "is_default" = true
WHERE "ownerId" IN (SELECT "ownerId" FROM single_store_owners);

-- 3. Database-level invariant: at most one default store per owner.
--    A plain boolean column cannot prevent two concurrent "set default"
--    requests from both succeeding on different rows for the same owner;
--    a partial unique index makes that a constraint violation instead.
--    Non-default rows (is_default = false) are excluded from the index,
--    so any number of non-default stores per owner remains unrestricted.
CREATE UNIQUE INDEX "store_owner_default_unique"
ON "store" ("ownerId")
WHERE "is_default" = true;
