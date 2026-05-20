-- Mirror new auth.users rows into public.users so every signup is
-- immediately ready to own / be added to a workspace.
--
-- public.users.id is FK-targeted by businesses.owner_id, business_members.
-- user_id, task_stakeholders.user_id, item_watchers.user_id, etc. Without
-- this row, accept_invite (POST /api/v1/invites/{token}/accept) crashes with
-- an FK violation: the invitee's auth.users row exists, but public.users
-- doesn't, so the business_members upsert fails — and the "Accept
-- invitation" button silently no-ops in the UI.
--
-- Audit before this migration: 7 of 25 auth.users had no public.users row.
-- The pre-existing trg_sync_user_email trigger only UPDATES public.users
-- when email changes — it never creates the row.

BEGIN;

-- 1) Function. SECURITY DEFINER so the auth-schema trigger can write into
-- public; pin search_path to avoid privilege-escalation via shadowed names.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(NEW.email, '@', 1), ''),
      'User'
    ),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2) Trigger on auth.users AFTER INSERT. AFTER (not BEFORE) so NEW.id is
-- final; per-row.
DROP TRIGGER IF EXISTS trg_create_public_user ON auth.users;
CREATE TRIGGER trg_create_public_user
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- 3) Backfill: any pre-existing auth.users without a public.users mirror.
INSERT INTO public.users (id, name, email)
SELECT
  au.id,
  COALESCE(
    NULLIF(au.raw_user_meta_data ->> 'name', ''),
    NULLIF(split_part(au.email, '@', 1), ''),
    'User'
  ),
  au.email
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
