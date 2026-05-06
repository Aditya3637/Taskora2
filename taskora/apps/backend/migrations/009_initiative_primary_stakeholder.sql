-- 009_initiative_primary_stakeholder.sql
-- Adds primary_stakeholder_id to initiatives — the responsible person, distinct from the creator/owner.

ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS primary_stakeholder_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_initiatives_primary_stakeholder ON initiatives(primary_stakeholder_id);

-- Backfill existing rows so primary_stakeholder_id = owner_id
UPDATE initiatives SET primary_stakeholder_id = owner_id WHERE primary_stakeholder_id IS NULL AND owner_id IS NOT NULL;

-- RLS: same rules as existing initiative policies (business membership required)
CREATE POLICY IF NOT EXISTS "initiatives_select_primary"
  ON initiatives FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = initiatives.business_id AND user_id = auth.uid()
    )
  );
