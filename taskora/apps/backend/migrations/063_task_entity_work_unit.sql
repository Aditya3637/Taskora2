-- 063_task_entity_work_unit.sql
-- Building/client = a full work unit: give each per-entity row its own owner,
-- priority and short description (it already had status/dates/closure/approval/
-- subtasks/watchers/remarks/date-log). Per-building plan-docs are handled by
-- the entity parent_type from migration 061. All additive + nullable.

ALTER TABLE public.task_entities ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.task_entities ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE public.task_entities ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_task_entities_owner
  ON public.task_entities (owner_id) WHERE owner_id IS NOT NULL;
