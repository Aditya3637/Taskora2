-- 070_doc_bookmarks
-- Deck: docs gather "external links/bookmarks" alongside @mentions. Store as a
-- jsonb array of {url, label} on the doc itself (no uuid FK like entity_links).
ALTER TABLE public.workspace_docs ADD COLUMN IF NOT EXISTS bookmarks jsonb NOT NULL DEFAULT '[]'::jsonb;
