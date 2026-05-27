# Notebook (Pages) — Plan

Personal-first, team-connected, AI-assisted notes inside Taskora.
Redesigned 2026-05-27 around a book-spread layout with a personal
checklist, an evergreen goals pane, and a chat-style AI notebook —
superseding the 2026-05-25 daily-note-centric design.

The 2026-05-25 plan's underlying mechanics still apply: AI cost
ceiling of $0.50/user/month, BlockNote editor, deferred Yjs realtime,
Granola-style non-modal AI suggestion pills. What changed is the
surface, the data ownership model, and the task-delegation flow.

---

## 1. Mental model in one block

```
┌──────────────────┬──────────────────┐
│ GOALS            │                  │
│ (owner-only      │  AI NOTEBOOK     │
│  edit)           │  Projects        │
├──────────────────┤   └─ Pages       │
│ CHECKLIST        │  (chat-style)    │
│ [My] [Assigned•5]│  Tables + math   │
└──────────────────┴──────────────────┘
```

Book-spread, two pages side by side. The notebook is **one per user,
cross-workspace**. Workspace context is used only for (a) the
mention picker scope and (b) sharing visibility — the notes themselves
never move with a workspace switch.

---

## 2. Three surfaces

### 2.1 Goals (top-left)

- Free-form, evergreen markdown
- Owner-only edit, even on shared pages — followers see it as context
- Intent engine can suggest "Promote to Goals" for goal-shaped sentences
  written elsewhere in the notebook

### 2.2 Checklist (bottom-left)

A **single global personal checklist**, not per-page. Two tabs:

| Tab | Content |
|---|---|
| **My checklist** | Items the user owns. Source can be self-added, accepted-from-others, or auto-suggested by intent engine |
| **Tasks assigned by others (•N)** | Items that other workspace members @-mentioned the user in. Count badge surfaces pending delegations |

Each item carries an optional back-link to the source page that
spawned it. Items support nesting (subtasks), due dates, and
markdown. No labels or projects on items — keep the list flat and
fast. Sort = oldest first by default with priority items pinned.

### 2.3 AI Notebook (right page)

A `Projects → Pages` tree on the right side.

- A **Project** is a folder. Examples: "Q4 launch", "Hiring", "Personal".
  Projects are user-private unless a page within them is shared.
- A **Page** is a chat-style writing surface. Each top-level block
  renders as a message bubble in chronological order. The author types
  in an input at the bottom; new blocks append above. Editing an
  existing block edits in place — no immutability.
- Pages can contain text, headings, lists, **tables** (see §4),
  and **inline math expressions** (see §4).

There is **no separate "page" vs "chat" entity**. A page is a chat.
A project bundles many of them.

---

## 3. Intent engine + assignment flow

### 3.1 Intent detection

Two tiers:

- **T0 heuristics** (free, always on): regex for `@person`, todo
  phrasing ("need to", "should", "by Friday", checkbox syntax), goal
  phrasing ("I want to ship", "by Q4"), and number-only lines (math).
- **T1 Haiku** (~$0.001/page, cost-ceilinged at $0.50/user/month):
  classifies ambiguous lines and extracts structured fields
  (assignee, due date, action verb).

Suggestions appear as a **non-modal pill** ("AI suggestions (n)") in
the corner of the page. Clicking the pill expands a side panel listing
the suggestions; user clicks each one to accept. No auto-apply.

### 3.2 The assignment flow

When the engine detects a todo line containing an @mention of a
**workspace-member**:

1. Sender confirms via the suggestion pill ("Assign to @Aditya?")
2. The source line on the sender's page gets a status pill:
   `Pending → Accepted → Done` (or `Declined`)
3. Aditya's notebook checklist receives a new item in the
   `Tasks assigned by others (•N)` tab, with a link back to the
   source page (read-only for Aditya unless the source page is
   shared with him)
4. Aditya hits **Accept** → item moves to his `My checklist`;
   sender's status pill flips to `Accepted`
5. Aditya checks the item done → sender's pill flips to `Done`
6. (Or Aditya hits **Decline** → pill flips to `Declined`, item
   leaves his inbox; sender gets a passive notification)

v1 inbox actions: **Accept + Decline only**. Snooze, edit-before-accept,
and reply notes are deferred.

