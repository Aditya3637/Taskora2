-- 067_initiative_attachments
-- Initiative-level files (deck: "Initiative attachments, separate from doc
-- files"). attachments was task-anchored (task_id NOT NULL, mig 062). Relax it
-- so a row can instead be anchored to an initiative. Additive + nullable; all
-- existing rows keep their task_id.
ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS initiative_id uuid
  REFERENCES public.initiatives(id) ON DELETE CASCADE;
ALTER TABLE public.attachments ALTER COLUMN task_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_initiative
  ON public.attachments (initiative_id) WHERE initiative_id IS NOT NULL;
