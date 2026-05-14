-- 018_users_email.sql
-- public.users mirrors auth.users but never had an email column. Five routes
-- query users.email (tasks.get_task_stakeholders, activity, reports, whatsapp,
-- initiatives.get_initiative_activity) and have been silently 400'ing.
-- Add the column, backfill from auth.users, and keep it in sync.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email text;

-- Backfill from auth.users
UPDATE public.users u
SET    email = a.email
FROM   auth.users a
WHERE  a.id = u.id
  AND  (u.email IS NULL OR u.email <> a.email);

-- Keep in sync going forward: any auth.users insert/update propagates email
-- to the public.users row (which is created elsewhere on signup).
CREATE OR REPLACE FUNCTION public.sync_user_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
     SET email = NEW.email
   WHERE id = NEW.id
     AND (email IS NULL OR email <> NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_email ON auth.users;
CREATE TRIGGER trg_sync_user_email
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_email_from_auth();
