-- 012_programs_section_fix.sql
-- Ensures all columns required by the programs/full-tree endpoint exist.
-- Safe to run multiple times (all statements are idempotent).

-- ── 1. Themes table (required before theme_id FK can be added) ──────────────
CREATE TABLE IF NOT EXISTS themes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  program_id  UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) <= 100),
  description TEXT,
  color       TEXT DEFAULT '#6366F1',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_themes_program  ON themes(program_id);
CREATE INDEX IF NOT EXISTS idx_themes_business ON themes(business_id);

ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "themes_select" ON themes FOR SELECT
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "themes_insert" ON themes FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "themes_update" ON themes FOR UPDATE
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "themes_delete" ON themes FOR DELETE
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = themes.business_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS themes_updated_at ON themes;
CREATE TRIGGER themes_updated_at BEFORE UPDATE ON themes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. initiatives columns added by migrations 007-009 (re-add safely) ───────
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact          TEXT;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact_metric   TEXT;

-- impact_category: add without constraint first, then add constraint safely
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS impact_category TEXT DEFAULT 'other';
DO $$ BEGIN
  ALTER TABLE initiatives
    ADD CONSTRAINT initiatives_impact_category_check
    CHECK (impact_category IN ('cost', 'customer_experience', 'process_efficiency', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS primary_stakeholder_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_initiatives_primary_stakeholder ON initiatives(primary_stakeholder_id);

-- theme_id: add column, then add FK safely
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS theme_id UUID;
DO $$ BEGIN
  ALTER TABLE initiatives
    ADD CONSTRAINT fk_initiative_theme FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_initiatives_theme ON initiatives(theme_id) WHERE theme_id IS NOT NULL;

-- program_id: ensure FK exists (column added in 005, FK added in 006)
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS program_id UUID;
DO $$ BEGIN
  ALTER TABLE initiatives
    ADD CONSTRAINT fk_initiative_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_initiatives_program ON initiatives(program_id) WHERE program_id IS NOT NULL;

-- ── 3. Backfill primary_stakeholder_id from owner_id where missing ───────────
UPDATE initiatives
  SET primary_stakeholder_id = owner_id
  WHERE primary_stakeholder_id IS NULL AND owner_id IS NOT NULL;
