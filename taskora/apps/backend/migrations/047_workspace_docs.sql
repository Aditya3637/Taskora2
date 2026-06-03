-- 047_workspace_docs.sql
-- Workspace Documents engine (D0): the shared, initiative-level work-doc
-- surface, its connective-tissue links (backlinks / @-mentions / note pulls),
-- and file attachments. See taskora/docs/WORKSPACE_DOCS_PLAN.md.
--
-- Backend-only: RLS is enabled with NO policies, so the anon/authenticated
-- roles can't touch these — only the service-role client the backend uses.
-- Visibility is enforced in app code via the initiative cascade (deps.py),
-- exactly like the rest of the Programs section. Same RLS pattern as
-- automation (045) / platform_admins (040).

-- ── The document itself. body is ProseMirror/TipTap JSON (uploads are
--    referenced by id, never embedded as bytes, so this stays small). ──────
create table if not exists public.workspace_docs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Polymorphic parent (matches milestones/comments). Constrained to
  -- 'initiative' today — the program level has NO manual doc (it's an
  -- AI-generated summary), enforced by this CHECK.
  parent_type text not null default 'initiative'
              check (parent_type in ('initiative')),
  parent_id   uuid not null,
  title       text not null default 'Work document',
  body        jsonb not null default '{}'::jsonb,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists idx_workspace_docs_parent
  on public.workspace_docs (business_id, parent_type, parent_id)
  where archived_at is null;

-- ── Connective tissue: a reference between any two entities. Powers
--    backlinks, @-mentions, note pulls, and the graph the AI reads. ────────
create table if not exists public.entity_links (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source_type text not null,   -- 'doc'
  source_id   uuid not null,   -- workspace_docs.id
  target_type text not null,   -- 'initiative' | 'task' | 'doc' | 'user' | 'note'
  target_id   uuid not null,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_entity_links_target on public.entity_links (target_type, target_id);
create index if not exists idx_entity_links_source on public.entity_links (source_type, source_id);

-- ── Uploads: real files in a private Storage bucket, referenced by id from
--    the doc body (the bytes never live in the JSONB). ───────────────────
create table if not exists public.doc_attachments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  doc_id       uuid not null references public.workspace_docs(id) on delete cascade,
  storage_path text not null,        -- '{business_id}/{doc_id}/{uuid}-{filename}'
  filename     text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  uploaded_by  uuid not null references public.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_doc_attachments_doc on public.doc_attachments (doc_id);

alter table public.workspace_docs  enable row level security;
alter table public.entity_links    enable row level security;
alter table public.doc_attachments enable row level security;
