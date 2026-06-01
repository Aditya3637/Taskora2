-- 042_visibility_view_direct_primary.sql
-- Defense-in-depth for the visibility cascade. Migration 041 unioned every
-- read path into v_user_visible_initiatives, including a `task_stakeholders`
-- branch that catches a task's primary stakeholder. That works today
-- because create_task always inserts a matching task_stakeholders row, but
-- it's a fragile invariant: any future path that writes to `tasks` without
-- writing to `task_stakeholders` would silently lose the assignee from
-- the visibility set.
--
-- Add a direct `tasks.primary_stakeholder_id` branch so the assignee's
-- visibility is a function of the canonical column on `tasks`, not a
-- derived join.

CREATE OR REPLACE VIEW public.v_user_visible_initiatives AS
SELECT i.id AS initiative_id, i.business_id, i.primary_stakeholder_id AS user_id
FROM public.initiatives i WHERE i.primary_stakeholder_id IS NOT NULL
UNION
SELECT t.initiative_id, i.business_id, ts.user_id
FROM public.task_stakeholders ts
JOIN public.tasks t ON t.id = ts.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE t.initiative_id IS NOT NULL
UNION
-- NEW in 042: direct tasks.primary_stakeholder_id branch.
SELECT t.initiative_id, i.business_id, t.primary_stakeholder_id AS user_id
FROM public.tasks t
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE t.primary_stakeholder_id IS NOT NULL AND t.initiative_id IS NOT NULL
UNION
SELECT t.initiative_id, i.business_id, t.created_by AS user_id
FROM public.tasks t JOIN public.initiatives i ON i.id = t.initiative_id
WHERE t.created_by IS NOT NULL AND t.initiative_id IS NOT NULL
UNION
SELECT inf.initiative_id, i.business_id, inf.user_id
FROM public.initiative_followers inf
JOIN public.initiatives i ON i.id = inf.initiative_id
UNION
SELECT t.initiative_id, i.business_id, iw.user_id
FROM public.item_watchers iw
JOIN public.tasks t ON t.id = iw.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE iw.task_id IS NOT NULL AND t.initiative_id IS NOT NULL
UNION
SELECT t.initiative_id, i.business_id, s.assignee_id AS user_id
FROM public.subtasks s
JOIN public.tasks t ON t.id = s.task_id
JOIN public.initiatives i ON i.id = t.initiative_id
WHERE s.assignee_id IS NOT NULL AND t.initiative_id IS NOT NULL
UNION
SELECT i.id AS initiative_id, i.business_id, pf.user_id
FROM public.program_followers pf
JOIN public.programs p ON p.id = pf.program_id
JOIN public.initiatives i ON i.program_id = p.id;
