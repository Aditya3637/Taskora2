-- 051_initiative_dependencies.sql
-- P6 (capstone): initiative-level dependencies. Mirrors the existing
-- tasks.depends_on UUID[] (migration 005) so an initiative can declare the
-- sibling initiatives it waits on — powering blocked-detection and a
-- critical-path "stage" ordering on the program page. Additive.
alter table public.initiatives
  add column if not exists depends_on uuid[] not null default '{}';

create index if not exists idx_initiatives_depends_on
  on public.initiatives using gin (depends_on);
