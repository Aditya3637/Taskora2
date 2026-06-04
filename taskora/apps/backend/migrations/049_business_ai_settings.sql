-- 049_business_ai_settings.sql
-- Per-workspace BYO AI key. Each business brings its own Anthropic OR OpenAI
-- key (set in Workspace settings) to power the D4 program summary, so usage is
-- billed to the tenant and no platform-wide key is required. One row per
-- workspace.
--
-- Backend-only: RLS enabled with NO policies, so only the service-role client
-- the backend uses can read the key — the anon/authenticated roles never can.
-- The API never returns the raw key to clients (masked to last-4). Same pattern
-- as 046/047/048.
create table if not exists public.business_ai_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  provider    text not null default 'anthropic' check (provider in ('anthropic','openai')),
  api_key     text,                         -- the BYO secret; never returned to clients
  model       text,                         -- optional override; null → provider default
  updated_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.business_ai_settings enable row level security;
