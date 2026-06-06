-- 052_workspace_docs_storage.sql
-- D6 (Workspace Docs §8): real file uploads — the first use of Supabase
-- Storage in the product. Provisions the PRIVATE `workspace-docs` bucket that
-- backs the `doc_attachments` table (created in migration 047).
--
-- The bucket is private (public=false): objects are never world-readable. All
-- access goes through short-lived signed URLs minted by the backend, which
-- re-checks the doc's initiative visibility first (see routers/workspace_docs.py).
-- Object paths are tenant-prefixed `{business_id}/{doc_id}/{uuid}-{filename}`,
-- so a leaked path is useless without a fresh signature and can't cross tenants.
--
-- No storage.objects RLS policies are added: the backend talks to Storage with
-- the service-role key (which bypasses RLS), exactly like it does for the
-- workspace_docs / entity_links / doc_attachments tables (047). The anon and
-- authenticated roles get NO direct access — only signed URLs.
--
-- The storage-layer file_size_limit + allowed_mime_types are a defence-in-depth
-- backstop; the app also validates size and MIME on the sign + record endpoints.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-docs',
  'workspace-docs',
  false,
  26214400,  -- 25 MiB; mirrors config.doc_upload_max_bytes
  array[
    -- images
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    -- documents
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          -- .xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',  -- .pptx
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do nothing;
