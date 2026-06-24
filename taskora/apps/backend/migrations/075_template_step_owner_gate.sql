-- 075_template_step_owner_gate  (Playbooks P4)
-- Per-step owner (cross-team handoff: Survey→Field, Install→Install crew) and a
-- per-step GATE flag (this step at every site waits for the previous step at
-- EVERY site — "all Surveys before any Install"). Both additive + nullable.
ALTER TABLE public.process_template_steps ADD COLUMN IF NOT EXISTS default_owner_id uuid;
ALTER TABLE public.process_template_steps ADD COLUMN IF NOT EXISTS gate boolean NOT NULL DEFAULT false;
