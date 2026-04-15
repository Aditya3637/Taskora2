begin;

-- 003_activity_billing.sql
-- Activity layer: comments, decision_log, attachments
-- Milestone system: key checkpoints on initiatives or tasks, with per-entity date support
-- Billing layer: subscriptions and invoices for Taskora's SaaS business model

-- Comments (threaded activity on tasks, optionally scoped to a specific entity)
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  content text not null check (char_length(content) <= 5000),
  entity_id uuid,  -- optional: scopes comment to a specific building/client
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Decision log (immutable audit trail of every decision action taken)
create table public.decision_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  action text not null
    check (action in ('approve','reject','delegate','request_info','escalate','snooze')),
  reason text,
  entity_ids_affected uuid[],  -- which entities this decision applied to (null = all)
  created_at timestamptz default now()
  -- intentionally no updated_at: decision log is append-only / immutable
);

-- Attachments (files uploaded against a task)
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_size_bytes bigint,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz default now()
);

-- Milestones (key checkpoints on an initiative or task)
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('initiative','task')),
  parent_id uuid not null,  -- polymorphic ref to initiatives.id or tasks.id
  name text not null check (char_length(name) <= 120),
  date_mode text not null default 'uniform'
    check (date_mode in ('uniform','per_entity')),
  uniform_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-entity milestone dates (used when milestone date_mode = 'per_entity')
create table public.milestone_entities (
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  entity_type text not null check (entity_type in ('building','client')),
  entity_id uuid not null,
  per_entity_date date,
  primary key (milestone_id, entity_type, entity_id)
);

-- Subscriptions (one per business, tracks plan and billing status)
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free','pro','business','enterprise')),
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','cancelled','archived')),
  billing_cycle text
    check (billing_cycle in ('monthly','annual')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_end timestamptz,
  razorpay_subscription_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Invoices (payment records per subscription cycle)
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_inr numeric(10,2),
  amount_usd numeric(10,2),
  status text not null default 'unpaid'
    check (status in ('paid','unpaid','void')),
  invoice_pdf_url text,
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- Auto-update triggers
create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute procedure public.set_updated_at();

create trigger trg_milestones_updated_at
  before update on public.milestones
  for each row execute procedure public.set_updated_at();

create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();

-- Indexes for common lookups
create index on public.comments (task_id);
create index on public.comments (user_id);
create index on public.decision_log (task_id);
create index on public.decision_log (user_id);
create index on public.attachments (task_id);
create index on public.milestones (parent_id);
create index on public.subscriptions (business_id);
create index on public.subscriptions (status);
create index on public.invoices (business_id);
create index on public.invoices (subscription_id);

commit;
