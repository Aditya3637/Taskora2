-- 023_comment_kind.sql
-- Comments now carry a kind. A rejection posts a 'rejection' comment into the
-- item's own thread (red-highlighted in the UI, and surfaced as the red
-- latest-comment preview on the card). 'approval' is recorded the same way.
-- Default 'note' keeps every existing comment unchanged.

alter table public.comments
  add column if not exists kind text not null default 'note';

alter table public.comments drop constraint if exists comments_kind_check;
alter table public.comments add  constraint comments_kind_check
  check (kind in ('note','rejection','approval'));

NOTIFY pgrst, 'reload schema';
