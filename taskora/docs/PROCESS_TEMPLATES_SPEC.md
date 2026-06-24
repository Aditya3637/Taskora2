# Process Templates ("Playbooks") — Spec Sheet

_Status: PROPOSAL (2026-06-19). Not built. Supersedes the parked "Playbooks" idea._

## 1. The problem

An initiative is often the **same multi-step process run at many sites**. Example:
metering rollout = `Survey → Install → Test` at 50 buildings.

- Entering 50 × 3 = **150 tasks by hand** is unacceptable.
- The current model (`task_entities`: one shared task attached to many buildings,
  with per-entity status/dates and entity-scoped sub-tasks) tracks per-site state
  fine — **but dependencies are task-level**. It cannot express
  _"Install-A waits on Survey-A, independent of Building B."_ Every building is
  forced onto one shared schedule and one shared dependency edge.

**Goal:** real **per-building task chains** (independent dates + dependencies +
critical path per site), created in **one action** from a reusable **process
template**, and surfaced cleanly in timeline / list / roll-ups.

## 2. Concepts

| Term | Meaning |
|---|---|
| **Process Template** | A reusable, named definition of a process: ordered **steps** + the dependency pattern + default durations/owners. Defined once, lives in a per-workspace library. |
| **Step** | One node of a template → becomes one **Task** when applied. (NOT a sub-task. Sub-tasks are finer breakdown *inside* a generated task.) |
| **Process Instance** | One application of a template to **one site** (building/client). Owns that site's generated task chain. The handle for "reschedule / progress / remove this site." |
| **Site** | A building or client. A site-based task lives at exactly **one** site (`tasks.entity_id`). |

**Hierarchy (site-based):**
`Initiative → Building/Client → Task (= a step) → Sub-tasks → …`

**Hierarchy (plain, unchanged):**
`Initiative → Task → Sub-tasks`

## 3. Data model (additive — nothing removed)

**New tables**
```sql
process_templates(
  id, business_id, name, description, created_by, created_at, archived_at)

process_template_steps(
  id, template_id, order_index,            -- 0,1,2…
  title, description,
  duration_days int,                       -- default span
  default_priority,                        -- low|medium|high|urgent
  default_owner_role text null,            -- optional role hint
  depends_on int[] default '{}')           -- order_indexes of prior steps

process_instances(
  id, business_id, initiative_id,
  template_id null,                        -- null = ad-hoc chain
  entity_id, entity_type,                  -- the one site
  label, start_date, created_at, archived_at)
```

**New columns on `tasks` (all nullable → existing tasks untouched)**
```sql
tasks.entity_id uuid          -- the ONE site this task lives at (new model)
tasks.entity_type text        -- 'building' | 'client'
tasks.process_instance_id uuid REFERENCES process_instances ON DELETE CASCADE
tasks.template_step_id uuid   -- which step it came from (for propagation)
```

**Coexistence rule (the crux):** a task's site =
`entity_id` when set (new, per-building model) **else** its `task_entities`
rows (legacy shared model). New site-based work uses `entity_id`; `task_entities`
stays valid for genuinely-shared single tasks. No data migration required.

## 4. The generator — "Apply process to sites"

**Input:** `template_id` (or an inline step list), `initiative_id`,
`sites: [{entity_id, entity_type}]`, `start_date`, optional `owner_by_role`,
`schedule_mode: sequential|fixed_offset`.

**Algorithm**
```
for each site:
  inst = insert process_instances(initiative, template, site, start_date)
  cursor = start_date
  step_task = {}                       # order_index -> new task id
  for step in template.steps (ordered):
    t = insert tasks(
      title=step.title, initiative_id, entity_id=site, entity_type,
      process_instance_id=inst, template_step_id=step.id,
      priority=step.default_priority, owner=owner_by_role[step.role],
      start_date=cursor, due_date=cursor + step.duration_days)
    step_task[step.order_index] = t.id
    cursor = t.due_date              # sequential mode
    t.depends_on = [step_task[i] for i in step.depends_on]   # intra-site only
# 50 sites × 3 steps = 1 call → 150 tasks, wired + dated.
```
**Notifications are SUPPRESSED during fan-out** (no 150 "assigned" pings — one
summary instead). This is a hard requirement (see §8).

## 5. Dependencies

- **Intra-site (default):** the template's step graph, replicated inside each
  instance. `Install-A` depends on `Survey-A` only.
- **Sites run in parallel** by default (independent chains) — the natural case.
- **Cross-site gates (optional, v2):** "all Surveys before any Install." Modelled
  as a **gate milestone** per step, not 50×50 edges: each site's `Survey` rolls
  into a `Surveys complete` milestone; each `Install` depends on the milestone.
  Keeps the graph O(sites), not O(sites²).
- **Propagation:** editing a template step's deps/duration/title → opt-in
  "apply to existing instances" job; manually-edited tasks are flagged and skipped.

## 6. Lifecycle & editing at scale

- **Add a site later** → "apply to new sites" generates only the missing instances.
- **Add/remove a step** → propagate: append a task to each instance / orphan +
  offer-to-delete.
- **Reschedule a whole site** → drag the building lane; shifts that instance's
  chain (cursor recompute).
