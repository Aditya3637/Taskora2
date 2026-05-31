-- 034_buildings_code_per_business.sql
-- buildings.code was UNIQUE globally, so a CSV upload that included any code
-- already used by ANOTHER tenant failed atomically with
-- "A record with these details already exists." Make code unique per business
-- instead.
ALTER TABLE public.buildings
  DROP CONSTRAINT IF EXISTS buildings_code_key;

ALTER TABLE public.buildings
  ADD CONSTRAINT buildings_business_code_key UNIQUE (business_id, code);
