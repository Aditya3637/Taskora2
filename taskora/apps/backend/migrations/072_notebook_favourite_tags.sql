-- 072_notebook_favourite_tags
-- Favourite (star = highlight only, distinct from pin) + free-text tags for
-- filtering notebook pages.
ALTER TABLE public.notebook_pages ADD COLUMN IF NOT EXISTS favourite boolean NOT NULL DEFAULT false;
ALTER TABLE public.notebook_pages ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
