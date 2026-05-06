-- 007_customer_journey_fixes.sql
-- Fixes broken items from audit + adds customer journey requirements:
--   impact_category/impact on initiatives, task_date_change_log,
--   expanded role enums, corrected trigger alias, fixed RLS policies.

-- ── 1. Trigger alias (006 referenced update_updated_at but only set_updated_at existed) ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. Impact fields on initiatives ──────────────────────────────────────────
ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS impact_category TEXT DEFAULT 'other'
    CHECK (impact_category IN ('cost','customer_experience','process_efficiency','other')),
  ADD COLUMN IF NOT EXISTS impact TEXT;

-- ── 3. Expand business_members.role to include 'admin' ───────────────────────
ALTER TABLE business_members DROP CONSTRAINT IF EXISTS business_members_role_check;
ALTER TABLE business_members
  ADD CONSTRAINT business_members_role_check
  CHECK (role IN ('owner','admin','member'));

-- ── 4. Expand workspace_invites.role to cover all invite types ───────────────
ALTER TABLE workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('platform_owner','admin','primary','secondary','follower','member'));

-- ── 5. Fix workspace_invites RLS — invites_select used public.users.email ─────
--    public.users has no email column; must use auth.users
DROP POLICY IF EXISTS "invites_select" ON workspace_invites;
CREATE POLICY "invites_select" ON workspace_invites FOR SELECT
  USING (
    invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = workspace_invites.business_id AND user_id = auth.uid()
    )
  );

-- ── 6. Date change log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_date_change_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id  UUID REFERENCES subtasks(id) ON DELETE CASCADE,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  old_date    DATE,
  new_date    DATE,
  delay_days  INTEGER,         -- positive = delayed, negative = pulled forward
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  CHECK (task_id IS NOT NULL OR subtask_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_date_change_task    ON task_date_change_log(task_id);
CREATE INDEX IF NOT EXISTS idx_date_change_subtask ON task_date_change_log(subtask_id);
CREATE INDEX IF NOT EXISTS idx_date_change_created ON task_date_change_log(created_at DESC);

ALTER TABLE task_date_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "date_change_select" ON task_date_change_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN business_members bm ON bm.business_id = (
        SELECT business_id FROM initiatives WHERE id = t.initiative_id
      )
      WHERE t.id = task_date_change_log.task_id AND bm.user_id = auth.uid()
    )
    OR task_id IS NULL   -- subtask-only rows visible to stakeholders (app layer enforces)
  );

CREATE POLICY "date_change_insert" ON task_date_change_log FOR INSERT WITH CHECK (true);

-- ── 7. Auto-create 60-day trial subscription when business is created ─────────
--    Trigger fires on INSERT into businesses
CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subscriptions (
    business_id, plan, status,
    trial_start, trial_end,
    billing_cycle, amount_inr
  ) VALUES (
    NEW.id, 'free', 'trialing',
    now(), now() + interval '60 days',
    'monthly', 0
  )
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_trial ON businesses;
CREATE TRIGGER trg_create_trial
  AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION create_trial_subscription();

-- ── 8. Indexes for new columns ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_initiatives_impact ON initiatives(impact_category);
CREATE INDEX IF NOT EXISTS idx_initiatives_program ON initiatives(program_id) WHERE program_id IS NOT NULL;
