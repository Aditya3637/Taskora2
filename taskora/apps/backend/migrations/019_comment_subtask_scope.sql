-- 019_comment_subtask_scope.sql
-- Comments can now be scoped to three levels:
--   task-level    : entity_id IS NULL AND subtask_id IS NULL
--   entity-level  : entity_id  IS NOT NULL  (building/client row)
--   subtask-level : subtask_id IS NOT NULL  (subtask or sub-subtask)
-- A comment belongs to at most one of entity / subtask.

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS subtask_id uuid
  REFERENCES public.subtasks(id) ON DELETE CASCADE;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_single_scope;
ALTER TABLE public.comments ADD CONSTRAINT comments_single_scope
  CHECK (entity_id IS NULL OR subtask_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_comments_subtask
  ON public.comments (subtask_id)
  WHERE subtask_id IS NOT NULL;

-- Supports the task-level thread query (both scopes NULL).
CREATE INDEX IF NOT EXISTS idx_comments_task_level
  ON public.comments (task_id, created_at)
  WHERE entity_id IS NULL AND subtask_id IS NULL;
