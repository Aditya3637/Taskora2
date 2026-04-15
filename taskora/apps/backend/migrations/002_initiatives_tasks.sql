begin;

-- 002_initiatives_tasks.sql
-- Initiative-first architecture: Business → Initiative → Task → Subtask
-- Entities (buildings/clients) are assignable at Initiative, Task, and Subtask level via join tables
-- date_mode toggle: 'uniform' = one deadline for all, 'per_entity' = independent deadline per entity
-- entity_inheritance: 'inherited' = takes from parent, 'overridden' = explicitly set

create table public.initiatives (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 150),
  description text,
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references public.users(id),
  status text not null default 'active'
    check (status in ('planning','active','on_hold','completed','cancelled')),
  start_date date,
  target_end_date date,
  date_mode text not null default 'uniform'
    check (date_mode in ('uniform','per_entity')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.initiative_entities (
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  entity_type text not null check (entity_type in ('building','client')),
  entity_id uuid not null,
  per_entity_end_date date,
  primary key (initiative_id, entity_type, entity_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  description text,
  status text not null default 'backlog'
    check (status in ('backlog','todo','in_progress','pending_decision','blocked','done','archived')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  due_date date,
  date_mode text not null default 'uniform'
    check (date_mode in ('uniform','per_entity')),
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  primary_stakeholder_id uuid not null references public.users(id),
  entity_inheritance text not null default 'inherited'
    check (entity_inheritance in ('inherited','overridden')),
  blocker_reason text,
  last_updated timestamptz default now(),
  created_at timestamptz default now()
);

create table public.task_entities (
  task_id uuid not null references public.tasks(id) on delete cascade,
  entity_type text not null check (entity_type in ('building','client')),
  entity_id uuid not null,
  per_entity_status text not null default 'backlog'
    check (per_entity_status in ('backlog','todo','in_progress','pending_decision','blocked','done')),
  per_entity_end_date date,
  last_updated timestamptz default now(),
  primary key (task_id, entity_type, entity_id)
);

create table public.task_stakeholders (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('primary','secondary','follower')),
  assigned_at timestamptz default now(),
  primary key (task_id, user_id)
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  status text not null default 'backlog'
    check (status in ('backlog','todo','in_progress','done')),
  assignee_id uuid references public.users(id),
  task_id uuid not null references public.tasks(id) on delete cascade,
  date_mode text not null default 'uniform'
    check (date_mode in ('uniform','per_entity')),
  entity_inheritance text not null default 'inherited'
    check (entity_inheritance in ('inherited','overridden')),
  created_at timestamptz default now()
);

create table public.subtask_entities (
  subtask_id uuid not null references public.subtasks(id) on delete cascade,
  entity_type text not null check (entity_type in ('building','client')),
  entity_id uuid not null,
  per_entity_status text not null default 'backlog',
  per_entity_end_date date,
  primary key (subtask_id, entity_type, entity_id)
);

-- Trigger: auto-update updated_at on initiatives
create trigger trg_initiatives_updated_at
  before update on public.initiatives
  for each row execute procedure public.set_updated_at();

-- Trigger: auto-update last_updated on tasks when any column changes
create or replace function public.set_task_last_updated()
returns trigger language plpgsql as $$
begin
  new.last_updated = now();
  return new;
end;
$$;

create trigger trg_tasks_last_updated
  before update on public.tasks
  for each row execute procedure public.set_task_last_updated();

-- Trigger: auto-update last_updated on task_entities
create or replace function public.set_task_entity_last_updated()
returns trigger language plpgsql as $$
begin
  new.last_updated = now();
  return new;
end;
$$;

create trigger trg_task_entities_last_updated
  before update on public.task_entities
  for each row execute procedure public.set_task_entity_last_updated();

commit;
