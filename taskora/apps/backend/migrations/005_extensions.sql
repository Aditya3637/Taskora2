-- 005_extensions.sql
-- Extends existing tables with new columns and indexes.

-- Buildings: rich property metadata
ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS btype TEXT DEFAULT 'operational' CHECK (btype IN ('operational','new')),
  ADD COLUMN IF NOT EXISTS soft_handover_date DATE,
  ADD COLUMN IF NOT EXISTS hard_handover_date DATE,
  ADD COLUMN IF NOT EXISTS completion_pct NUMERIC DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100);

-- Tasks: follow-up, recurring meetings, dependencies
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS follow_up_date DATE,
  ADD COLUMN IF NOT EXISTS recurring_type TEXT DEFAULT 'none' CHECK (recurring_type IN ('none','daily','weekly','fortnightly','monthly')),
  ADD COLUMN IF NOT EXISTS last_meeting_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_meeting_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS depends_on UUID[] DEFAULT '{}';

-- Attachments: document tracking
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS doc_status TEXT DEFAULT 'pending' CHECK (doc_status IN ('pending','received','rejected')),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Initiatives: link to programs (FK added in 006 once programs table exists)
ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS program_id UUID;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_follow_up ON tasks(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_next_meeting ON tasks(next_meeting_at) WHERE next_meeting_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_depends_on ON tasks USING gin(depends_on);
CREATE INDEX IF NOT EXISTS idx_buildings_code ON buildings(code) WHERE code IS NOT NULL;
