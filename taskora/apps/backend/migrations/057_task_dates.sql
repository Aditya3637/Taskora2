-- 057_task_dates.sql
-- Give tasks a real planned SPAN (start_date + end) so they render as proper
-- bars on the Gantt, and let subtasks carry an optional span too.
--
-- Tasks historically had only `due_date` (the end, nullable). Program/initiative
-- planning needs a start as well, and the product decision is that task dates
-- are MANDATORY (like initiatives, mig 056): start_date + due_date NOT NULL and
-- ordered. `due_date` stays the end-of-task date. No per_entity tasks exist in
-- prod, so the task-level due_date is unambiguous.
--
-- Subtasks (mig 039 gave them due_date) get an optional start_date — a subtask
-- shows a bar only when both are set; otherwise it renders as a label row.

ALTER TABLE public.tasks    ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.subtasks ADD COLUMN IF NOT EXISTS start_date date;

-- Backfill task start from the owning initiative's start (every initiative has
-- one since 056); fall back to the row's creation date.
UPDATE public.tasks t
   SET start_date = i.start_date
  FROM public.initiatives i
 WHERE t.initiative_id = i.id AND t.start_date IS NULL;
UPDATE public.tasks
   SET start_date = created_at::date
 WHERE start_date IS NULL;

-- Backfill null task due from the initiative's target end; fall back to start.
UPDATE public.tasks t
   SET due_date = i.target_end_date
  FROM public.initiatives i
 WHERE t.initiative_id = i.id AND t.due_date IS NULL;
UPDATE public.tasks
   SET due_date = start_date
 WHERE due_date IS NULL;

-- Guarantee end >= start before enforcing the invariant.
UPDATE public.tasks
   SET due_date = start_date
 WHERE due_date < start_date;

ALTER TABLE public.tasks ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN due_date   SET NOT NULL;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_dates_ordered_check;
ALTER TABLE public.tasks ADD  CONSTRAINT tasks_dates_ordered_check
  CHECK (due_date >= start_date);
