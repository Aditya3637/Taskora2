# Programs + Workspace Docs — Build Plan

**Status:** Planning locked, build not started. Last updated 2026-06-02.
**How to use this doc:** This is the durable source of truth for the Programs → Initiatives
→ Work-Docs → AI vision. Read §1–§3 for orientation, §8 for what to build next, and update
the **Progress log (§11)** every session. Companion memory: `taskora2-programs-roadmap`.

---

## 1. North star

> **The single place a multi-site operator plans, executes, and reports a program —
> narrative + data + people + AI — without copy-pasting into Notion, Slides, or Excel.**

Everything below either serves that sentence or it gets cut. The moat is the **integration**
(data ↔ narrative ↔ AI), NOT out-building Notion's editor.

## 2. What Programs is today (shipped, grounded in code)

Hierarchy **Programs → Initiatives → Tasks → Subtasks**. Rollup at
`apps/backend/routers/programs.py:get_program_rollup` (~line 505).

- **P1 — Outcomes / Key Results** ✅ (PR #23, migration `046_program_outcomes.sql`)
  `program_key_results` (baseline/target/current/direction); CRUD + inline UI edit.
  `outcome_pct` already returned by the rollup.
- **P2 — Status updates + health trend** ✅
  `program_updates` (RAG + narrative), `program_snapshots` (daily, written by the cron tick)
  → `/trend` 60-day line. Rendered on `apps/web/app/(app)/programs/[programId]/page.tsx`.
- Health today = manual override → else **date-only** (initiative `target_end_date` vs today).
  It IGNORES `outcome_pct`, overdue tasks, blockers, staleness — the core gap P3 fixes.

## 3. The model (DECIDED)

- **Program level → AI-generated summary ONLY.** No manual editor. It is a regenerable
  rollup of its initiatives' work docs + live data (this is D4 at program scope; likely stored
  as an auto-drafted `program_update` / read-only generated doc with a "regenerate ↻" button).
- **Initiative level → a Work Document** (the shared block editor surface), **linked to notes**.
  - "Linked to notes" = **pull-in** model (recommended, pending final confirm): a user's private
    notebook notes can be *pulled/promoted* into the shared work doc (copy + reference). Personal
    stays personal until pulled. (Alternatives considered: live two-way sync, plain backlinks.)
- **Direction of flow:** private **notes** → promoted into initiative **work docs** (shared) →
  work docs + live data → **AI summary at program level**. Bottom-up execution, top-down attention.
- **Chosen page layout:** Option A — **Dashboard + Docs tab**. A doc opens in a **side panel**
  (slide-over, dashboard stays visible), with a `⤢` expand-to-full affordance.

## 4. Architecture decisions (DECIDED)

- **Workspace Docs are a NEW business-scoped surface, NOT the personal notebook.**
  - New table `workspace_docs(id, business_id, parent_type, parent_id, title, body jsonb,
    created_by, created_at, updated_at, archived_at)`. `parent_type` effectively `initiative`
    (program has no manual doc). Polymorphic-parent pattern matches `milestones`/`comments`.
  - **Visibility = the existing cascade** (`deps.py`: `require_member` + initiative visibility).
    A doc on an initiative is visible to exactly who can see that initiative. No new sharing model.
  - **Reuse the block editor + block schema** from the notebook — do NOT rewrite the personal
    notebook. (See §5 for the editor-tech decision.)
- **Connective tissue:** a small polymorphic **mentions/links** table recording references between
  any entities (doc↔initiative, note↔task, doc↔doc, person↔doc). Unlocks backlinks + universal
  search + the graph the AI reads. `notebook_assignments` is a narrow special-case to generalize.
