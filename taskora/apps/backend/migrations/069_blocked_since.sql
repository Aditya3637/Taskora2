-- 069_blocked_since
-- Stuck-duration: when a task enters 'blocked' we stamp blocked_since; cleared
-- on exit. Powers the "blocked Xd" chip in Work + the duration line in Nudges.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS blocked_since timestamptz;