- **Shift one step across all sites** → bulk-update by `template_step_id`.
- **Remove a site from the initiative** → archive/delete its `process_instance`
  (CASCADE removes its tasks).

## 7. Display impact

- **Timeline (default):** group site-based tasks by `entity_id` → **Building lane
  → task chain with intra-lane dependency arrows**; collapse a lane to a roll-up
  bar (earliest start → latest end). The slowest site = the initiative's critical
  path. _Mostly exists as the `sites-gantt` swimlane — extend it to read
  `entity_id`._
- **List:** group `Initiative → Building → Task → Sub-task` (built). Add a
  **Step view** — group by `template_step_id` across sites ("every building still
  on Survey"). The killer report at 50 sites.
- **Roll-ups:** per-step completion across sites — `Survey 50/50 · Install 12/50 ·
  Test 0/50`.

## 8. Impact analysis on existing builds

| Area | Impact | Action |
|---|---|---|
| `task_entities` (13 modules: analytics, people, daily_brief, war_room, decisions, activity, entities, programs, notify, notify_scans, tasks, workspace_docs, initiatives) | New `entity_id` is a second way a task relates to a site. | Add a shared helper `task_site(t)` = entity_id ‖ task_entities; per-site aggregations (analytics/people/daily_brief) must count BOTH. **Main integration cost.** |
| Notifications | Fan-out could fire 150 `assigned` + `blocked`/dep notifications. | **Suppress during generation;** send one "Process applied: 150 tasks at 50 sites" summary. |
| `get_initiative_gantt` | Now task→subtask + site badge. Site-based tasks should nest under a building lane. | Add building-lane grouping when `entity_id` present (the default-view structure the user asked for). |
| `sites-gantt` swimlane | Built on `task_entities`. | Extend to union `entity_id`. |
| Critical path / ripple (G5) | 150 tasks, 50 parallel chains. | O(n) memo already fine; lanes collapsible so render stays light. |
| `/tasks/bulk-update` | Exists. | Add select-by `process_instance_id` / `template_step_id`. |
| Risk model, analytics counts | Task counts jump 3→150. | Expected; list view already handles 200+; risk per-initiative still valid. |
| Optional dates (068) | Generated tasks always dated. | Fine. |
| Archive/restore (055) | Per-task archive exists. | Add per-instance archive (cascade). |
| Permissions | Who can apply a template / edit library. | admin/lead to apply + manage templates; members read. |
| Dependencies UI (draw-to-link) | Works task-to-task. | Unchanged; now also used inside lanes. |
| Sub-tasks / `subtask_entities` | Step = task; sub-tasks unchanged. | `subtask_entities` becomes redundant for new model (a step-task already IS at one site) — leave for legacy. |

## 9. API surface (new)

```
GET    /api/v1/process-templates?business_id=
POST   /api/v1/process-templates                 (name + steps[])
PATCH  /api/v1/process-templates/{id}            (edit; ?propagate=true)
DELETE /api/v1/process-templates/{id}
POST   /api/v1/initiatives/{id}/apply-process    (template_id|steps, sites[], start_date) → summary
GET    /api/v1/initiatives/{id}/process-instances
POST   /api/v1/process-instances/{id}/reschedule (shift days)
DELETE /api/v1/process-instances/{id}            (cascade tasks)
GET    /api/v1/initiatives/{id}/step-rollup      (per template_step completion across sites)  [BUILT]
```

## 10. Edge cases

- Same template applied twice to one site → two instances (warn, allow).
- Manually-edited generated task → `modified` flag; propagation skips it.
- Step deleted from template → orphan tasks kept + flagged "no template step".
- A generated task gets its own ad-hoc sub-tasks → fine, independent of template.
- Client that contains buildings → out of scope v1 (client and building are peers).

## 11. Phased rollout

- **P1 — Create (the 150→1 win):** schema (entity_id + 3 tables) + generator
  endpoint + "Apply process to sites" modal (define/pick template, tick sites,
  set start). Silent fan-out + summary. _Deliverable: 150 wired tasks in one click._
- **P2 — See it:** building-lane grouping in timeline (extend sites-gantt to
  entity_id) ✅ + Step view + step roll-ups ✅ (`step-rollup` endpoint + Step
  progress bars in the Manage-processes modal: `Survey 1/2 · Install 0/2 …`
  with blocked/overdue badges).
- **P3 — Manage at scale:** reschedule-lane, add-site, shift-step-across-sites,
  template propagation.
- **P4 — Differentiate:** gate milestones, template library management UI,
  per-step default owners/roles, template from an existing initiative ("save as
  template").

## 12. Final recommendation

1. **Build it, layered — do NOT touch `task_entities`.** `entity_id` is additive;
   the legacy shared model keeps working; site-based work is the new path.
2. **Reusable template library** (per workspace), not per-initiative step lists —
   the whole value is reuse across initiatives.
3. **Start P1** (schema + generator + apply modal). It's the entire "150 entries"
   pain and the riskiest data shape — get it right, the views (P2) largely exist.
4. **Suppress fan-out notifications** from day one.
5. **Cross-site gates = milestones, never N² edges.**
6. Defer: client-contains-buildings, template-defined sub-tasks, save-as-template.
