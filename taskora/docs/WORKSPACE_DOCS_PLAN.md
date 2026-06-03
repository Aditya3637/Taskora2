# Workspace Documents — Complete Technology, Design & Journey Plan

**Status:** Design locked, build not started. Last updated 2026-06-03.
**Scope:** The complete, canonical plan for the **Workspace Document** surface in the Programs
section — *what it is, what we show at the initiative level, how it expands, every feature
(including uploads), how it's all connected, and the full member / admin / founder journeys.*
Companion to `PROGRAMS_PLAN.md` (which sequences the whole roadmap). When the two disagree on the
doc surface, **this doc wins**.

**Reading order:** §1–3 orientation · §4–5 tech & data · §6–9 features (incl. uploads) · §10
connection map · §11 journeys + permissions · §12 API · §13 build phases · §14 config · §15
wireframes · §16 open decisions.

---

## 1. What a Workspace Document is (and is not)

A **Workspace Document** is a shared, structured work surface that lives **on an initiative**. It
is where the Initiative Owner writes the plan, recovery notes, vendor SOW, decisions — the
narrative the tasks and dashboards can't hold. It is governed by the workspace's existing
visibility rules, so "who can see this doc" needs **no new sharing model**.

| | Personal Notebook (exists today) | **Workspace Document (new)** |
|---|---|---|
| Scope | user-scoped (`owner_id`), cross-workspace | **business-scoped, attached to an initiative** |
| Visibility | the owner + explicit followers | **the initiative's visibility cascade** (`deps.py`) |
| Editor | homegrown flat `Block[]` | **TipTap / ProseMirror** (§4) |
| Files | images as inline data-URLs in JSONB | **real uploads in Supabase Storage** (§8) |
| Purpose | private capture / thinking | **shared execution record** |
| Table | `notebook_pages` (migration 043) | **`workspace_docs` (new, migration 047)** |

**Three hard rules:**
1. **Program level has NO manual document.** The program surface is an **AI-generated summary
   only** — a regenerable rollup of its initiatives' work docs + live data (D4 at program scope;
   §9). No editor at the program level, ever.
2. **The personal notebook is not touched.** We do not rewrite it onto the new stack and do not
   attach personal pages to shared initiatives. The bridge is a deliberate **pull-in** (§7).
3. **Visibility is inherited, never re-invented.** A doc on initiative X is visible to exactly
   whoever can see initiative X (§11). No per-doc ACLs.

Direction of flow: **private notes → pulled into the initiative Work Doc (shared) → work docs +
live data → AI summary at the program level.** Bottom-up execution, top-down attention.

## 2. Where it sits in the Programs section

```
PROGRAM  ───────────────────────────  ✨ AI Summary ONLY (generated, regenerable ↻)
  │                                     rolls up ↓ its initiatives' work docs + live data
  ├── INITIATIVE ─ [Overview/dashboard] [Work doc]✦ [Tasks]
  │                     │
  │                     ├── 📄 Workspace Document  (TipTap; side-panel; ⤢ expand)
  │                     │      ├─ / insert · @ link · ✨ AI · 📎 upload
  │                     │      └─ 🔗 Linked notes (pull-in from personal notebook)
  │                     └── (backlinks: what @-mentions this initiative)
  └── INITIATIVE ─ …
```

- **Chosen page layout:** Option A — *Dashboard + Docs tab*. The doc opens in a **side panel**
  (slide-over) so the live initiative dashboard stays visible while writing; a `⤢` affordance
  expands the doc to full width for long-form writing.

## 3. Initiative page anatomy — what we show & how it expands

The initiative page is **three tabs over one live entity** (the dashboard never leaves):

**Tab 1 — Overview (default, the dashboard):**
- Health pill (RAG 🟢🟡🔴), outcome %, and the 60-day trend sparkline (reuses P2 `program_snapshots`
  pattern at initiative scope).
