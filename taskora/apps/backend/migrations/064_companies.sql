-- 064_companies.sql
-- Company becomes a first-class level: a company OWNS MANY workspaces
-- (divisions/BUs/sites). `businesses` is the workspace/tenant table; we add a
-- nullable company_id FK and backfill one company per existing owned workspace
-- (the old 1-owned cap means that's effectively one company per owner, which is
-- the grouping future workspaces join). Tenant isolation stays at the WORKSPACE
-- boundary — a company is a grouping/rollup, not a shared data scope. Billing
-- stays per-workspace. All additive; nothing dropped.

CREATE TABLE IF NOT EXISTS public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS company_id uuid
  REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_company ON public.businesses (company_id);

-- Backfill: every owned workspace gets a company (named from company_name, else
-- the workspace name), owned by that workspace's owner. Deterministic per-row.
DO $$
DECLARE b record; cid uuid;
BEGIN
  FOR b IN
    SELECT id, owner_id, company_name, name
    FROM public.businesses
    WHERE company_id IS NULL AND owner_id IS NOT NULL
  LOOP
    INSERT INTO public.companies (name, created_by)
    VALUES (COALESCE(NULLIF(trim(b.company_name), ''), b.name), b.owner_id)
    RETURNING id INTO cid;
    UPDATE public.businesses SET company_id = cid WHERE id = b.id;
  END LOOP;
END $$;
