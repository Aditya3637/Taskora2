-- 061_doc_parent_types.sql
-- Doc-as-reference-hub: allow workspace_docs at task and entity scope, not just
-- initiative. Additive — existing rows are all 'initiative' and stay valid.
-- entity_links.target_type is free-text (no DB constraint) so building/client
-- mention links need no schema change.

ALTER TABLE public.workspace_docs DROP CONSTRAINT IF EXISTS workspace_docs_parent_type_check;
ALTER TABLE public.workspace_docs ADD CONSTRAINT workspace_docs_parent_type_check
  CHECK (parent_type IN ('initiative', 'task', 'entity'));
