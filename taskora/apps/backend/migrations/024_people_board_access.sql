-- 024_people_board_access.sql
-- The People board exposes every member's task load + the per-person detail
-- (focus) view, so it is owner/admin by default. Admins can additionally grant
-- it to specific members (typically primary stakeholders who need the
-- portfolio picture) via a per-membership flag. Default false keeps the board
-- closed for everyone except owner/admin until explicitly granted.

alter table public.business_members
  add column if not exists can_view_people_board boolean not null default false;

NOTIFY pgrst, 'reload schema';
