-- 044_notebook_page_icon.sql
-- Per-page emoji icon. Optional, single grapheme expected (we don't
-- validate length; the FE constrains the picker). 8-char column gives
-- room for ZWJ-joined sequences (e.g. 👨‍💻).

ALTER TABLE public.notebook_pages
  ADD COLUMN IF NOT EXISTS icon TEXT;
