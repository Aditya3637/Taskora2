-- 068_optional_dates
-- Deck decision: "Mandatory-date gate → optional + timeline nudge (undated
-- tray)". Reverses the NOT NULL added in 056 (initiatives) / 057 (tasks) so
-- capture is optional again. Relaxing a constraint is safe for existing data
-- (every current row already has dates). The end>=start CHECK stays — in
-- Postgres it evaluates to UNKNOWN (passes) when either side is NULL, so
-- partially-dated rows are allowed.
ALTER TABLE public.tasks        ALTER COLUMN start_date     DROP NOT NULL;
ALTER TABLE public.tasks        ALTER COLUMN due_date       DROP NOT NULL;
ALTER TABLE public.initiatives  ALTER COLUMN start_date     DROP NOT NULL;
ALTER TABLE public.initiatives  ALTER COLUMN target_end_date DROP NOT NULL;
