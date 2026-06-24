-- 066_baseline_dates.sql  (G5 baseline-vs-actual)
-- Snapshot the plan so the Gantt can show drift. baseline_* is set at creation
-- and never auto-changed; the actual start/due moves, the baseline stays put.
-- Backfill existing rows to their CURRENT dates so drift-tracking starts now
-- (no false historical drift). Additive + nullable.

ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS baseline_start_date date;
ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS baseline_end_date date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS baseline_start_date date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS baseline_due_date date;

UPDATE public.initiatives
   SET baseline_start_date = start_date, baseline_end_date = target_end_date
 WHERE baseline_start_date IS NULL;
UPDATE public.tasks
   SET baseline_start_date = start_date, baseline_due_date = due_date
 WHERE baseline_start_date IS NULL;
