-- 071_notebook_pinned
-- Pin/favourite a notebook page so it surfaces in a "Pinned" section at the
-- top of the sidebar. Per-page boolean (the notebook is per-user already).
ALTER TABLE public.notebook_pages ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
