-- 031_program_dashboard.sql
-- Programs become real planning artifacts: gain start_date / target_end_date /
-- objective / manual_health (override slot — runtime health is derived in the
-- /programs/{id}/rollup endpoint). Status enum expands to match the values the
-- frontend already renders badges for (planning, on_hold, cancelled).
-- All statements are idempotent.

-- ── 1. New columns on programs ──────────────────────────────────────────────
ALTER TABLE programs ADD COLUMN IF NOT EXISTS start_date       DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS target_end_date  DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS objective        TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS manual_health    TEXT;

-- manual_health is an optional override; runtime health is derived in the
-- rollup endpoint. NULL means "use derived". Values constrained.
DO $$ BEGIN
  ALTER TABLE programs
    ADD CONSTRAINT programs_manual_health_check
    CHECK (manual_health IS NULL OR manual_health IN ('green','amber','red','not_started'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Expand status enum to match the frontend ─────────────────────────────
-- Old constraint allowed: active|paused|completed|archived
-- Frontend already renders badges for: planning, on_hold, cancelled (page.tsx:81-84)
-- Drop the old check (created in 011) and re-add with the wider set.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  -- The constraint name may differ across environments (Postgres can name it
  -- programs_status_check). Find and drop whichever exists.
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'programs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE programs DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

DO $$ BEGIN
  ALTER TABLE programs
    ADD CONSTRAINT programs_status_check
    CHECK (status IN ('planning','active','paused','on_hold','completed','archived','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
