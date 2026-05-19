-- 028_buildings_zone_area.sql
-- The buildings CSV template + manual form expose Zone and Area, and the
-- bulk-import endpoint already writes them — but the columns never existed,
-- so every template-based import 500'd. Add them.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS zone TEXT,
  ADD COLUMN IF NOT EXISTS area TEXT;
