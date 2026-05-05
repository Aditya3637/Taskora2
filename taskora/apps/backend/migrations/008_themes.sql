-- 008_themes.sql
-- Adds Themes as the strategic focus layer between Programs (Departments) and Initiatives.
-- Full hierarchy: Business → Program → Theme → Initiative → Task → entity tags

CREATE TABLE IF NOT EXISTS themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 100),
  description TEXT,
  color TEXT DEFAULT '#6366F1',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_themes_program ON themes(program_id);
CREATE INDEX IF NOT EXISTS idx_themes_business ON themes(business_id);

ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS theme_id UUID REFERENCES themes(id) ON DELETE SET NULL;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact_metric TEXT;

ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "themes_select" ON themes FOR SELECT
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
CREATE POLICY "themes_insert" ON themes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
CREATE POLICY "themes_update" ON themes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
CREATE POLICY "themes_delete" ON themes FOR DELETE
  USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));

CREATE TRIGGER themes_updated_at BEFORE UPDATE ON themes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
