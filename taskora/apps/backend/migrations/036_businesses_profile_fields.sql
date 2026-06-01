-- 036_businesses_profile_fields.sql
-- Workspace Profile tab introduces optional identity fields. All nullable —
-- existing code paths never read them, so this is additive and zero-impact
-- on programs/initiatives/tasks/Gantt/analytics. They surface only on the
-- new /workspace/settings/profile page.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS logo_url               TEXT,
  ADD COLUMN IF NOT EXISTS time_zone              TEXT,
  ADD COLUMN IF NOT EXISTS currency               TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month INT;

-- Sanity bound on the month so analytics can trust it later.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_fy_start_month_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_fy_start_month_check
  CHECK (fiscal_year_start_month IS NULL
         OR (fiscal_year_start_month BETWEEN 1 AND 12));
