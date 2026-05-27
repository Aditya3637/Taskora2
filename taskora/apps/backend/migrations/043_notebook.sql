-- 043_notebook.sql
-- Personal-first notebook surface. Six tables (projects, pages, page
-- followers, goals, checklist items, assignments). All user-scoped,
-- not workspace-scoped — a single notebook follows the user across
-- every workspace they belong to. Workspace context is read at query
-- time only for sharing/mention rules.
--
-- RLS is enabled with no policies on every table: backend's service
-- role is the only writer. anon/authenticated get 0 rows, so even if a
-- token leaks, direct PostgREST against notebook_* returns empty.
-- The API layer enforces ownership + follower visibility instead.

-- ── Projects ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notebook_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notebook_projects_owner
  ON public.notebook_projects(owner_id, archived_at, sort_order);
ALTER TABLE public.notebook_projects ENABLE ROW LEVEL SECURITY;

-- ── Pages ────────────────────────────────────────────────────────────
-- body is a jsonb array of block objects: [{id, type, text, table?}, ...]
-- Pages can live without a project (orphan) for quick captures.
CREATE TABLE IF NOT EXISTS public.notebook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.notebook_projects(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled' CHECK (char_length(title) BETWEEN 1 AND 200),
  body JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notebook_pages_owner_project
  ON public.notebook_pages(owner_id, project_id, archived_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_notebook_pages_project
  ON public.notebook_pages(project_id) WHERE project_id IS NOT NULL;
ALTER TABLE public.notebook_pages ENABLE ROW LEVEL SECURITY;

-- ── Page followers ───────────────────────────────────────────────────
-- viewer = read-only; editor = co-edits the page body.
-- (owner_id on the page is the source of truth for ownership; followers
-- never own the page even when promoted to editor.)
CREATE TABLE IF NOT EXISTS public.notebook_page_followers (
  page_id UUID NOT NULL REFERENCES public.notebook_pages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','editor')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (page_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notebook_followers_user
  ON public.notebook_page_followers(user_id, role);
ALTER TABLE public.notebook_page_followers ENABLE ROW LEVEL SECURITY;

-- ── Goals ────────────────────────────────────────────────────────────
-- Single row per user. body is jsonb so we keep open formatting options
-- without table changes. Owner-only edit even when other pages of theirs
-- are shared.
CREATE TABLE IF NOT EXISTS public.notebook_goals (
  owner_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  body JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notebook_goals ENABLE ROW LEVEL SECURITY;

-- ── Checklist items ──────────────────────────────────────────────────
-- A single global personal checklist per user. parent_item_id supports
-- one level of nesting (subtasks). source_page_id is a back-link to the
-- page that spawned this item (intent suggestion or manual add-from-page).
-- source_assignment_id is set when the item came from an accepted
-- assignment; the recipient promoting to their checklist creates this row.
CREATE TABLE IF NOT EXISTS public.notebook_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  due_date DATE,
  source_page_id UUID REFERENCES public.notebook_pages(id) ON DELETE SET NULL,
  source_assignment_id UUID,  -- FK added below after assignments table exists
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  sort_order INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  parent_item_id UUID REFERENCES public.notebook_checklist_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notebook_checklist_owner_status
  ON public.notebook_checklist_items(owner_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_notebook_checklist_parent
  ON public.notebook_checklist_items(parent_item_id) WHERE parent_item_id IS NOT NULL;
ALTER TABLE public.notebook_checklist_items ENABLE ROW LEVEL SECURITY;

-- ── Assignments ──────────────────────────────────────────────────────
-- Personal task delegation surface. Never creates a Taskora workspace
-- task. The recipient sees these in their "Tasks assigned by others" tab
-- with a count badge; the sender sees a status pill on the source line.
CREATE TABLE IF NOT EXISTS public.notebook_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_page_id UUID REFERENCES public.notebook_pages(id) ON DELETE SET NULL,
  source_block_id TEXT,  -- id of the block within page.body that spawned this
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  promoted_checklist_item_id UUID REFERENCES public.notebook_checklist_items(id)
    ON DELETE SET NULL,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_notebook_assignments_recipient
  ON public.notebook_assignments(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notebook_assignments_sender
  ON public.notebook_assignments(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notebook_assignments_source_page
  ON public.notebook_assignments(source_page_id) WHERE source_page_id IS NOT NULL;
ALTER TABLE public.notebook_assignments ENABLE ROW LEVEL SECURITY;

-- Now close the forward reference from checklist items → assignments.
ALTER TABLE public.notebook_checklist_items
  ADD CONSTRAINT notebook_checklist_source_assignment_fk
  FOREIGN KEY (source_assignment_id)
  REFERENCES public.notebook_assignments(id) ON DELETE SET NULL;

-- ── updated_at triggers ──────────────────────────────────────────────
-- Lightweight: bump updated_at on UPDATE. Trigger function lives in
-- pg_temp would be wrong here; reuse the public `set_updated_at()` if
-- it exists (most Taskora migrations declare one), otherwise create it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notebook_set_updated_at') THEN
    CREATE FUNCTION public.notebook_set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_notebook_projects_updated ON public.notebook_projects;
CREATE TRIGGER trg_notebook_projects_updated BEFORE UPDATE ON public.notebook_projects
  FOR EACH ROW EXECUTE FUNCTION public.notebook_set_updated_at();

DROP TRIGGER IF EXISTS trg_notebook_pages_updated ON public.notebook_pages;
CREATE TRIGGER trg_notebook_pages_updated BEFORE UPDATE ON public.notebook_pages
  FOR EACH ROW EXECUTE FUNCTION public.notebook_set_updated_at();

DROP TRIGGER IF EXISTS trg_notebook_goals_updated ON public.notebook_goals;
CREATE TRIGGER trg_notebook_goals_updated BEFORE UPDATE ON public.notebook_goals
  FOR EACH ROW EXECUTE FUNCTION public.notebook_set_updated_at();

DROP TRIGGER IF EXISTS trg_notebook_checklist_updated ON public.notebook_checklist_items;
CREATE TRIGGER trg_notebook_checklist_updated BEFORE UPDATE ON public.notebook_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.notebook_set_updated_at();
