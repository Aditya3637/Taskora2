-- 045_automation.sql
-- Lifecycle-automation backbone: an append-only event log, a durable job
-- queue (driven by a Vercel cron tick), an outbound-message log (every
-- email/push/whatsapp/in-app, with dedupe), and a per-campaign kill switch.
--
-- These tables are backend-only: RLS is enabled with NO policies, so the
-- anon/authenticated roles can't touch them — only the service-role client
-- the backend uses. Same pattern as platform_admins (migration 040).

-- ── Events: every meaningful action, the source of truth for funnels +
--    triggers. Append-only. ────────────────────────────────────────────
create table if not exists public.platform_events (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  type        text not null,
  user_id     uuid references public.users(id) on delete set null,
  business_id uuid references public.businesses(id) on delete cascade,
  props       jsonb not null default '{}'::jsonb
);
create index if not exists idx_platform_events_type_ts on public.platform_events (type, ts desc);
create index if not exists idx_platform_events_business on public.platform_events (business_id);
create index if not exists idx_platform_events_user on public.platform_events (user_id);

-- ── Jobs: durable, retryable scheduled work. The cron tick claims due
--    rows, runs them, and retries with backoff. ──────────────────────────
create table if not exists public.automation_jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  run_at      timestamptz not null default now(),
  status      text not null default 'pending'
              check (status in ('pending','running','done','failed','canceled')),
  attempts    int not null default 0,
  last_error  text,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_automation_jobs_due on public.automation_jobs (status, run_at);

-- ── Messages: every outbound comm. dedupe_key makes campaigns idempotent
--    (a unique index means "send once" is enforced by the DB, not just
--    app logic). ─────────────────────────────────────────────────────────
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  user_id     uuid references public.users(id) on delete set null,
  business_id uuid references public.businesses(id) on delete cascade,
  channel     text not null check (channel in ('email','whatsapp','push','inapp')),
  template    text not null,
  campaign    text,
  status      text not null default 'sent'
              check (status in ('sent','failed','suppressed','skipped')),
  dedupe_key  text unique,
  meta        jsonb not null default '{}'::jsonb,
  opened_at   timestamptz,
  clicked_at  timestamptz
);
create index if not exists idx_messages_template_ts on public.messages (template, ts desc);
create index if not exists idx_messages_business on public.messages (business_id);
create index if not exists idx_messages_campaign_status on public.messages (campaign, status);

-- ── Per-campaign on/off (the admin kill switch). Rows are created lazily;
--    a missing row means "enabled" by default. ─────────────────────────
create table if not exists public.automation_settings (
  campaign   text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.platform_events  enable row level security;
alter table public.automation_jobs   enable row level security;
alter table public.messages          enable row level security;
alter table public.automation_settings enable row level security;
