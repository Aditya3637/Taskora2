-- 015_status_normalization.sql
-- Single source of truth for task / subtask / entity statuses.
-- Subtasks previously only allowed (backlog, todo, in_progress, done) which made
-- it impossible to mark a checklist item as blocked or pending_decision — gaps
-- that matter at founders-office scale.

-- Expand subtasks.status to include the same operational states tasks have
-- (minus archived — sub-tasks aren't archived independently of their task).
ALTER TABLE public.subtasks DROP CONSTRAINT IF EXISTS subtasks_status_check;
ALTER TABLE public.subtasks ADD CONSTRAINT subtasks_status_check
  CHECK (status IN ('backlog','todo','in_progress','pending_decision','blocked','done'));

-- Same expansion for the per-entity subtask state.
ALTER TABLE public.subtask_entities DROP CONSTRAINT IF EXISTS subtask_entities_per_entity_status_check;
ALTER TABLE public.subtask_entities ADD CONSTRAINT subtask_entities_per_entity_status_check
  CHECK (per_entity_status IN ('backlog','todo','in_progress','pending_decision','blocked','done'));
