-- 013_onboarding.sql
-- Adds onboarding tracking columns to businesses and creates assignees table
-- for personal-mode workspaces (named people, no Supabase auth accounts).

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS onboarding_completed     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_mode           text    CHECK (workspace_mode IN ('personal', 'organisation')),
  ADD COLUMN IF NOT EXISTS onboarding_step2_done    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step2_skipped boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step3_done    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step3_skipped boolean DEFAULT false;

-- Named assignees for personal-mode workspaces
CREATE TABLE IF NOT EXISTS assignees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 100),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignees_business ON assignees(business_id);

ALTER TABLE assignees ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "assignees_member_select" ON assignees FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = assignees.business_id AND user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "assignees_member_insert" ON assignees FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = assignees.business_id AND user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "assignees_member_delete" ON assignees FOR DELETE
    USING (EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = assignees.business_id AND user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
