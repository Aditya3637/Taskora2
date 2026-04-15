begin;

-- 004_rls.sql
-- Row Level Security policies for all Taskora tables
-- Principle: users can only access data within businesses they are members of
-- Business owners have full access to all data within their businesses
-- Task access is granted to primary and secondary stakeholders + business owners

-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.businesses enable row level security;
alter table public.buildings enable row level security;
alter table public.clients enable row level security;
alter table public.business_members enable row level security;
alter table public.initiatives enable row level security;
alter table public.initiative_entities enable row level security;
alter table public.tasks enable row level security;
alter table public.task_entities enable row level security;
alter table public.task_stakeholders enable row level security;
alter table public.subtasks enable row level security;
alter table public.subtask_entities enable row level security;
alter table public.comments enable row level security;
alter table public.decision_log enable row level security;
alter table public.attachments enable row level security;
alter table public.milestones enable row level security;
alter table public.milestone_entities enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;

-- Helper: returns true if the current user is a member of the given business
create or replace function public.is_business_member(p_business_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
  );
$$;

-- Helper: returns true if the current user is the owner of the given business
create or replace function public.is_business_owner(p_business_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- Helper: returns true if current user is a stakeholder on a task
create or replace function public.is_task_stakeholder(p_task_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.task_stakeholders
    where task_id = p_task_id
      and user_id = auth.uid()
  );
$$;

-- USERS
create policy "users: read own" on public.users
  for select using (id = auth.uid());

create policy "users: update own" on public.users
  for update using (id = auth.uid());

create policy "users: insert own on signup" on public.users
  for insert with check (id = auth.uid());

-- BUSINESSES
create policy "businesses: members can read" on public.businesses
  for select using (public.is_business_member(id));

create policy "businesses: owner can insert" on public.businesses
  for insert with check (owner_id = auth.uid());

create policy "businesses: owner can update" on public.businesses
  for update using (public.is_business_owner(id));

create policy "businesses: owner can delete" on public.businesses
  for delete using (public.is_business_owner(id));

-- BUILDINGS
create policy "buildings: members can read" on public.buildings
  for select using (public.is_business_member(business_id));

create policy "buildings: owners can write" on public.buildings
  for all using (public.is_business_owner(business_id));

-- CLIENTS
create policy "clients: members can read" on public.clients
  for select using (public.is_business_member(business_id));

create policy "clients: owners can write" on public.clients
  for all using (public.is_business_owner(business_id));

-- BUSINESS MEMBERS
create policy "business_members: members can read own membership" on public.business_members
  for select using (
    user_id = auth.uid()
    or public.is_business_owner(business_id)
  );

create policy "business_members: owners can manage" on public.business_members
  for all using (public.is_business_owner(business_id));

-- INITIATIVES
create policy "initiatives: business members can read" on public.initiatives
  for select using (public.is_business_member(business_id));

create policy "initiatives: business members can insert" on public.initiatives
  for insert with check (public.is_business_member(business_id));

create policy "initiatives: owner or biz owner can update" on public.initiatives
  for update using (
    owner_id = auth.uid()
    or public.is_business_owner(business_id)
  );

create policy "initiatives: business owners can delete" on public.initiatives
  for delete using (public.is_business_owner(business_id));

-- INITIATIVE ENTITIES
create policy "initiative_entities: business members can read" on public.initiative_entities
  for select using (
    exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and public.is_business_member(i.business_id)
    )
  );

create policy "initiative_entities: initiative owner or biz owner can write" on public.initiative_entities
  for all using (
    exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and (i.owner_id = auth.uid() or public.is_business_owner(i.business_id))
    )
  );

-- TASKS
create policy "tasks: stakeholders and biz owners can read" on public.tasks
  for select using (
    primary_stakeholder_id = auth.uid()
    or public.is_task_stakeholder(id)
    or exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and public.is_business_owner(i.business_id)
    )
  );

