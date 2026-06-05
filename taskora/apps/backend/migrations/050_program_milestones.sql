-- 050_program_milestones.sql
-- P4: milestones on the program timeline. The milestones table is already
-- polymorphic (parent_type/parent_id) but its CHECK only allowed
-- 'initiative'/'task' — extend it to 'program' so a program can carry key dates.
-- Also add a `completed_at` so the timeline can show hit / upcoming / overdue.
-- Purely additive; existing initiative/task milestone rows are untouched.

alter table public.milestones drop constraint if exists milestones_parent_type_check;
alter table public.milestones add constraint milestones_parent_type_check
  check (parent_type in ('initiative','task','program'));

alter table public.milestones add column if not exists completed_at timestamptz;
