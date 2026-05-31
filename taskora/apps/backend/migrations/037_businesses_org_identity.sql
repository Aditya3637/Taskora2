-- 037_businesses_org_identity.sql
-- Profile gains two more identity fields:
--   company_name — legal/organisation name (e.g. "SmartWorks Pvt Ltd"),
--                  separate from the workspace's display name.
--   domain       — explicit email domain for the org (e.g. "sworks.co.in").
--                  Used by the external-invite warning instead of inferring
--                  the domain from the owner's email.
-- Both nullable; existing code paths don't read them.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS domain       TEXT;
