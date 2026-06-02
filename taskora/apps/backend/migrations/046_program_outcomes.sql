-- 046_program_outcomes.sql
-- P1: measurable key results per program (outcome progress, distinct from
--     task completion).
-- P2: program status updates (RAG + narrative) and daily health snapshots
--     (the trend line), written by the automation cron.
--
-- Backend-only (accessed via the service-role API with require_member authz):
-- RLS enabled, no policies, so anon/auth roles can't touch them directly.

create table if not exists public.program_key_results (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  title       text not null,
  unit        text,
  baseline    numeric,
  target      numeric,
  current     numeric,
  direction   text not null default 'increase' check (direction in ('increase','decrease')),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_pkr_program on public.program_key_results (program_id);

create table if not exists public.program_updates (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  author_id   uuid references public.users(id) on delete set null,
  status      text not null check (status in ('green','amber','red')),
  summary     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pupd_program on public.program_updates (program_id, created_at desc);

create table if not exists public.program_snapshots (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.programs(id) on delete cascade,
  snapshot_date     date not null default current_date,
  health            text,
  progress_pct      int,
  outcome_pct       int,
  overdue_tasks     int,
  initiatives_total int,
  initiatives_done  int,
  created_at        timestamptz not null default now(),
  unique (program_id, snapshot_date)
);
create index if not exists idx_psnap_program on public.program_snapshots (program_id, snapshot_date);

alter table public.program_key_results enable row level security;
alter table public.program_updates     enable row level security;
alter table public.program_snapshots   enable row level security;
