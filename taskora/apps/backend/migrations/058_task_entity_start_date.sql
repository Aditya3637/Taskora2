-- 058_task_entity_start_date.sql
-- Per-building/client START date so each entity bar has a real span on the
-- Gantt (task_entities only had per_entity_end_date). Nullable + additive —
-- safe to apply before the new backend ships; rows without it fall back to the
-- task's start in the Gantt builder.

ALTER TABLE public.task_entities
  ADD COLUMN IF NOT EXISTS per_entity_start_date date;

ALTER TABLE public.subtask_entities
  ADD COLUMN IF NOT EXISTS per_entity_start_date date;
