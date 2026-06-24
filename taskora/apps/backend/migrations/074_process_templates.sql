-- 074_process_templates  (Playbooks P1)
-- Per-building task chains generated from a reusable process template. Additive
-- — existing tasks (entity_id NULL) and task_entities are untouched.

CREATE TABLE IF NOT EXISTS public.process_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_process_templates_business
  ON public.process_templates (business_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.process_template_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.process_templates(id) ON DELETE CASCADE,
  order_index int NOT NULL,
  title text NOT NULL,
  description text,
  duration_days int NOT NULL DEFAULT 1,
  default_priority text NOT NULL DEFAULT 'medium',
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb   -- array of prior order_index ints
);
CREATE INDEX IF NOT EXISTS idx_process_template_steps ON public.process_template_steps (template_id);

CREATE TABLE IF NOT EXISTS public.process_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  initiative_id uuid NOT NULL REFERENCES public.initiatives(id) ON DELETE CASCADE,
  template_id uuid,
  entity_id uuid,
  entity_type text,
  label text,
  start_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_process_instances_initiative ON public.process_instances (initiative_id);

-- A task can live at ONE site and belong to a generated chain (all nullable).
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS process_instance_id uuid
  REFERENCES public.process_instances(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS template_step_id uuid;
CREATE INDEX IF NOT EXISTS idx_tasks_entity ON public.tasks (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_process_instance ON public.tasks (process_instance_id) WHERE process_instance_id IS NOT NULL;
