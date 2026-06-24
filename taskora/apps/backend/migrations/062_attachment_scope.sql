-- 062_attachment_scope.sql
-- Per-building / per-subtask files. `attachments` stays task-anchored (task_id
-- NOT NULL) but can now be scoped to one building/client (entity_id) or one
-- subtask (subtask_id) within that task. Additive + nullable. entity_id is
-- polymorphic (building or client id) like task_entities.entity_id — no FK.

ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS subtask_id uuid
  REFERENCES public.subtasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON public.attachments (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_subtask
  ON public.attachments (subtask_id) WHERE subtask_id IS NOT NULL;