- Task rollup: open / overdue / blocked / awaiting-approval counts (reuses Daily Brief math).
- Owner + key dates (target_end_date); milestones (P4) on the timeline.
- A **"Work doc" preview card**: title + last-edited + a 2-line excerpt + "Open ↗" (opens the side
  panel). If no doc yet → "Start a work document" CTA (writers only; §11).

**Tab 2 — Work doc:** opens the Workspace Document (§6) in the **side panel**, dashboard still
visible at left. `⤢` expands to full width; `✕` / Esc closes back to the dashboard. This is the
default surface for the Initiative Owner.

**Tab 3 — Tasks:** the existing task board for the initiative (unchanged).

**Expand/collapse mechanics (DECIDED):**
- Open doc → **slide-over from the right**, ~480–560px, dashboard stays interactive at left.
- `⤢` → doc takes full content width (dashboard collapses to a back-arrow); good for long writing.
- Deep-link `/.../initiatives/{id}?doc={docId}` opens straight into the panel (so a backlink or an
  AI summary can link to a specific doc).
- Closing returns to whatever tab you were on — **never lose your place** (resistance principle 6).

**Program page** (one level up) shows: the ranked initiative list (by P3 health), the KRs (P1), the
status/trend (P2), and the **AI Summary** panel (§9) with a "regenerate ↻" — and **no manual
editor**.

## 4. Technology decision (DECIDED)

**Build the Workspace Doc on TipTap (ProseMirror) from day one.** Keep the personal notebook on
its existing homegrown editor.

### Why not extend the homegrown notebook editor?
Today's notebook (`apps/web/app/(app)/notebook/_lib/types.ts`) is a flat `Block[]` union serialized
to one JSONB `body` blob, edited as one `<textarea>` per block, with **whole-page last-write-wins
save**. Fine for a single private author. **Two genuine blockers for a *shared* doc:**
- **(a) Whole-page last-write-wins = clobbering.** Two editors → last saver wins. Unacceptable.
- **(b) No real inline layer.** Formatting is literal markdown in a textarea, so there's nowhere
  clean to hang `@`-mentions, inline marks, or inline embeds.

Block-level embeds and AI authoring are *not* blockers; these two are.

### Why TipTap (ProseMirror) over the alternatives
- **ProseMirror** = a real document model (schema + nodes + marks + transactions) → makes
  `@`-mentions, inline marks, **node-views for live embeds** (a live chart / initiative card), and
  **transaction-level autosave** tractable.
- **TipTap** = the mature React wrapper (Notion/Granola lineage), big extension ecosystem, clean
  upgrade path to real-time collab. **Lexical** was the considered alternative; TipTap wins on
  ecosystem + node-views + collab story.
- This is a **scoped adoption for a new surface**, not a rewrite of anything existing — blast
  radius is one new surface ([[feedback-no-big-rewrites]] honored).

### Collaboration — single-editor + presence for v1
- **Defer real-time CRDT (Yjs).** Yjs needs a stateful websocket sync server, which fights the
  Vercel-serverless backend. Not stood up for v1.
- **v1 ships:** transaction/block-level **autosave** + **presence** ("Asha is viewing") + a soft
  **"X is editing"** advisory lock. Good for the realistic case (one owner writes, others read).
- **Schema + save protocol designed so Yjs / Liveblocks / TipTap Cloud drops in later** with no
  data migration (store ProseMirror JSON now; a Yjs update log layers alongside later).

### Personal-notebook migration — deferred, optional
Migrating the notebook onto TipTap later is feasible (flat blocks → PM nodes is mechanical) but
**deferred** until the shared surface proves out. Coexistence is fine.

## 5. Data model (DECIDED — migration 047)

Backend-only RLS (service-role gated), like the automation tables.

### `workspace_docs`
```sql
create table workspace_docs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  parent_type  text not null default 'initiative'
                 check (parent_type in ('initiative')),  -- program has no manual doc (rule §1)
  parent_id    uuid not null,                            -- initiatives.id
  title        text not null default 'Work document',
  body         jsonb not null default '{}'::jsonb,       -- ProseMirror/TipTap document JSON
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index on workspace_docs (business_id, parent_type, parent_id) where archived_at is null;
```
- **`body` is ProseMirror JSON** (not the homegrown `Block[]`): clean node mapping → AI- and
  migration-friendly. **Uploads are referenced by id, never embedded as bytes** (§8) — unlike the
  notebook's data-URL approach, so the JSONB stays small.
