-- 053_notebook_tiptap.sql
-- Notebook convergence N-2: the notebook page body adopts the shared TipTap
-- editor (same surface as Workspace Docs). Additive + reversible:
--   - body_doc: the ProseMirror/TipTap JSON (object), the new source of truth.
--   - format:   'blocks' (legacy flat Block[] in `body`) or 'pm' (use body_doc).
-- The legacy `body` column is left untouched as a backup; pages convert
-- on first open (FE writes body_doc + flips format to 'pm'). Nothing is dropped,
-- so a page can be reverted to the classic editor by flipping format back.
alter table public.notebook_pages
  add column if not exists body_doc jsonb,
  add column if not exists format   text not null default 'blocks';
