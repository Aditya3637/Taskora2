-- 026_drop_initiative_templates.sql
-- The Templates feature was removed (commit 2876d7a): web pages, nav, and
-- routers/templates.py are gone. initiative_templates was the only table
-- backing it, is empty, and has no inbound foreign keys, so dropping it is
-- non-destructive (no data loss, nothing depends on it). Reporting/templating
-- will be rebuilt under Analytics if needed; this table is not reused.

DROP TABLE IF EXISTS public.initiative_templates;