- Polymorphic parent mirrors `milestones` / `comments`. CHECK enforces "program has no manual doc".

### `doc_attachments` (uploads — §8)
```sql
create table doc_attachments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  doc_id        uuid not null references workspace_docs(id) on delete cascade,
  storage_path  text not null,        -- '{business_id}/{doc_id}/{uuid}-{filename}' in the bucket
  filename      text not null,
  mime_type     text not null,
  size_bytes    bigint not null,
  uploaded_by   uuid not null references users(id),
  created_at    timestamptz not null default now()
);
create index on doc_attachments (doc_id);
```

### `entity_links` (connective tissue / backlinks — §10)
```sql
create table entity_links (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  source_type  text not null,   -- 'doc'
  source_id    uuid not null,   -- workspace_docs.id
  target_type  text not null,   -- 'initiative' | 'task' | 'doc' | 'user' | 'note'
  target_id    uuid not null,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now()
);
create index on entity_links (target_type, target_id);   -- backlinks: "what links TO this?"
create index on entity_links (source_type, source_id);    -- "what does this doc link to?"
```
`notebook_assignments` is the narrow special-case `entity_links` generalizes; not migrated in v1.

## 6. Complete feature inventory of the Workspace Document

The exhaustive v1 feature set (anything not here is explicitly out of v1):

**Content blocks (`/` slash menu):** paragraph, headings (H1–H3), bulleted list, numbered list,
**to-do / checkbox**, quote, callout, code, divider, **table**, **image**, **file attachment**,
**live chart** (initiative burnup / KR progress), **initiative/task embed** (live node-view card).

**Inline layer (ProseMirror marks):** bold, italic, underline, strikethrough, inline code, link,
and **`@`-mention** (initiative / task / doc / person).

**Core surfaces & actions:**
- **`/` insert** — add any block above.
- **`@` link** — mention an entity; writes an `entity_links` row → backlinks. `@person` + a to-do
  can drop a delegation into that person's notebook inbox (reuses `notebook_assignments`).
- **`✨` AI** — draft / summarize / rewrite from the doc + live data (async; §9). AI drafts, human
  posts. Never auto-posts.
- **`📎` upload** — attach images & files (§8).
- **🔗 Linked notes** — pull a private note in (§7).
- **Autosave + presence + soft edit-lock** (§4).
- **Title + icon**, **archive/restore** (soft delete via `archived_at`).
- **Backlinks panel** — "what mentions this initiative/doc" (read from `entity_links`).

**Deliberately OUT of v1 (listed so scope is explicit):** real-time multiplayer cursors (Yjs),
inline doc comments/threads, full version history/diff, public share links, doc templates, export
to PDF/Word, nested sub-pages. Each is a fast-follow once v1 proves out; the schema doesn't block
any of them.

## 7. Link-to-notes — the pull-in model (DECIDED)

"The work doc is **linked to notes**" = **pull-in** (chosen over live-sync and backlinks-only):
- A user's **private** notebook note can be **pulled/promoted** into the shared work doc — **copied
  in** and recorded as a linked reference (`entity_links` source=doc, target=note). Personal stays
  personal until the user pulls.
- **Why pull-in:** keeps the personal/shared boundary clean (nothing private leaks until the user
  acts) and avoids bidirectional sync infra. Backlinks-only wouldn't move the content where the
  team needs it.
- **Mechanics:** "pull in note" reads the personal note's blocks → transforms to ProseMirror nodes
  → inserts at the cursor → writes the `entity_links` row. The source note is unchanged. **You can
  only pull your OWN notes** (can't reach into another user's private notebook — §11).

## 8. Uploads & attachments (NEW capability)

