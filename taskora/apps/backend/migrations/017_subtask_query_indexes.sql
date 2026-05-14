-- 017_subtask_query_indexes.sql
-- B4: Index supporting the single-query subtask fetch:
--   SELECT ... FROM subtasks WHERE task_id = ? ORDER BY created_at
-- with a secondary group-by on scoped_entity_id in the application.
-- Existing index on (task_id) alone already covers this, but a composite
-- (task_id, scoped_entity_id) makes the per-entity filter (used by
-- /tasks/{id}/subtasks?for_entity=X) an index-only scan.

CREATE INDEX IF NOT EXISTS idx_subtasks_task_entity
  ON public.subtasks(task_id, scoped_entity_id);
