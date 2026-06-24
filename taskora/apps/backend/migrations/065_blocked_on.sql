-- 065_blocked_on.sql  (G6)
-- A blocked task can name the person it's waiting on, so the "blocked"
-- notification reaches whoever can actually unblock it (not just watchers +
-- the initiative owner). Additive + nullable.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS blocked_on_user_id uuid
  REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_blocked_on
  ON public.tasks (blocked_on_user_id) WHERE blocked_on_user_id IS NOT NULL;
