-- 016_subtask_nesting.sql
-- B1: Adds parent_subtask_id so subtasks can have children (Task → Subtask → Sub-subtask).
-- ON DELETE CASCADE means removing a parent removes its subtree.

ALTER TABLE public.subtasks
  ADD COLUMN IF NOT EXISTS parent_subtask_id uuid
  REFERENCES public.subtasks(id) ON DELETE CASCADE;

-- A subtask cannot be its own parent. Cycle prevention beyond depth-1 is
-- enforced at the application layer (we cap nesting depth there too).
ALTER TABLE public.subtasks DROP CONSTRAINT IF EXISTS subtasks_not_self_parent;
ALTER TABLE public.subtasks ADD CONSTRAINT subtasks_not_self_parent
  CHECK (parent_subtask_id IS NULL OR parent_subtask_id <> id);

CREATE INDEX IF NOT EXISTS idx_subtasks_parent
  ON public.subtasks(parent_subtask_id)
  WHERE parent_subtask_id IS NOT NULL;
