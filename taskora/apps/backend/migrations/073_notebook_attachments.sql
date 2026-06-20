-- 073_notebook_attachments
-- File attachments on notebook pages (Excel/PDF/Word/images/etc.). Stored in
-- the shared workspace-docs bucket; this table records metadata + the path.
CREATE TABLE IF NOT EXISTS public.notebook_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.notebook_pages(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notebook_attachments_page ON public.notebook_attachments (page_id);
