-- 040_platform_admins.sql
-- Critical security fix. The previous platform-admin flag lived inside the
-- users.settings JSONB column, which is writable by the user themselves
-- through the existing "users: update own" RLS policy. Any authenticated
-- user could grant themselves access to /api/v1/admin/* by running
-- `UPDATE users SET settings = jsonb_set(settings, '{is_admin}', 'true')
-- WHERE id = auth.uid();` from the browser's Supabase client.
--
-- Move the flag to a dedicated table that is locked down by RLS (no
-- policies = denied for anon + authenticated). Service role bypasses RLS
-- and is the only writer. Backfills from the existing settings.is_admin
-- so currently-elevated admins keep access.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  note TEXT
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the backend's service-role client may
-- read/write this table. anon + authenticated get 0 rows.

-- Backfill from the legacy flag so we don't drop any current admins.
INSERT INTO public.platform_admins (user_id, note)
SELECT id, 'backfilled from users.settings.is_admin'
FROM public.users
WHERE (settings ->> 'is_admin')::boolean IS TRUE
ON CONFLICT (user_id) DO NOTHING;

-- Strip the flag from settings so it can't be accidentally consulted
-- anywhere. Cheap idempotent operation.
UPDATE public.users
SET settings = settings - 'is_admin'
WHERE settings ? 'is_admin';
