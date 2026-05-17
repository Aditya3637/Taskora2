-- 025_dedupe_initiative_theme_fk.sql
-- initiatives.theme_id carried TWO identical foreign keys to themes:
--   fk_initiative_theme        FK (theme_id) -> themes(id) ON DELETE SET NULL
--   initiatives_theme_id_fkey  FK (theme_id) -> themes(id) ON DELETE SET NULL
-- PostgREST cannot disambiguate a themes(...) embed when two relationships
-- exist between the same tables (PGRST201 -> HTTP 500). This bit every
-- endpoint embedding themes (initiative list, single initiative -> the Gantt
-- initiative selector and the templates page).
--
-- Keep fk_initiative_theme (application code pins
-- `themes!fk_initiative_theme(...)`); drop the redundant duplicate. The two
-- definitions are identical, so dropping one preserves referential integrity.

ALTER TABLE public.initiatives
  DROP CONSTRAINT IF EXISTS initiatives_theme_id_fkey;