The app has **no Supabase Storage today** (the notebook embeds images as compressed data-URLs in
JSONB, which bloats the body and can't hold real files). Workspace Docs introduce **real file
storage** — the first storage use in the product.

- **Store:** a **private Supabase Storage bucket** `workspace-docs` (not public). Object path is
  **tenant-prefixed**: `{business_id}/{doc_id}/{uuid}-{filename}`.
- **Upload flow:** FE asks the backend for a **short-lived signed upload URL** (backend verifies
  the caller has write access to the doc's initiative first) → FE uploads directly to Storage →
  FE calls `POST /docs/{id}/attachments` to record a `doc_attachments` row → an image/file node is
  inserted into the doc body referencing the `attachment_id` (never the bytes).
- **Read flow:** rendering an attachment calls `GET /attachments/{id}/url`, which **re-checks doc
  visibility** (§11) and returns a **short-lived signed download URL**. The bucket is never public,
  so a leaked path is useless without a fresh signature.
- **Allowed types:** images (png/jpg/webp/gif), PDF, office docs (pdf/docx/xlsx/csv/pptx), plain
  text. **Size cap** ~25 MB/file (configurable; §14). Reject executables.
- **Rendering:** images → inline image node with caption + width %; other files → a file-chip block
  (icon + filename + size + download). 
- **Lifecycle:** deleting/archiving a doc cascades `doc_attachments` (FK `on delete cascade`); a
  background sweep removes orphaned Storage objects (a job on the automation engine).
- **Tenant isolation (the loophole to test):** the `business_id` path prefix + the visibility
  re-check on every signed-URL request means a user from business B can never fetch an attachment
  from business A, even with the object path.

## 9. AI integration — async, never in the request path

- **Where it runs:** the **existing lifecycle jobs/cron engine** (`apps/backend/automation/` —
  `runner.tick`, `automation_jobs`, `events.emit`). A "generate program summary" job is enqueued
  and processed out-of-band — **never** synchronously in an HTTP request.
- **Model + caching:** Anthropic SDK with **prompt caching** — cache the program's structured
  context (rollup + KRs + the initiatives' work-doc JSON) so regenerations are cheap. **Sonnet**
  for routine/regenerate, **Opus** for the deep weekly brief. ([[claude-api]] skill: include
  prompt caching.)
- **Program summary (D4):** the program-level "doc" *is* this output — an auto-drafted, regenerable
  read-only summary (stored as a `program_update` flavor) with "regenerate ↻". It reads each
  initiative's work doc + live data → a RAG narrative + a drafted status. **AI drafts, human
  approves** before it's official.
- **Doc-level `✨`:** summarize-this-doc / draft-a-status / rewrite — same async pattern, scoped to
  one doc. The human reviews and posts.

## 10. Connection map — how everything is wired

```
            ┌──────────────── program AI summary (generated) ────────────────┐
            │  reads ↑ work-doc JSON + live rollup/KR data of each initiative │
            └───────────────────────────▲────────────────────────────────────┘
                                         │ rolls up
   personal note ──pull-in──▶ WORKSPACE DOC ◀── @mention ── task / initiative / person
        (entity_links: doc→note)   │   │  │              (entity_links: doc→target)
                          uploads ─┘   │  └─ @person+todo ─▶ notebook_assignments (their inbox)
                       (doc_attachments)│
                                        └─ backlinks ◀── entity_links indexed by (target_type,id)
                                              shown on the initiative's "Docs & mentions" panel
```

**Every connection is one of three tables:** `entity_links` (mentions/backlinks/note-pulls),
`doc_attachments` (uploads), `notebook_assignments` (person delegations). Visibility everywhere
flows from the **initiative cascade** in `deps.py`. The AI reads this graph; it does not get its
own copy of anything.

## 11. Customer journeys + permissions (member / admin / founder + owner / lead / follower)

### Permission model (grounded in existing code)
- **Read a doc** = can see its initiative → `visible_initiative_ids` / `v_user_visible_initiatives`
  (includes followers, task watchers, program followers).
- **Edit a doc / upload / pull-notes** = has **write** on its initiative →
  `writable_initiative_ids` (primary stakeholder, task stakeholder, task creator) **OR**
  `is_admin_or_owner` **OR** program `lead_user_id`.
- **Create / archive a doc** = same write set.
- **Regenerate the program AI summary** = admin / owner / program lead (gated like program edit —
  the **N3** fix).
- **Followers / clients** = read-only always (never edit/upload/pull/regenerate).
- **Pull-in a note** = the puller's **own** private notes only.

### Doc-surface permission matrix

| Action | Founder/Owner | Admin | Program Lead | Initiative Owner (primary) | Contributor (task stakeholder) | Follower / Client |
|---|---|---|---|---|---|---|
| See program AI summary | ✅ | ✅ | ✅ | ✅ (their program) | ✅ (their initiative's) | ✅ (read-only) |
| Regenerate AI summary | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read a work doc | ✅ all | ✅ all | ✅ in program | ✅ own initiative | ✅ initiatives they're on | ✅ followed only |
| Create / edit work doc | ✅ | ✅ | ✅ | ✅ | ✅ (write via task) | ❌ |
| Upload / pull-in notes | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Archive / delete doc | ✅ | ✅ | ✅ | ✅ (own) | ❌ | ❌ |

*(**DECIDED 2026-06-03: contributors can edit.** Doc-edit = initiative write set, so any
contributor with write access to the initiative (primary stakeholder, task stakeholder, task
creator) can co-author the shared work doc; followers/clients stay read-only. An owner-only mode
is **not** in v1 — if a workspace ever needs it, it becomes a §14 per-workspace toggle, but the
default and only v1 behavior is contributors-can-edit.)*

### Journey 1 — **Member as Initiative Owner** (the primary author)
Home = **the Initiative page**. Opens their initiative → dashboard at left, opens the **Work doc**
in the side panel. Writes the plan with `/`; `@`-mentions the blocked task and `@Asha` (drops a
to-do in Asha's inbox); **uploads** the vendor PDF; **pulls in** last night's private "vendor call"
note; hits `✨` to draft a status from the live data, edits it, posts the RAG. Their work flows
**up** into the program AI summary. *Sees only their own initiatives' docs; can't regenerate the
program summary.*

### Journey 2 — **Member as Contributor** (task stakeholder, not owner)
Home = **personal cockpit ("My day")**. Their tasks + approvals + delegations + checklist come
**to them** — they never walk the tree. They can **open and co-edit** the work doc of any
initiative they're on (write via their task), and `@`-mentions addressed to them land in My-day.
*Cannot see initiatives they're not attached to; followers among them are read-only.*

### Journey 3 — **Admin**
Sees **every** program/initiative/doc (admin bypasses visibility scoping). Can edit any doc,
regenerate any program summary, manage the roster. Their **own** My-day is still personal — admin
does **not** see members' private delegations/checklist. Acts as the workspace's editor-in-chief +
unblocker.

### Journey 4 — **Founder / Owner** (glance & nudge)
Home = **Portfolio / AI summary**. Reads the program AI summaries ranked by risk (P3), sees the 2–3
things needing them, **nudges** the Lead/Owner in one click. Rarely edits a doc — they **read,
never dig**. Full visibility (owner), zero data-entry friction.

### Journey 5 — **Program Lead**
Home = **the Program page**. Plans: program → KRs → initiatives → assigns owners. Can edit docs in
their program's initiatives and **regenerate** the program AI summary. The bridge between Founder's
intent and Owners' execution.

### Journey 6 — **Follower / Client** (read-only)
Gets a **read-only** view of the initiative/program they follow — sees the work doc + AI summary,
**cannot** edit, upload, pull, or regenerate. The "watch without touching" persona; a client sees a
clean shared summary, no app tour needed.

### Isolation loopholes to TEST (backend pytest, before applying)
- Non-member of the business → 403 on every doc endpoint.
- Cross-tenant: business B user can't read/edit a business A doc **or fetch its attachment** by id.
- Follower can read but every write/upload/pull/regenerate → 403.
- A user can't pull-in **another user's** private note.
- Member A can't see member B's doc on an initiative A isn't attached to.
- Regenerate-summary by a non-lead member → 403.

## 12. Backend API surface (proposed)

All under the initiative-visibility gate (§11). Mounted like the other routers in `main.py`.

| Method | Path | Purpose | Gate |
|---|---|---|---|
| `GET`  | `/api/v1/initiatives/{id}/docs` | list docs on an initiative | read |
| `POST` | `/api/v1/initiatives/{id}/docs` | create a work doc | write |
| `GET`  | `/api/v1/docs/{doc_id}` | read one doc (PM JSON) | read |
| `PATCH`| `/api/v1/docs/{doc_id}` | autosave body / title | write |
| `POST` | `/api/v1/docs/{doc_id}/archive` | soft-delete / restore | write (owner/admin/lead) |
| `POST` | `/api/v1/docs/{doc_id}/links` | record an `@`-mention / link | write |
| `GET`  | `/api/v1/docs/{doc_id}/backlinks` | what links to this doc / initiative | read |
| `POST` | `/api/v1/docs/{doc_id}/pull-note` | pull caller's own note into the doc | write |
| `POST` | `/api/v1/docs/{doc_id}/attachments:sign` | get signed UPLOAD url | write |
| `POST` | `/api/v1/docs/{doc_id}/attachments` | record an uploaded attachment | write |
| `GET`  | `/api/v1/attachments/{id}/url` | signed DOWNLOAD url (re-checks visibility) | read |
| `POST` | `/api/v1/programs/{id}/summary:regenerate` | enqueue async AI summary job | admin/owner/lead |
| `GET`  | `/api/v1/programs/{id}/summary` | read the latest generated summary | read |

## 13. Build phases (maps onto PROGRAMS_PLAN §8)

- **D0 — Workspace Docs engine** *(biggest item)*: TipTap in web; `workspace_docs` + `entity_links`
  + `doc_attachments` tables (migration 047); the Storage bucket; autosave + presence; clean
  JSON↔node schema. Backend CRUD + the §11 loophole matrix fully pytest-tested before applying.
- **D2 — Initiative Work Doc**: the surface on the initiative page (§3 side-panel, `/`, `@`, `✨`,
  `📎`).
- **D3 — Cross-links / backlinks**: `entity_links` wired into the `@` picker + the initiative's
  "Docs & mentions" panel.
- **D4 — AI program summary**: async job on the automation engine; program level = generated only.
- **D5 — Doc-driven creation**: "promote a block → initiative/task."

**Verification rule (inherited):** backend fully tested via pytest (member/admin/founder + isolation
loopholes, §11) BEFORE applying; UI built but flagged for in-browser confirm; nothing
merges/deploys until green; honor `feedback-no-big-rewrites`.

## 14. Configuration & settings

- **Per-workspace doc settings** (small `automation_settings`-style row or a new `workspace_settings`
  key): upload size cap, allowed MIME list, and the open **"docs editable by contributors vs
  owners-only"** toggle (§16.4 default = contributors).
- **AI campaign toggles** reuse the existing `automation_settings` kill-switch pattern (program
  summary auto-regenerate cadence: off / weekly / daily).
- **Storage bucket** `workspace-docs` provisioned once (private; signed-URL access only).
- **Env:** the AI jobs need `ANTHROPIC_API_KEY`; reuses the cron/job secret already in place for the
  lifecycle engine.

## 15. Wireframes (finalized last session)

**A — PROGRAM level: AI summary only (no editor)**
```
┌ BACnet Rollout ───────────────────────────── 🟡 At risk ┐
│ [Overview]  [AI Summary]✦  [Gantt]  [Risks]              │
├──────────────────────────────────────────────────────────┤
│ ✨ AI Summary           regenerate ↻ · updated 1d ago     │
│ 🔴 Site B off track (controls vendor +2 wks). Cost on    │
│ track. 2 initiatives at risk. Focus: escalate Site B.    │
│ Rolled up from each initiative's work doc + live data:    │
│  • Site A 🟢 92% · work doc 2d   • Site B 🔴 40% · doc    │
│  • Site C 🟡 60% · no doc yet                              │
└──────────────────────────────────────────────────────────┘
```
**B — INITIATIVE level: Work Document + linked notes (side panel)**
```
┌ BACnet Rollout ────────────────┬ 📄 Site B recovery plan ⤢ ✕ ┐
│ [Overview] Health 🟡 Out 60%   │ 🔗 Site B · 👥 share ▾ · ✨   │
│ ▁▂▃▅▆ trend                    ├──────────────────────────────┤
│ INITIATIVES / tasks            │ # Recovery plan              │
│ ▸ Site B controls ⛔40% 🔴 ◀───│ - [ ] Re-baseline @Task #214 │
│  ↑ live dashboard (stays)      │ /chart ▁▂▂▃  📎 vendor.pdf   │
│                                │ ─ 🔗 Linked notes ─ + link    │
│                                │  📓 "vendor call" ▸ pull in   │
└────────────────────────────────┴──────────────────────────────┘
```
**C — Writing: `/` insert · `@` link**
```
│ /▌  ┌ INSERT ──────────┐  ┌ @ LINK ───────────┐ │
│     │ ¶ Text  H Heading│  │ ▸ Site B controls 🔴│ │
│     │ ☐ To-do ▦ Table  │  │ ◉ Task #214 risers │ │
│     │ 📊 Chart 📎 File  │  │ 👤 Asha (notifies) │ │
│     │ ◳ Initiative embed│  └────────────────────┘ │
```
**D — Founder home (glance & nudge) / Member home ("My day")**
```
┌ Portfolio ───────────── week ┐   ┌ My day ──────────────────────┐
│ 🔴 BACnet  out 60% ↓ 2 risks │   │ ▢ Re-baseline Site B  today🔴 │
│ 🟡 Energy  out 78% →         │   │ ▢ Confirm install ← from Asha │
│ ✨ Needs you:                │   │ ◷ Approve: Site A closeout    │
│  • Site B slip [nudge Lead]  │   │ ─ from my notes ─ checklist(3)│
└──────────────────────────────┘   └──────────────────────────────┘
```

## 16. Open decisions (resolve before D0)
1. **Presence/lock transport** — poll `updated_at` + a heartbeat row, or a Supabase Realtime
   presence channel? (Leans poll for v1.)
2. **Autosave granularity** — debounce the whole PM doc (simplest) vs node/step diffs (sets up Yjs).
   (Leans whole-doc debounce; schema unchanged either way.)
3. **Multiple docs per initiative** — single canonical "Work document" in v1, or a list from day
   one? (Table supports many; UI can start with one.)
4. ✅ **Doc edit scope — DECIDED: contributors can edit** (initiative write set). Owner-only is not
   in v1; would only ever be a §14 per-workspace toggle if a customer demands it.
5. **Attachment cap & MIME allow-list** — confirm 25 MB + the office/image set.

## 17. Progress log
- 2026-06-03 — Doc created, then **expanded to a complete spec**: added §3 initiative-page anatomy
  (tabs + side-panel expand mechanics), §6 full feature inventory, **§8 uploads/attachments**
  (new Supabase Storage capability + `doc_attachments` + tenant-isolation loophole), §10 connection
  map, **§11 full member/admin/founder + owner/lead/follower journeys with a permission matrix and
  loophole list**, §12 expanded API (incl. upload/summary endpoints), §14 config/settings, §15
  finalized wireframes. Locked: TipTap/ProseMirror; `workspace_docs` + `entity_links` +
  `doc_attachments` (migration 047); pull-in notes; async AI on the lifecycle engine; program =
  AI summary only. Next: resolve §16 open decisions, then build D0 (the docs engine).
