# Safety & Architecture Audit — Tasksheet

Snapshot of the 2026-05-24 audit pass. Use this file to pick up deferred
work later. Each item carries enough context to start without re-reading
the entire audit.

---

## ✅ Shipped 2026-05-24 (this pass)

### Critical (security)

- [x] **C1 — Kill admin escalation** · migration `040_platform_admins.sql` · `routers/admin.py:require_admin` · `routers/users.py:get_me`
  - Moved `is_admin` out of the user-writable `users.settings` JSONB into a
    locked-RLS `platform_admins` table. 2 admins backfilled.
  - FE: `(app)/layout.tsx` reads `is_platform_admin` from `/users/me`
    instead of the (still-user-writable) `user_metadata.is_admin`.
  - Updated `setup_owner.py` to seed via `platform_admins`.
- [x] **C3 — Scope `/users/search` to caller's tenants** · `routers/users.py:search_users`
  - Used to leak names across every workspace in the DB.

### Important

- [x] **H1 — Unified task-read gate** · `routers/tasks.py:get_task`
  - `GET /tasks/{id}` now uses `_assert_task_access` like every other read
    path. Admins + initiative primaries can open tasks again.
- [x] **H6 — Prod CORS hardening** · `main.py`
  - `localhost:3000` is now only allow-listed when `frontend_url` itself
    is localhost (dev mode).
- [x] **H5 — Notification HTML escape** · audit-only
  - Invite email already uses `_html.escape`. Push notifications are
    plain text (no HTML render). No change needed.
- [x] **H3 — Rate limiting** · `rate_limit.py` · `routers/invites.py` · `routers/users.py`
  - slowapi + per-IP keys. `GET /invites/{token}` 30/min,
    `GET /users/search` 60/min.
- [x] **H2 — Atomic business creation** · audit-only
  - Already had compensating-delete in `businesses.py:create_business`.
- [x] **H4 — Daily-brief 60s cache** · `routers/daily_brief.py:_brief_cache`
  - Absorbs cold-start + Supabase blips that were causing intermittent
    500s. Cache key keys off `id(sb)` so FakeSupabase tests don't share.

### Architectural

- [x] **A7 — Materialized visibility cascade** · migration `041_visibility_view.sql` · `deps.py:visible_initiative_ids`
  - View `v_user_visible_initiatives` unions all 7 cascade branches into
    one query. Python helper queries the view in prod (1 round-trip);
    falls back to in-Python union for FakeSupabase tests.
- [x] **M5 + A3 — Structured logging + Sentry** · `main.py`
  - Sentry SDK (opt-in via `SENTRY_DSN` env var). X-Request-ID middleware
    + response header. Unhandled-500 body now includes the request ID
    so support can correlate with Vercel logs.
- [x] **M6 — Extract apiFetch** · `lib/api.ts` (enhanced) · daily-brief migrated
  - `ApiError` interface carries status + detail. 9 other pages still
    have inline copies (see Deferred below).
- [x] **M8 + M9 — Email + session hardening** · `lib/api.ts` · `routers/invites.py`
  - 12 disposable email domains blocked at invite create. 6s timeout on
    `supabase.auth.getSession()` to fail-fast the auth-lock wedge.
- [x] **A4 — Dependency audit script** · `scripts/security-audit.sh`
  - Runs `pip-audit` (Python) + `npm audit --audit-level=high` (web).
    Returns non-zero so CI can gate on it.
- [x] **A6 — Schema snapshot** · `apps/backend/migrations/SCHEMA.md`
  - Per-table inventory with first-introduced migration. New contributors
    don't need to scroll through 41 migration files.

---

## ⏳ Deferred — pick up later

### Big architectural moves

- [ ] **A1 — Split Vercel function** · `apps/backend/vercel.json`
  - Single `/api/index` serves all 148 endpoints. ~5s cold start (per
    deploy-topology memory). Worth splitting auth, billing webhooks, and
    daily-brief into separate functions so spikes on one don't contend
    the same pool.
  - **When to revisit**: cold start becomes user-visible pain or a single
    endpoint regularly times out.
- [ ] **A2 — Background job queue**
  - Email / push / Slack today fire synchronously inside request paths.
    A failed Resend call breaks invite creation.
  - **When to revisit**: first time a notification needs retries or a job
    needs to outlive a function timeout. Likely Inngest or Trigger.dev.
- [ ] **M4 — Real-DB integration tests** · `apps/backend/tests/`
  - All 210 tests run against FakeSupabase. Several real-world bugs
    (`buildings.code` tenancy, daily-brief 500s) couldn't be caught here
    because the fake's constraint coverage isn't 1:1 with Postgres.
  - **Plan**: add a `tests/integration/` layer that hits a Supabase
    branch DB via the MCP. Run on CI, not on every local test.
- [ ] **M7 — Split `apps/web/app/(app)/tasks/page.tsx`** (4400 lines)
  - `TaskCard`, `SubtaskRow`, `TaskDetailSheet`, `CommentsPopup`,
    `WatcherStrip`, `ApprovalControls` should each live in their own file.
  - **Risk**: high — page is feature-dense and the components share a
    lot of closure state. Do as one focused PR with a careful review.

### Polish

- [ ] **9 inline `apiFetch` copies still left** in:
  - `tasks/page.tsx`, `workspace/settings/page.tsx`, `admin/page.tsx`,
    `programs/EditInitiativeModal.tsx`, `programs/page.tsx`,
    `programs/[programId]/page.tsx`, `analytics/page.tsx`,
    `invite/[token]/page.tsx`, `(auth)/onboarding/page.tsx`
  - Replace each with `import { apiFetch } from "@/lib/api"` whenever the
    page is next touched. Shared client now has the matching `ApiError`
    contract so the migration is mechanical.
- [ ] **M3 — Down migrations** · `apps/backend/migrations/`
  - Going forward-only is now the documented policy (SCHEMA.md). If we
    ever want true rollbacks, add `0NN_*.down.sql` next to each forward
    file.
- [ ] **A5 — Formal API versioning policy**
  - Only meaningful once there's a second consumer (mobile / partner).
    Today the FE and backend deploy together.

### Process

- [ ] **Wire `scripts/security-audit.sh` into CI**
  - Script exists; add a weekly GitHub Action that runs it and opens an
    issue on a high-severity finding.
- [ ] **Set `SENTRY_DSN` env var** on the backend Vercel project
  - Without the env var Sentry init is a no-op. Pasting a Sentry project
    DSN turns on capture immediately — no code change needed.
- [ ] **Periodic `SCHEMA.md` refresh**
  - Snapshot bumps on every migration that adds/removes a table. Easiest
    pattern: add it to the migration PR template.

### Smaller cleanups

- [ ] **`tests/test_analytics_reports.py` date-boundary flakes**
  - 2 tests fail when today === a hardcoded seed date + 7 days. Change
    seeds to relative offsets (`(today - timedelta(days=12)).isoformat()`)
    instead of literals.
- [ ] **Logger: switch from `print()` + `logger.info()` mix → structlog**
  - `main.py` now uses `logger`, but `daily_brief.py` and others still
    `print()`. Standardize.
- [ ] **`page.tsx` task card — broader inline-apiFetch + extract`
  - Bundled with M7 when the page is split.

---

## Reference

- Original audit findings: see commit/chat history 2026-05-24.
- Migrations applied this pass: **040** (platform_admins), **041** (visibility view).
- Backend deploy verified: `backend-r0xi9cafw…` · sin1.
- Web deploy verified: `web-ir0ye7uwg…`.
- Test baseline: 208/210 (2 date-flakes unrelated).
