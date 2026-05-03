-- 006_new_tables.sql
-- Creates new tables: programs, activity_log, workspace_invites, initiative_templates, sales_leads.
-- Also wires the FK from initiatives.program_id -> programs.id (column added in 005).

-- Programs: sits between Business and Initiatives (Themes -> Programs -> Projects hierarchy)
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_user_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
  color TEXT DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_programs_business ON programs(business_id);

-- Link programs to initiatives (FK now that programs table exists)
ALTER TABLE initiatives
  ADD CONSTRAINT IF NOT EXISTS fk_initiative_program
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;

-- Activity log: immutable audit trail
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL, -- 'task_created','task_status_changed','comment_added','decision_made', etc.
  entity_type TEXT NOT NULL, -- 'task','initiative','building','comment','decision'
  entity_id UUID,
  entity_label TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_business ON activity_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_initiative ON activity_log(initiative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_log(task_id, created_at DESC);

-- Workspace invites
CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('member','admin')),
  token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON workspace_invites(invited_email);

-- Initiative templates
CREATE TABLE IF NOT EXISTS initiative_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  structure JSONB NOT NULL DEFAULT '{"tasks":[]}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_templates_business ON initiative_templates(business_id);

-- Sales leads (platform admin CRM)
CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  stage TEXT DEFAULT 'lead' CHECK (stage IN ('lead','demo','trial','negotiation','won','lost')),
  mrr NUMERIC DEFAULT 0,
  notes TEXT,
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for new tables
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiative_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;

-- Programs RLS: business members can read/write
CREATE POLICY "programs_select" ON programs FOR SELECT
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));
CREATE POLICY "programs_insert" ON programs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));
CREATE POLICY "programs_update" ON programs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = programs.business_id AND user_id = auth.uid()));

-- Activity log RLS: business members can read, system writes
CREATE POLICY "activity_select" ON activity_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = activity_log.business_id AND user_id = auth.uid()));
CREATE POLICY "activity_insert" ON activity_log FOR INSERT
  WITH CHECK (true); -- service role inserts

-- Workspace invites RLS
CREATE POLICY "invites_select" ON workspace_invites FOR SELECT
  USING (
    invited_email = (SELECT email FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM business_members WHERE business_id = workspace_invites.business_id AND user_id = auth.uid())
  );
CREATE POLICY "invites_insert" ON workspace_invites FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = workspace_invites.business_id AND user_id = auth.uid()));
CREATE POLICY "invites_update" ON workspace_invites FOR UPDATE
  USING (
    invited_email = (SELECT email FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM businesses WHERE id = workspace_invites.business_id AND owner_id = auth.uid())
  );

-- Templates RLS
CREATE POLICY "templates_select" ON initiative_templates FOR SELECT
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = initiative_templates.business_id AND user_id = auth.uid()));
CREATE POLICY "templates_insert" ON initiative_templates FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = initiative_templates.business_id AND user_id = auth.uid()));
CREATE POLICY "templates_update" ON initiative_templates FOR UPDATE
  USING (created_by = auth.uid());
CREATE POLICY "templates_delete" ON initiative_templates FOR DELETE
  USING (created_by = auth.uid());

-- Sales leads: admin only (checked in application layer)
CREATE POLICY "sales_leads_all" ON sales_leads FOR ALL USING (true);

-- Triggers for updated_at
CREATE TRIGGER programs_updated_at BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON initiative_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER sales_leads_updated_at BEFORE UPDATE ON sales_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
