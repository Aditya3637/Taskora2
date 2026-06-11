-- 056_initiative_dates_required.sql
-- Make initiative start_date + target_end_date MANDATORY.
--
-- Program-level / yearly planning needs every initiative to occupy a real
-- span on the timeline, and the initiative end becomes the bound we check
-- task/subtask due dates against. Historically both columns were nullable
-- (the "no planned start" decision), so ~31–34 of 38 live rows are null and
-- must be backfilled with smart defaults before NOT NULL can be enforced.
--
-- Backfill (placeholders an admin can edit via the now-required date fields):
--   start_date      := creation date
--   target_end_date := latest task due-date under the initiative,
--                      else the parent program's target end,
--                      else start + 90 days
-- then clamp any end < start (covers both backfilled and pre-existing manual
-- rows) so the >= invariant holds before the CHECK is added.

-- 1. start_date <- creation date
UPDATE public.initiatives
   SET start_date = created_at::date
 WHERE start_date IS NULL;

-- 2. target_end_date <- max child task due-date / program end / start + 90d
UPDATE public.initiatives i
   SET target_end_date = COALESCE(
         (SELECT max(t.due_date) FROM public.tasks t WHERE t.initiative_id = i.id),
         (SELECT p.target_end_date FROM public.programs p WHERE p.id = i.program_id),
         i.start_date + 90
       )
 WHERE i.target_end_date IS NULL;

-- 3. Guarantee end >= start everywhere (clamp inversions).
UPDATE public.initiatives
   SET target_end_date = start_date
 WHERE target_end_date < start_date;

-- 4. Enforce going forward.
ALTER TABLE public.initiatives ALTER COLUMN start_date      SET NOT NULL;
ALTER TABLE public.initiatives ALTER COLUMN target_end_date SET NOT NULL;

ALTER TABLE public.initiatives DROP CONSTRAINT IF EXISTS initiatives_dates_ordered_check;
ALTER TABLE public.initiatives ADD  CONSTRAINT initiatives_dates_ordered_check
  CHECK (target_end_date >= start_date);
