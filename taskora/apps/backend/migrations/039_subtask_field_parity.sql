-- 039_subtask_field_parity.sql
-- P2: Subtask field parity with tasks. Adds due_date, description, and
-- priority so "subtask = task" can be sold visually + in UX. All additive,
-- nullable / default-medium. Existing rows unchanged. Idempotent.

ALTER TABLE public.subtasks
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- Match the tasks.priority CHECK so the field behaves identically.
ALTER TABLE public.subtasks
  DROP CONSTRAINT IF EXISTS subtasks_priority_check;
ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_priority_check
  CHECK (priority IN ('low','medium','high','urgent'));

-- "Subtasks due in the next 14 days" / overdue queries.
CREATE INDEX IF NOT EXISTS idx_subtasks_due_date ON public.subtasks(due_date);
