# Notebook ↔ Workspace-Doc Convergence — Plan

**Status:** Planning locked 2026-06-06. Build not started.
**Companion:** `WORKSPACE_DOCS_PLAN.md` (the shared TipTap surface), `PROGRAMS_PLAN.md`.
Memory: `taskora2-notebook-plan`, `taskora2-programs-roadmap`.

---

## 1. Why

The **Workspace Doc** is now a real TipTap editor (slash menu, tables, callouts, toggles,
real lists with proper Enter-exit, attachments, @-mentions, AI ✨). The **Notebook** is still a
**fully homegrown flat-`Block[]` editor** (`apps/web/app/(app)/notebook/_components/PageEditor.tsx`
+ custom SlashMenu / Checklist / tables / data-URL images / regex-markdown). Two editors = drift +
double the work to reach quality.

**Goal: one editor, two surfaces.** The Notebook adopts the TipTap editor and inherits everything,
while keeping its identity: **personal (`owner_id`), cross-workspace, with Goals / Checklist /
delegation inbox**. Personal notebook is NOT attached to shared initiatives (per
`taskora2-programs-roadmap` — that boundary stays).

## 2. Principle

Additive, no big-bang rewrite (`feedback-no-big-rewrites`). Existing pages are user data —
**migrate-on-open and keep the old `body` as a backup**, reversible. Browser-verify each phase.

## 3. Locked decisions (2026-06-06)

- **Start at N-1** (extract the shared editor) — pure refactor, zero user-data risk.
- **Images: keep inline data-URLs** (no new infra; `notebook-files` storage bucket explicitly NOT
  in scope for v1).
- **Promote a line → a personal checklist item** (`notebook_checklist_items`), the notebook-native
  equivalent of doc→task. (Delegation-to-teammate considered, deferred.)

## 4. Phases

### N-1 — Extract a shared `RichDocEditor` (pure refactor, no UX change)
Today `programs/_components/WorkDocEditor.tsx` is wired to program specifics: upload → doc
attachments, promote → initiative task, AI → `/docs/{id}/ai`, @-search → initiative-scoped. Pull the
editor into a generic component that takes **adapters**:
- `uploadAdapter?` — returns an inserted node (programs: §8 attachments; notebook: data-URL image).
- `promoteAdapter?` — programs: create task; notebook: add checklist item.
- `aiAdapter?` — programs: `/docs/{id}/ai`; notebook: page-grounded variant (N-3).
- `mentionAdapter?` — programs: initiative/task/people search; notebook: people / pages (or off).
Programs `WorkDocEditor` becomes a thin wrapper passing its adapters. **Ship + verify Programs
unchanged before touching the notebook.**

### N-2 — Notebook page body on TipTap (migrate-on-open)
- Migration: add `notebook_pages.body_doc jsonb` + a `format` flag (`'blocks' | 'pm'`).
- `blocksToProseMirror()` converter (heading / paragraph / bullet / numbered / checklist / quote /
  code / divider / table / image / callout). Runs **on open**, saves back as TipTap JSON; old `body`
  kept as backup.
- Notebook renders `RichDocEditor`. **Goals / Checklist / delegation panels stay homegrown**
  (separate surfaces, keyboard-first — not page body).

### N-3 — Notebook adapters (the features it gains)
- **AI ✨** grounded in the page (+ optionally My-Day tasks): enhance / summarize /
  **extract → checklist items**.
- **Promote** a line → personal checklist item.
- Images stay data-URL (locked).

### N-4 — Polish & retire
Page↔page backlinks/mentions; once parity is browser-proven, delete the homegrown `PageEditor`
and `SlashMenu`.

## 5. Feature parity unlocked
Full slash menu · real bullet/numbered/**to-do** lists with proper Enter-exit · TipTap tables ·
**callouts & toggles (new)** · real inline marks + @-mentions · **AI ✨ (new)** — all inherited
from the shared editor.

## 6. Risks / guardrails
- **Don't lose page data** — migrate-on-open + keep old `body` + reversible `format` flag.
- Keep keyboard-first **Goals/Checklist** homegrown (not page body).
- Notebook stays **personal / cross-workspace**; never auto-attached to shared initiatives.
- Verify in browser each phase (the claude-in-chrome MCP isn't wired into the CC session — the
  user verifies, or read-only screenshots).

## 7. Progress log
- 2026-06-06 — Plan written; decisions locked (N-1 first; data-URL images; promote→checklist).
  Pre-req shipped same day: the Workspace-Doc editor pass (#44) + AI pass (#45) + the list-exit fix
  (#46, `@tiptap/extension-list-keymap`). Next: build N-1 (extract `RichDocEditor`).
