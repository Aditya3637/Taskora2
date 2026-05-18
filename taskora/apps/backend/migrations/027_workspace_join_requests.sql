-- Domain-discovery join requests (Entry 2): a same-domain signup asks to
-- join an existing workspace; an owner/admin approves → business_members.
create table if not exists public.workspace_join_requests (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending','approved','declined')),
  created_at  timestamptz not null default now(),
  decided_by  uuid references public.users(id) on delete set null,
  decided_at  timestamptz,
  -- One active request per (workspace, user). Re-requesting after a
  -- decline updates the same row.
  unique (business_id, user_id)
);

create index if not exists idx_wjr_business_status
  on public.workspace_join_requests (business_id, status);
create index if not exists idx_wjr_user
  on public.workspace_join_requests (user_id);