create policy "tasks: business members can insert" on public.tasks
  for insert with check (
    exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and public.is_business_member(i.business_id)
    )
  );

create policy "tasks: primary stakeholder or biz owner can update" on public.tasks
  for update using (
    primary_stakeholder_id = auth.uid()
    or exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and public.is_business_owner(i.business_id)
    )
  );

create policy "tasks: primary stakeholder or biz owner can delete" on public.tasks
  for delete using (
    primary_stakeholder_id = auth.uid()
    or exists (
      select 1 from public.initiatives i
      where i.id = initiative_id
        and public.is_business_owner(i.business_id)
    )
  );

-- TASK ENTITIES
create policy "task_entities: task stakeholders and biz owners can read" on public.task_entities
  for select using (
    public.is_task_stakeholder(task_id)
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id
        and public.is_business_owner(i.business_id)
    )
  );

create policy "task_entities: task stakeholders can write" on public.task_entities
  for all using (public.is_task_stakeholder(task_id));

-- TASK STAKEHOLDERS
create policy "task_stakeholders: task stakeholders can read" on public.task_stakeholders
  for select using (public.is_task_stakeholder(task_id));

create policy "task_stakeholders: primary stakeholder or biz owner can manage" on public.task_stakeholders
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and t.primary_stakeholder_id = auth.uid()
    )
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

-- SUBTASKS
create policy "subtasks: task stakeholders and biz owners can read" on public.subtasks
  for select using (
    public.is_task_stakeholder(task_id)
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

create policy "subtasks: task stakeholders can write" on public.subtasks
  for all using (public.is_task_stakeholder(task_id));

-- SUBTASK ENTITIES
create policy "subtask_entities: task stakeholders can access" on public.subtask_entities
  for all using (
    exists (
      select 1 from public.subtasks s
      where s.id = subtask_id
        and public.is_task_stakeholder(s.task_id)
    )
  );

-- COMMENTS
create policy "comments: task stakeholders and biz owners can read" on public.comments
  for select using (
    public.is_task_stakeholder(task_id)
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

create policy "comments: task stakeholders can insert" on public.comments
  for insert with check (
    user_id = auth.uid()
    and public.is_task_stakeholder(task_id)
  );

create policy "comments: author can update own" on public.comments
  for update using (user_id = auth.uid());

create policy "comments: author or biz owner can delete" on public.comments
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

-- DECISION LOG (append-only — no update/delete policies)
create policy "decision_log: task stakeholders and biz owners can read" on public.decision_log
  for select using (
    public.is_task_stakeholder(task_id)
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

create policy "decision_log: task stakeholders can insert" on public.decision_log
  for insert with check (
    user_id = auth.uid()
    and public.is_task_stakeholder(task_id)
  );

-- ATTACHMENTS
create policy "attachments: task stakeholders and biz owners can read" on public.attachments
  for select using (
    public.is_task_stakeholder(task_id)
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

create policy "attachments: task stakeholders can upload" on public.attachments
  for insert with check (
    uploaded_by = auth.uid()
    and public.is_task_stakeholder(task_id)
  );

create policy "attachments: uploader or biz owner can delete" on public.attachments
  for delete using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

-- MILESTONES (permissive for authenticated users — filtered at app layer)
create policy "milestones: authenticated users can read" on public.milestones
  for select using (auth.uid() is not null);

create policy "milestones: authenticated users can write" on public.milestones
  for all using (auth.uid() is not null);

-- MILESTONE ENTITIES
create policy "milestone_entities: authenticated users can access" on public.milestone_entities
  for all using (auth.uid() is not null);

-- SUBSCRIPTIONS (business owners read; service role writes via backend)
create policy "subscriptions: business owners can read own" on public.subscriptions
  for select using (public.is_business_owner(business_id));

-- INVOICES (business owners read; service role writes via backend)
create policy "invoices: business owners can read own" on public.invoices
  for select using (public.is_business_owner(business_id));

commit;
