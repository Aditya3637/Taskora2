-- 014_entity_comments_index.sql
-- Adds a composite index to support the entity-scoped comment query pattern:
--   SELECT ... FROM comments WHERE task_id = ? AND entity_id = ?
-- The existing index on (task_id) alone would scan all comments for the task
-- before filtering by entity_id; this makes that lookup O(1).

CREATE INDEX IF NOT EXISTS idx_comments_task_entity
  ON public.comments (task_id, entity_id);
