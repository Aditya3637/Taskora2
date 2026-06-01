-- 032_tasks_created_by.sql
-- Adds a creator column so members can see tasks they created even if they're
-- no longer in task_stakeholders. Needed by the new visibility scoping where
-- "tasks aligned to me" = (primary on initiative) OR (in task_stakeholders) OR
-- (created the task). All statements are idempotent.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by) WHERE created_by IS NOT NULL;

-- Best-effort backfill: for legacy rows (created before this column existed),
-- assume the original primary_stakeholder is the closest proxy for creator.
-- Safe to run multiple times — only fills NULLs.
UPDATE tasks
   SET created_by = primary_stakeholder_id
 WHERE created_by IS NULL
   AND primary_stakeholder_id IS NOT NULL;