- **AI runs async** on the existing lifecycle jobs/cron engine — never in a request path.
  Anthropic SDK with **prompt caching** (cache the program's structured context); Sonnet for
  routine briefs, Opus for the deep weekly. AI drafts, human approves.

## 5. Editor technology decision (DECIDED)

Current notebook editor is **fully homegrown**: flat `Block[]` union → one JSONB `body` blob →
one `<textarea>` per block, formatting as literal markdown markers, whole-page last-write-wins save.

- **Keep the homegrown editor for the personal notebook** (it works, has user data).
- **Build the NEW Workspace Docs surface on a real framework — TipTap (ProseMirror)** — from day one.
  Lexical is the lighter alternative; TipTap chosen for ecosystem + collab maturity + node-views
  for live embeds (Notion/Granola lineage). This is a *deliberate, scoped adoption for a new
  surface*, NOT the kind of incidental big rewrite the no-rewrite rule warns against.
- **Two genuine blockers in the homegrown model for SHARED docs:** (a) whole-page last-write-wins
  save = clobbering for multi-editor docs; (b) no real inline layer = `@`-mentions/marks/inline
  embeds are awkward. Block-level embeds and AI authoring are NOT blockers.
- **Defer real-time CRDT.** Yjs needs a stateful sync server, which fights the Vercel-serverless
  backend. Ship Workspace Docs with **transaction/block-level autosave + presence + a soft
  "X is editing" lock**; design the schema so **Yjs / Liveblocks / TipTap Cloud drops in later**.
- **Migrating the personal notebook onto TipTap** later is feasible (flat blocks → PM nodes) but
  **deferred and optional** — do it only once the shared surface proves out.

## 6. Roles & flows (DECIDED)

Grounded in `business_members` roles (`owner`/`admin`/`member`), program `lead_user_id`,
initiative `primary_stakeholder`, read-only `followers`, `platform_admins`.

| Persona | Role in code | Does | Friction tolerance |
|---|---|---|---|
| Founder / Exec | owner / platform_admin | reviews, nudges, never data-entry | near-zero (a glance) |
| Program Lead | admin, or program `lead_user_id` | plans program, KRs, initiatives, assigns owners | low (wants guided) |
| Initiative Owner | member + `primary_stakeholder` | owns the work doc + tasks, posts status | medium |
| Contributor / Follower | member (task stakeholder) / follower / client | does tasks / watches read-only | high (work must come to them) |

**The loop:** Founder frames → Lead plans → Owner executes → Contributors do tasks (delivered to
their inbox) → AI rolls up → Founder reviews & nudges → repeat.

**Each role gets ONE home:**
- Founder → **Portfolio / AI summary** (glance & nudge; ranked by risk; drill-down optional).
- Lead → **Program planning + initiative oversight** (program Overview tab).
- Owner → **the Initiative page** (Work doc + Tasks + status).
- Contributor → **personal cockpit** ("My day": tasks + delegations + approvals + checklist).
- Follower / client → **read-only shared summary link**.

Aligns with the **N3** security fix (program edit gated to admin/owner/lead).

### Resistance-reduction principles
1. Work comes to people; people don't hunt the tree (personal cockpit aggregates).
2. Capture before structure (notes private + formless; promote later).
3. Founder reads, never digs (AI summary + RAG + the 2–3 things needing them).
4. Planning is guided, not blank (program/initiative templates + AI-drafted first cut).
5. One status language everywhere (RAG 🟢🟡🔴 on task/initiative/program alike).
6. Progressive disclosure + side-panel (glance → slide open detail → never lose place).

## 7. Existing surfaces to REUSE, not rebuild (grounded)

- **Daily Brief** (`routers/daily_brief.py`, `GET /api/v1/daily-brief`): grouped TEAM overview by
  initiative/program with open/overdue/awaiting_approval/blocked counts + 60s cache. NOT a personal
  worklist.
- **War Room** (`routers/war_room.py`): `/queue`, `/battlefield` — at-risk/escalation views.
- **analytics `my-performance`**: personal METRICS (TAT, completion), not a worklist.
- **Notebook**: `notebook_assignments` (delegation inbox), `notebook_checklist_items` (personal
  checklist) — both user-scoped, cross-workspace.
- **GAP:** no single personal **"My day"** worklist unifying my tasks + approvals waiting on me +
  delegations + due checklist. → This is Slice 1 (§9).

## 8. Roadmap (sequenced) + build order

Phases (P = programs power-ups; D = docs/AI/merge; M = role homes):

- **P3 — Composite health + ranked risk** (KEYSTONE, pure backend, additive to rollup): blend
  schedule + outcome% + throughput + blockers + staleness; new `GET /{id}/risks`. Bundle **N3**
  (lock `update_program` to admin/owner/lead) + **N12** (allow null-clearing KR/program fields).
- **D0 — Workspace Docs engine**: TipTap in web; `workspace_docs` table; autosave + presence; clean
  JSON↔block schema (AI + migration friendly). Biggest single item.
- **D1 — Inline initiative detail** on program page (task counts, completion %, mini chart).
- **D2 — Initiative Work Doc** (built on D0; side-panel; `/` insert, `@` link, `✨` AI).
- **D3 — Cross-links / backlinks** (mentions table; Docs & mentions panel on initiative).
- **D4 — AI program brief** (async job; structured data + linked docs → narrative + drafted RAG).
- **D5 — Doc-driven creation** ("promote block → initiative/task").
- **P4 — Milestones on timeline** (quick win; `milestones` table already polymorphic).
- **P5 — Accountability + per-site breakdown** (owner load; per-entity building/client rollup).
- **P6 — Portfolio + dependencies** (capstone; ranks by P3 health; critical-path via depends_on).
- **M1 — "My day" cockpit** (Member home — Slice 1, §9).
- **M2 — Founder glance** (Portfolio + AI summary; needs P3).

**ADOPTION-FIRST build order (recommended):**
`M1 (My day) → M2 (Founder glance) → P3 → D1 → D0 → D2 → D4 → D3 → P5 → P4 → D5 → P6.`
Rationale: hook the *consumers* (member cockpit, founder glance) before asking *planners* to do
more work. P3 is pure backend and unblocks M2/D4/P6, so it can run in parallel with M1.

**Verification rule for every slice:** backend is fully tested via pytest (member/admin/founder +
isolation loopholes) BEFORE applying; UI is built but explicitly needs in-browser confirm (can't be
auto-verified). Nothing merges/deploys until green. Honor `feedback-no-big-rewrites`.

## 9. Slice 1 spec — "My day" cockpit (NEXT BUILD)

**Goal:** one personal worklist endpoint; the Member home; lowest resistance, highest ROI; uses
only existing tables (additive, no schema change, no rewrite).

**Endpoint:** `GET /api/v1/my-day?business_id=<id>` (auth required; `require_member` on business_id).
Returns four lists for the CALLING user:
1. `tasks` — open tasks where caller is `primary_stakeholder_id` OR in `task_stakeholders`, within
   the business; include `overdue` flag (due_date < today, status not done/archived) + initiative name.
2. `approvals` — tasks where caller is an approver (`item_watchers` role=approver) and the item's
   `approval_state='pending'`, within the business.
3. `delegations` — `notebook_assignments` where `recipient_id=caller` and status in
   (pending, accepted). Personal / cross-workspace (shown regardless of business).
4. `checklist` — `notebook_checklist_items` where `owner_id=caller`, status='open',
   `due_date` <= soon (e.g. today+7 or null-but-flagged). Personal / cross-workspace.

**Access rules (the loopholes to TEST):**
- Non-member of `business_id` → **403**.
- `tasks`/`approvals` filtered to the business AND to the caller's stakeholder/approver rows ONLY —
  never another user's tasks, never another tenant's rows.
- `delegations`/`checklist` filtered to `owner/recipient = caller` ONLY.
- An admin/owner gets THEIR OWN my-day (it is personal; admins do NOT see members' my-day here).

**Test matrix (`tests/test_my_day.py`, new):**
- member journey: sees only their assigned tasks + their approvals + their delegations + their checklist.
- admin journey: sees their own items; does NOT see a member's private delegations/checklist.
- founder/owner journey: sees their own items.
- loophole: member A cannot see member B's tasks via my-day.
- loophole: cross-tenant task (other business_id) excluded.
- loophole: non-member → 403.
- loophole: another user's checklist/delegation never returned.

**Acceptance:** full pytest suite green (currently 263); new tests cover all rows above; no schema
change; FE `My day` page wired but flagged for in-browser confirm.

## 10. Open decisions (resolve before the relevant slice)
1. Editor framework — **TipTap** (recommended) vs Lexical. (Affects D0.)
2. Collaboration ambition — real-time multiplayer now, or single-editor + presence for v1?
3. "Linked to notes" — **pull-in** (recommended) vs live-sync vs backlinks-only. (Affects D2.)
4. `my-day` scope — single active workspace (recommended) vs cross-workspace aggregation.

## 11. Progress log
- 2026-06-02 — Plan written. P1/P2 confirmed shipped. Decisions locked: model (§3), architecture
  (§4), editor tech (§5), roles (§6), layout (Option A + side panel). Slice 1 ("My day") spec'd.
  Next: build Slice 1 on a branch with the §9 test matrix; in parallel P3 is the backend keystone.
