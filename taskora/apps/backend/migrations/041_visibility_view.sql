-- 041_visibility_view.sql
-- A7 fix. visible_initiative_ids() in deps.py was a Python union over
-- 5+ Supabase round-trips (writable + follower + program-follow cascade
-- + watcher cascade + subtask-assignee cascade). For a workspace with a
-- thousand tasks that's ~250ms latency for a single call, repeated by
-- every list endpoint.
--
-- Materialize the union as a Postgres view. The Python helper becomes a
-- single round-trip select. Same set semantics, dramatically faster, and
-- the view is now the single source of truth for "user X can read
-- initiative Y" — any future cascade extension just adds a UNION branch.
--
-- View is non-materialized (always fresh against writes). If we ever
-- need pre-computed materialized + REFRESH, swap CREATE VIEW for
-- CREATE MATERIALIZED VIEW + add an indexed refresh trigger.

CREATE OR REPLACE VIEW public.v_user_visible_initiatives AS
-- Initiative primary stakeholder
SELECT i.id AS initiative_id,
       i.business_id,
       i.primary_stakeholder_id AS user_id
FROM public.initiatives i
WHERE i.primary_stakeholder_id IS NOT NULL

UNION
-- Task stakeholders -> their task's initiative
SELECT t.initiative_id,
       i.business_id,
       ts.user_id
FROM public.task_stakeholders ts
JOIN public.tasks t ON t.id = ts.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE t.initiative_id IS NOT NULL

UNION
-- Task creators
SELECT t.initiative_id,
       i.business_id,
       t.created_by AS user_id
FROM public.tasks t
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE t.created_by IS NOT NULL AND t.initiative_id IS NOT NULL

UNION
-- Explicit initiative followers (migration 033)
SELECT inf.initiative_id,
       i.business_id,
       inf.user_id
FROM public.initiative_followers inf
JOIN public.initiatives i ON i.id = inf.initiative_id

UNION
-- item_watchers at any scope — task_id always resolves to an initiative
SELECT t.initiative_id,
       i.business_id,
       iw.user_id
FROM public.item_watchers iw
JOIN public.tasks t ON t.id = iw.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE iw.task_id IS NOT NULL AND t.initiative_id IS NOT NULL

UNION
-- Subtask + sub-subtask assignees (same column on the subtasks table)
SELECT t.initiative_id,
       i.business_id,
       s.assignee_id AS user_id
FROM public.subtasks s
JOIN public.tasks t ON t.id = s.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE s.assignee_id IS NOT NULL AND t.initiative_id IS NOT NULL

UNION
-- Program followers (migration 038) — cascades down to every initiative
-- under each followed program
SELECT i.id AS initiative_id,
       i.business_id,
       pf.user_id
FROM public.program_followers pf
JOIN public.programs p ON p.id = pf.program_id
JOIN public.initiatives i ON i.program_id = p.id;
