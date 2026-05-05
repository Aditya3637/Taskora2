-- 011_comprehensive_fix.sql
-- Idempotent catch-all migration: fixes trigger ordering bug from 006,
-- ensures all programs-page columns exist, and fixes business_members RLS.

-- ── 1. update_updated_at function (006 created triggers referencing it before 007 defined it) ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. programs table (may not exist if migration 006 rolled back) ──
CREATE TABLE IF NOT EXISTS programs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  lead_user_id UUID REFERENCES users(id),
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
  color       TEXT DEFAULT '#3B82F6',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_programs_business ON programs(business_id);

DROP TRIGGER IF EXISTS programs_updated_at ON programs;
CREATE TRIGGER programs_updated_at BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "programs_select" ON programs FOR SELECT
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "programs_insert" ON programs FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "programs_update" ON programs FOR UPDATE
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. program_id FK on initiatives (005 adds the column, 006 adds the FK — re-add safely) ──
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS program_id UUID;
DO $$ BEGIN
  ALTER TABLE initiatives
    ADD CONSTRAINT fk_initiative_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_initiatives_program ON initiatives(program_id) WHERE program_id IS NOT NULL;

-- ── 4. initiatives columns added by migrations 007-009 ──
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact_category TEXT DEFAULT 'other';
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact          TEXT;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact_metric   TEXT;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS theme_id        UUID REFERENCES themes(id) ON DELETE SET NULL;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS primary_stakeholder_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_initiatives_theme ON initiatives(theme_id) WHERE theme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_initiatives_primary_stakeholder ON initiatives(primary_stakeholder_id);

-- Backfill primary_stakeholder_id from owner_id
UPDATE initiatives SET primary_stakeholder_id = owner_id WHERE primary_stakeholder_id IS NULL AND owner_id IS NOT NULL;

-- ── 5. business_members RLS — fix INSERT (for all using(...) doesn't cover INSERT with check) ──
DO $$ BEGIN
  CREATE POLICY "business_members: owner can add members" ON public.business_members
    FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM businesses WHERE id = business_id AND owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow users to see all members of businesses they belong to (needed by programs page)
DO $$ BEGIN
  CREATE POLICY "business_members: members can read" ON public.business_members
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM business_members bm WHERE bm.business_id = business_members.business_id AND bm.user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Other tables from migration 006 (may not exist if 006 rolled back) ──
CREATE TABLE IF NOT EXISTS activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID REFERENCES businesses(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  entity_label TEXT,
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_business    ON activity_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_initiative  ON activity_log(initiative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_task        ON activity_log(task_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "activity_select" ON activity_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = activity_log.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS workspace_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  role          TEXT DEFAULT 'member' CHECK (role IN ('member','admin')),
  token         TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON workspace_invites(invited_email);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "invites_select" ON workspace_invites FOR SELECT
    USING (
      invited_email = (SELECT email FROM users WHERE id = auth.uid())
      OR EXISTS (SELECT 1 FROM business_members WHERE business_id = workspace_invites.business_id AND user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "invites_insert" ON workspace_invites FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = workspace_invites.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "invites_update" ON workspace_invites FOR UPDATE
    USING (
      invited_email = (SELECT email FROM users WHERE id = auth.uid())
      OR EXISTS (SELECT 1 FROM businesses WHERE id = workspace_invites.business_id AND owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS initiative_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  structure   JSONB NOT NULL DEFAULT '{"tasks":[]}',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_templates_business ON initiative_templates(business_id);

ALTER TABLE initiative_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "templates_select" ON initiative_templates FOR SELECT
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = initiative_templates.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "templates_insert" ON initiative_templates FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = initiative_templates.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "templates_update" ON initiative_templates FOR UPDATE USING (created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "templates_delete" ON initiative_templates FOR DELETE USING (created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS templates_updated_at ON initiative_templates;
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON initiative_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS sales_leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  stage         TEXT DEFAULT 'lead' CHECK (stage IN ('lead','demo','trial','negotiation','won','lost')),
  mrr           NUMERIC DEFAULT 0,
  notes         TEXT,
  assigned_to   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "sales_leads_all" ON sales_leads FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS sales_leads_updated_at ON sales_leads;
CREATE TRIGGER sales_leads_updated_at BEFORE UPDATE ON sales_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
