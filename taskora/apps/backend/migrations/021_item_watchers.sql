-- 021_item_watchers.sql
-- Followers & Approvers layer. One polymorphic table covers all four scopes
-- (task, subtask/sub-subtask, building row, client row). It always carries
-- task_id so the parent-task visibility rollup is a single cheap lookup:
-- a follower/approver anywhere in the tree can read the whole task.
--
-- task_stakeholders stays as-is (primary/secondary). item_watchers is the new
-- follower/approver overlay — kept separate so the two concerns don't tangle.

create table if not exists public.item_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  scope_type text not null check (scope_type in ('task','subtask','entity')),
  subtask_id uuid references public.subtasks(id) on delete cascade,
  -- For scope_type='entity': the building/client row this watcher is on.
  entity_type text check (entity_type in ('building','client')),
  entity_id uuid,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('follower','approver')),
  created_at timestamptz default now(),
  -- A subtask scope must carry a subtask_id; an entity scope must carry
  -- entity_type + entity_id; a task scope carries neither.
  constraint item_watchers_scope_shape check (
    (scope_type = 'task'    and subtask_id is null and entity_id is null)
 or (scope_type = 'subtask' and subtask_id is not null and entity_id is null)
 or (scope_type = 'entity'  and subtask_id is null and entity_id is not null and entity_type is not null)
  )
);

-- Dedup: NULLs are distinct in a plain UNIQUE, so coalesce the optional
-- scope keys to a nil-uuid sentinel for a real one-row-per-assignment guarantee.
create unique index if not exists uq_item_watchers_assignment
  on public.item_watchers (
    task_id,
    scope_type,
    coalesce(subtask_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(entity_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    user_id,
    role
  );

-- Visibility rollup: "every watcher row for this task" (any scope).
create index if not exists idx_item_watchers_task
  on public.item_watchers (task_id);

-- "Is this user a watcher anywhere?" — drives the My-Tasks list query.
create index if not exists idx_item_watchers_user
  on public.item_watchers (user_id);

-- Scope-targeted lookups (e.g. approvers on one subtask / one entity row).
create index if not exists idx_item_watchers_subtask
  on public.item_watchers (subtask_id)
  where subtask_id is not null;

create index if not exists idx_item_watchers_entity
  on public.item_watchers (task_id, entity_id)
  where entity_id is not null;

-- RLS: mirror comments — anyone who can access the parent task can read the
-- watcher list; writes happen through the service-role backend, but keep the
-- table locked down for any direct (mobile) client access.
alter table public.item_watchers enable row level security;

create policy "item_watchers: can_access_task can read" on public.item_watchers
  for select using (public.can_access_task(task_id));

create policy "item_watchers: task participants can write" on public.item_watchers
  for all using (public.can_access_task(task_id))
  with check (public.can_access_task(task_id));

NOTIFY pgrst, 'reload schema';
