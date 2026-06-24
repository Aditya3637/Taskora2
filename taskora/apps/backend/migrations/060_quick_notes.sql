-- 060_quick_notes.sql
-- Quick Capture: tiny per-user scratch cards (≈100 words each) the user can
-- jot from any screen, flip through, and "move to" a Notebook page (which
-- clears the card). Per-USER and cross-workspace by design — no business_id —
-- so the stack follows the person across every workspace. Backend-only RLS
-- (service-role), app-layer scoped by owner_id like the rest of the app.

create table if not exists public.quick_notes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users(id) on delete cascade,
  content     text not null default '',
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_quick_notes_owner on public.quick_notes (owner_id, position, created_at);

alter table public.quick_notes enable row level security;
