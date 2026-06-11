-- 055_task_archive.sql
-- Archive/restore for tasks and subtasks (incl. sub-subtasks).
--
-- Product ask: admins/owners can archive a *done* task or subtask out of the
-- active list, view archived items via an inline "show archived" toggle, and
-- restore them. Archiving cascades to children (a task's whole subtask subtree;
-- a parent subtask's sub-subtasks) and restore cascades back.
--
-- Modelling: a nullable `archived_at` timestamp rather than overloading the
-- `status` enum. This keeps archive orthogonal to workflow status, so a
-- restored item automatically reappears with the status it had (always 'done'
-- here, since only done items can be archived), and "show archived" is a plain
-- `archived_at IS NOT NULL` filter. The legacy tasks.status='archived' enum
-- value is left intact for back-compat but is no longer written.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.subtasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Active-list scans filter on archived_at IS NULL; archived views on NOT NULL.
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at
  ON public.tasks(archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subtasks_archived_at
  ON public.subtasks(archived_at)
  WHERE archived_at IS NOT NULL;

-- Backfill: migrate any pre-existing tasks parked in the legacy 'archived'
-- status onto the new model so they surface correctly in the archive view and
-- restore back to a real workflow status.
UPDATE public.tasks
  SET archived_at = COALESCE(archived_at, now()),
      status = 'done'
  WHERE status = 'archived';
