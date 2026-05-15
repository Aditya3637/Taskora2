-- 020_closure_and_entity_datelog.sql
-- 1) closed_at: automatic closure timestamp set when status -> 'done',
--    cleared when moved back. Applies to tasks, subtasks, and per-entity rows.
-- 2) task_date_change_log gains entity_id so per-entity due-date changes
--    (task_entities.per_entity_end_date) are tracked alongside task/subtask.

ALTER TABLE public.tasks         ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.subtasks      ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.task_entities ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE public.task_date_change_log
  ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS idx_date_change_entity
  ON public.task_date_change_log (task_id, entity_id)
  WHERE entity_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