**No Taskora workspace task is ever created.** The notebook
delegation system is intentionally separate from the workspace's task
system; managers and analytics never see notebook assignments. This
keeps notebook usage low-stakes and personal.

### 3.3 Cross-workspace mentions

When the sender @-mentions someone with whom they share **zero
workspaces**:

- The mention renders as a **grey-colored name pill** in the page
- No inbox entry is created
- The mention is text-only — purely for reference

The mention picker can search across all users (workspace-scoped
people first, then everyone else) so the sender can identify the
right person by name. Only workspace-scoped mentions trigger the
delegation flow.

---

## 4. Tables and inline math

### 4.1 Tables

- **Inline block** within a page (like Notion's `/table`)
- Multiple tables per page allowed
- Each cell can be either a literal value or a formula starting with `=`
- Cell refs are **A1-style**, scoped to that table only
  (no cross-table, no cross-page references in v1)

### 4.2 Cell formulas

v1 formula scope:

- Arithmetic: `+ - * / %` with parens
- Cell refs: `=A1+B2*0.18`
- Range functions: `=SUM(A1:A5)`, `=AVG(A1:A5)`

Out of scope for v1: `IF`, `AND`, `OR`, `COUNT`, conditional logic,
date functions, lookups. Add via a clean function-registry interface
when the need surfaces.

### 4.3 Inline math (outside tables)

Two modes coexist on the same page:

- **Auto-detect**: a line containing only numbers and operators
  evaluates automatically. `5*3+2` renders as `5*3+2 = 17`.
- **Explicit `=` prefix**: anywhere in mixed text, `=expr` evaluates
  to its result inline. `I owe Aditya =5*3+2 rupees` renders as
  `I owe Aditya 17 rupees` (original expression shown on hover).

The parser scope is the same as cell formulas (arithmetic + parens),
minus cell refs. Integers and decimals only.

### 4.4 Error rendering

- Division by zero → `#DIV/0!` (red)
- Circular reference (`A1 = A2`, `A2 = A1`) → `#CYCLE!`
- Invalid formula (`=A1+`) → `#ERR!` with tooltip explaining
- Empty cell in formula → treated as `0` (Excel behavior)
- Currency/unit symbols (`₹500 + ₹300`) → v1 strips and evaluates the
  numbers; symbol preservation is P-later

### 4.5 Implementation note

- Editor: **BlockNote** as in the prior plan
- Formula engine: ~200 LOC hand-rolled recursive-descent parser
  OR `hot-formula-parser` (~30KB). Decide at P2 based on bundle budget.
- Table block: extend BlockNote's built-in table; custom cell renderer
  swaps formula strings for evaluated values, shows the raw formula on
  focus

---

## 5. Sharing and followers

- **Default-private**: every page is visible only to its owner
- **Per-page followers**: owner explicitly adds followers via a share
  modal. Mention picker = workspace-scoped people picker
- **Read-only default**: followers can read, comment (P-later), but
  not edit
- **Promote-to-editor**: owner can explicitly upgrade individual
  followers to editor status, per page
- **No public links** in v1 (everything goes through workspace identity)

### 5.1 Visibility rules

- Project tree: a user sees their own projects + a virtual "Shared
  with me" project containing all pages where they're a follower
- Goals + Checklist: always personal, never shared, even when other
  pages of the same user are shared

---

## 6. Data model (v1)

```sql
notebook_projects(
  id, owner_id, name, sort_order, created_at, updated_at, archived_at
)

notebook_pages(
  id, project_id (nullable for orphans), owner_id, title,
  body jsonb,  -- BlockNote document tree
  created_at, updated_at, archived_at
)

notebook_page_followers(
  page_id, user_id, role text check (role in ('viewer','editor')),
  added_at, added_by
)

notebook_checklist_items(
  id, owner_id, content text, due_date date nullable,
  source_page_id nullable,  -- back-link if intent-detected
  source_assignment_id nullable,  -- if it came from someone else
  status text check (status in ('open','done')),
  sort_order, completed_at,
  parent_item_id nullable  -- subtask nesting
)

notebook_assignments(
  id, sender_id, recipient_id, source_page_id, source_block_id,
  content text,
  status text check (status in ('pending','accepted','declined','done')),
  created_at, accepted_at, completed_at,
  promoted_checklist_item_id nullable  -- set on accept
)

notebook_goals(
  id, owner_id, body jsonb,  -- single document per user, jsonb tree
  updated_at
)

notebook_page_versions(  -- P7
  page_id, version_no, body jsonb, edited_by, edited_at
)
```

All tables have **user-level ownership**, not business-level.
`business_id` does not appear on any notebook row. Workspace
membership is read at query time for sharing/mention rules.

---

## 7. Edge cases — decided

| Case | Decision |
|---|---|
| Owner deletes their account | Pages orphan; followers lose access. (Alternative: transfer to longest-tenured editor — explicitly rejected for v1 simplicity) |
| User leaves workspace they share a page from | Page access persists; they keep being a follower. Notebook outlives workspace membership |
| Inbox spam (mass @mentions) | Soft rate-limit: 20 assignments/sender/day/recipient. Excess prompts a banner to the sender |
| Page with 1000+ messages | Virtualised render; lazy-load history. No hard cap on count |
| Two editors edit the same page in the same minute | Last-write-wins. A banner shows "X also edited 2 min ago — see history" |
| AI cost ceiling hit mid-month | Suggestions disable for the rest of the month; banner explains; checklist + notebook itself unaffected |
| Cross-workspace @mention | Text-only grey pill, no inbox entry, no intent flow |
| Auto-math false positive ("2+2 birds") | Won't fire — only pure-math lines auto-evaluate. Mixed text requires explicit `=` |
| Versioning when an editor goes rogue | P7 adds last 50 versions per page, restorable by owner |

---

## 8. Phases

| Phase | Scope | Effort |
|---|---|---|
| **P1 Foundation** | Schema (§6) + CRUD + book-spread layout shell + goals editor + flat checklist + project/page tree | 1 wk |
| **P2 Editor: chat + tables + math** | BlockNote pages with chat-style bubble rendering; inline table block with arithmetic + SUM/AVG cell formulas; inline-math auto-detect + explicit `=` | 1.5–2 wk |
| **P3 Assignment flow** | Intent T0 (regex), assign-suggestion pill, inbox tab with count badge, accept/decline, sender-side status pill, cross-workspace grey-pill rendering | 1.5 wk |
| **P4 Followers + sharing** | Share modal, read-only/editor roles, workspace-scoped people picker, "Shared with me" project view | 1 wk |
| **P5 AI Tier 1** | Haiku integration for ambiguous intent + goal extraction; $0.50/user/mo cost ceiling | 1 wk |
| **P6 Search** | Postgres FTS over own + followed pages + checklist | 1 wk |
| **P7 Polish + mobile** | Mobile tabbed nav (Goals / Checklist / Notebook), page versioning (last 50, restorable), trash + restore (30-day grace) | 1 wk |
| **P8 Realtime collab** | Yjs + Tiptap layer if user demand surfaces | deferred |

**Total**: ~8–8.5 weeks for one engineer.
**Critical path to a usable v1**: P1 → P2 → P3 → P4 ≈ **5 weeks**.

The notebook is usable end of P2 (text + tables + math + goals +
personal checklist). It becomes collaborative end of P4. AI is
incremental sugar on top of T0 heuristics that already work.

---

## 9. Deferred / not-in-scope for v1

- Page export (PDF / Markdown)
- Inbox actions beyond Accept/Decline (snooze, edit-before-accept,
  reply note)
- Conditional formulas (`IF`, `AND`, `OR`)
- Cross-table or cross-page cell references
- Currency / unit-aware math
- Ownership transfer when a user deletes their account
- Public share links (everything stays inside workspace identity)
- Comments on pages
- Realtime co-edit (Yjs)
- AI Tier 2/3 (background scan, ask-your-notes via pgvector)
- @mention notifications outside the app (push, email, WhatsApp)

---

## 10. Integration touchpoints

What the notebook touches in the rest of Taskora:

- **/businesses/mine** — for the mention picker and Shared-with-me
  scope (workspace membership lookup)
- **/users/search** — for the mention picker (workspace-scoped first,
  then global by name for grey-pill identification)
- **No reads from initiatives/tasks/programs** — notebook is
  intentionally separate from the workspace work-tracking surface
- **No writes to initiatives/tasks/programs** — assignment flow is
  notebook-internal; nothing leaks into the task system

This boundary is the key design property: the notebook is the user's
**private thinking surface**, with optional opt-in sharing. The
workspace is the **public work surface**. The two coexist without
either polluting the other.
