-- 022_approval_state.sql
-- Approval is orthogonal to closure. Marking Done always stamps closed_at
-- (the TAT anchor — see 020). When an approver exists on that scope, the item
-- additionally enters approval_state='pending' ("Sent for Approval"). Approve
-- never re-anchors TAT. Reject reopens the item: status='reopened',
-- closed_at=NULL, approval_state='rejected'.

alter table public.tasks
  add column if not exists approval_state text not null default 'none';
alter table public.subtasks
  add column if not exists approval_state text not null default 'none';
alter table public.task_entities
  add column if not exists approval_state text not null default 'none';

alter table public.tasks         drop constraint if exists tasks_approval_state_check;
alter table public.tasks         add  constraint tasks_approval_state_check
  check (approval_state in ('none','pending','approved','rejected'));
alter table public.subtasks      drop constraint if exists subtasks_approval_state_check;
alter table public.subtasks      add  constraint subtasks_approval_state_check
  check (approval_state in ('none','pending','approved','rejected'));
alter table public.task_entities drop constraint if exists task_entities_approval_state_check;
alter table public.task_entities add  constraint task_entities_approval_state_check
  check (approval_state in ('none','pending','approved','rejected'));

-- Add 'reopened' to every status CHECK (rejection sends an item back).
-- Names match the Postgres-generated names from 002 / the explicit name 015 used.
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add  constraint tasks_status_check
  check (status in ('backlog','todo','in_progress','pending_decision','blocked','done','archived','reopened'));

alter table public.subtasks drop constraint if exists subtasks_status_check;
alter table public.subtasks add  constraint subtasks_status_check
  check (status in ('backlog','todo','in_progress','pending_decision','blocked','done','reopened'));

alter table public.task_entities drop constraint if exists task_entities_per_entity_status_check;
alter table public.task_entities add  constraint task_entities_per_entity_status_check
  check (per_entity_status in ('backlog','todo','in_progress','pending_decision','blocked','done','reopened'));

-- Append-only audit of every approve/reject action, at any scope.
create table if not exists public.approval_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  scope_type text not null check (scope_type in ('task','subtask','entity')),
  subtask_id uuid references public.subtasks(id) on delete cascade,
  entity_id uuid,
  actor_id uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('approve','reject')),
  reason text,
  created_at timestamptz default now()
  -- no updated_at: append-only, mirrors decision_log
);

create index if not exists idx_approval_log_task
  on public.approval_log (task_id, created_at desc);

alter table public.approval_log enable row level security;

create policy "approval_log: can_access_task can read" on public.approval_log
  for select using (public.can_access_task(task_id));

create policy "approval_log: task participants can insert" on public.approval_log
  for insert with check (
    actor_id = auth.uid() and public.can_access_task(task_id)
  );

NOTIFY pgrst, 'reload schema';
