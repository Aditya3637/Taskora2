begin;

-- 004_rls.sql
-- Row Level Security policies for all Taskora tables
-- Principle: users can only access data within businesses they are members of
-- Business owners have full access to all data within their businesses
-- Task access: primary_stakeholder_id OR task_stakeholders entry + business owners
-- NOTE: primary_stakeholder_id is always checked alongside is_task_stakeholder()
--       because the primary stakeholder may not have a task_stakeholders row

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

-- ── HELPER FUNCTIONS ──────────────────────────────────────────────────────
-- security definer + SET search_path prevents search-path injection attacks

create or replace function public.is_business_member(p_business_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- Returns true if current user is in task_stakeholders for this task
create or replace function public.is_task_stakeholder(p_task_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.task_stakeholders
    where task_id = p_task_id
      and user_id = auth.uid()
  );
$$;

-- Returns true if current user can access a task (primary stakeholder OR stakeholder row OR biz owner)
create or replace function public.can_access_task(p_task_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.tasks t
    join public.initiatives i on i.id = t.initiative_id
    where t.id = p_task_id
      and (
        t.primary_stakeholder_id = auth.uid()
        or public.is_task_stakeholder(p_task_id)
        or public.is_business_owner(i.business_id)
      )
  );
$$;

-- ── USERS ──────────────────────────────────────────────────────────────────
create policy "users: read own" on public.users
  for select using (id = auth.uid());

create policy "users: update own" on public.users
  for update using (id = auth.uid());

create policy "users: insert own on signup" on public.users
  for insert with check (id = auth.uid());

-- ── BUSINESSES ─────────────────────────────────────────────────────────────
create policy "businesses: members can read" on public.businesses
  for select using (public.is_business_member(id));

-- NOTE: After inserting a business, the application MUST also insert a
--       business_members row with role='owner', otherwise is_business_owner()
--       will return false for subsequent requests.
create policy "businesses: owner can insert" on public.businesses
  for insert with check (owner_id = auth.uid());

create policy "businesses: owner can update" on public.businesses
  for update using (public.is_business_owner(id));

create policy "businesses: owner can delete" on public.businesses
  for delete using (public.is_business_owner(id));

-- ── BUILDINGS ──────────────────────────────────────────────────────────────
create policy "buildings: members can read" on public.buildings
  for select using (public.is_business_member(business_id));

create policy "buildings: owners can write" on public.buildings
  for all using (public.is_business_owner(business_id));

-- ── CLIENTS ────────────────────────────────────────────────────────────────
create policy "clients: members can read" on public.clients
  for select using (public.is_business_member(business_id));

create policy "clients: owners can write" on public.clients
  for all using (public.is_business_owner(business_id));

-- ── BUSINESS MEMBERS ───────────────────────────────────────────────────────
-- Simplified: each user sees only their own membership rows; owners use the manage policy
create policy "business_members: read own" on public.business_members
  for select using (user_id = auth.uid());

create policy "business_members: owners can manage all" on public.business_members
  for all using (public.is_business_owner(business_id));

-- ── INITIATIVES ────────────────────────────────────────────────────────────
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

-- ── INITIATIVE ENTITIES ────────────────────────────────────────────────────
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

-- ── TASKS ──────────────────────────────────────────────────────────────────
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

-- ── TASK ENTITIES ──────────────────────────────────────────────────────────
create policy "task_entities: can_access_task can read" on public.task_entities
  for select using (public.can_access_task(task_id));

create policy "task_entities: can_access_task can write" on public.task_entities
  for all using (public.can_access_task(task_id));

-- ── TASK STAKEHOLDERS ──────────────────────────────────────────────────────
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

-- ── SUBTASKS ───────────────────────────────────────────────────────────────
create policy "subtasks: can_access_task can read" on public.subtasks
  for select using (public.can_access_task(task_id));

create policy "subtasks: can_access_task can write" on public.subtasks
  for all using (public.can_access_task(task_id));

-- ── SUBTASK ENTITIES ───────────────────────────────────────────────────────
create policy "subtask_entities: task access via subtask" on public.subtask_entities
  for all using (
    exists (
      select 1 from public.subtasks s
      where s.id = subtask_id
        and public.can_access_task(s.task_id)
    )
  );

-- ── COMMENTS ───────────────────────────────────────────────────────────────
create policy "comments: can_access_task can read" on public.comments
  for select using (public.can_access_task(task_id));

create policy "comments: task participants can insert" on public.comments
  for insert with check (
    user_id = auth.uid()
    and public.can_access_task(task_id)
  );

-- Update restricted to author who is still a task participant
create policy "comments: author can update own" on public.comments
  for update using (
    user_id = auth.uid()
    and public.can_access_task(task_id)
  );

create policy "comments: author or biz owner can delete" on public.comments
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      join public.initiatives i on i.id = t.initiative_id
      where t.id = task_id and public.is_business_owner(i.business_id)
    )
  );

-- ── DECISION LOG (append-only — no update/delete policies) ─────────────────
create policy "decision_log: can_access_task can read" on public.decision_log
  for select using (public.can_access_task(task_id));

create policy "decision_log: task participants can insert" on public.decision_log
  for insert with check (
    user_id = auth.uid()
    and public.can_access_task(task_id)
  );

-- ── ATTACHMENTS ────────────────────────────────────────────────────────────
create policy "attachments: can_access_task can read" on public.attachments
  for select using (public.can_access_task(task_id));

create policy "attachments: task participants can upload" on public.attachments
  for insert with check (
    uploaded_by = auth.uid()
    and public.can_access_task(task_id)
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

-- ── MILESTONES ─────────────────────────────────────────────────────────────
-- Scoped through polymorphic parent (initiative or task)
create policy "milestones: scoped read" on public.milestones
  for select using (
    (parent_type = 'initiative' and exists (
      select 1 from public.initiatives i
      where i.id = parent_id and public.is_business_member(i.business_id)
    ))
    or
    (parent_type = 'task' and public.can_access_task(parent_id))
  );

create policy "milestones: scoped write" on public.milestones
  for all using (
    (parent_type = 'initiative' and exists (
      select 1 from public.initiatives i
      where i.id = parent_id
        and (i.owner_id = auth.uid() or public.is_business_owner(i.business_id))
    ))
    or
    (parent_type = 'task' and public.can_access_task(parent_id))
  );

-- ── MILESTONE ENTITIES ─────────────────────────────────────────────────────
create policy "milestone_entities: scoped via milestone" on public.milestone_entities
  for all using (
    exists (
      select 1 from public.milestones m
      where m.id = milestone_id
        and (
          (m.parent_type = 'initiative' and exists (
            select 1 from public.initiatives i
            where i.id = m.parent_id and public.is_business_member(i.business_id)
          ))
          or
          (m.parent_type = 'task' and public.can_access_task(m.parent_id))
        )
    )
  );

-- ── SUBSCRIPTIONS (business owners read; service role writes via backend) ──
create policy "subscriptions: business owners can read own" on public.subscriptions
  for select using (public.is_business_owner(business_id));

-- ── INVOICES (business owners read; service role writes via backend) ────────
create policy "invoices: business owners can read own" on public.invoices
  for select using (public.is_business_owner(business_id));

commit;
