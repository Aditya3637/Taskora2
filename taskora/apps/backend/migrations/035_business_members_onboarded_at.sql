-- 035_business_members_onboarded_at.sql
-- A member "needs onboarding" until they have BOTH (a) logged in at least once
-- AND (b) been marked onboarded by an owner/admin. (a) comes from
-- auth.users.last_sign_in_at; (b) is this new column. Owners are considered
-- onboarded by definition (they bootstrapped the workspace), so backfill them
-- to their joined_at timestamp.
ALTER TABLE public.business_members
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

UPDATE public.business_members
SET onboarded_at = COALESCE(onboarded_at, joined_at)
WHERE role = 'owner';
