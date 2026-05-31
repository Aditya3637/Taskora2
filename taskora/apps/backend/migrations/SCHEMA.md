# Schema snapshot

Generated from `inndogwdzjcwbjlnldfa` (prod) at migration 041.

This is a high-level table inventory so new contributors don't have to
read all 41 migration files to understand the data model. For column-
level detail, query Supabase directly or read the migration that owns
each table (see "first introduced" column).

| Table | Cols | Purpose | First introduced |
|-------|------|---------|------------------|
| `users` | 8 | Auth users + profile (name, avatar, settings JSONB for non-auth flags). | 001 |
| `businesses` | 18 | Workspaces. Owner-scoped, one per user. Includes mode, profile, identity (037). | 001 |
| `business_members` | 6 | (business_id, user_id, role). Joins user → workspace. Adds onboarded_at (035), can_view_people_board. | 001 |
| `platform_admins` | 4 | **Locked RLS.** Replacement for the old `users.settings.is_admin` flag — service-role-only writes. | **040** |
| `buildings` | 16 | Per-workspace building entities. Code is `UNIQUE(business_id, code)` since 034. | 001 |
| `clients` | 8 | Per-workspace client entities. | 001 |
| `themes` | 8 | Initiative impact themes. | 005 |
| `programs` | 13 | Top of the work hierarchy. | 006 |
| `program_followers` | 4 | Read-only program-scope followers (apex of the visibility pyramid). | **038** |
| `initiatives` | 17 | Programs contain initiatives. `primary_stakeholder_id` for ownership. | 002 |
| `initiative_entities` | 4 | Initiative ↔ building/client M:N. | 002 |
| `initiative_followers` | 4 | Initiative-scope explicit followers (read-only). | 033 |
| `tasks` | 21 | Initiative contains tasks. `created_by` (032) for the visibility cascade. | 002 |
| `task_entities` | 8 | Task ↔ entity M:N, per-entity status + closed_at + approval. | 002 |
| `task_stakeholders` | 4 | Task ↔ user M:N (primary/secondary/follower). | 002 |
| `task_date_change_log` | 10 | Append-only diff of every due-date change. | 020 |
| `subtasks` | 17 | Two-level nesting via `parent_subtask_id` (016). description/due/priority added in 039. | 002 |
| `subtask_entities` | 5 | Subtask ↔ entity M:N. | 002 |
| `item_watchers` | 9 | Polymorphic watchers/approvers at task, subtask, or entity scope. | 021 |
| `approval_log` | 9 | Append-only record of approve/reject events. | 022 |
| `comments` | 9 | Polymorphic comments (task, entity, or subtask). `kind` added 023. | 002 |
| `decision_log` | 7 | Append-only record of `/tasks/{id}/decisions` actions. | 002 |
| `attachments` | 10 | File pointers per task. | 002 |
| `milestones` | 8 | Polymorphic milestones (initiative or task). | 005 |
| `milestone_entities` | 4 | Milestone ↔ entity M:N. | 005 |
| `activity_log` | 13 | Workspace-level audit feed. | 006 |
| `workspace_invites` | 9 | Token-based invite flow. Soft-revoked via 029. | 006 |
| `workspace_join_requests` | 7 | Inverse flow — user requests to join. | 027 |
| `subscriptions` | 12 | Razorpay/Stripe state per workspace. Trial auto-created by trigger. | 003 |
| `invoices` | 9 | Mirrored billing receipts. | 003 |
| `sales_leads` | 10 | Admin-only sales CRM. | 006 |
| `assignees` | 4 | Personal-mode helper (workspace_mode='personal'). | 011 |

## Views

| View | Replaces | Notes |
|------|----------|-------|
| `v_user_visible_initiatives` | Python-side union in `deps.visible_initiative_ids` | Single source of truth for "can user X see initiative Y". Reads 7 UNION branches into 1 round-trip. Added migration 041. |

## RLS posture

- All app tables have RLS enabled. Policies in `004_rls.sql` + per-migration additions.
- Backend uses the service-role key → RLS bypassed. Defense-in-depth only.
- **`platform_admins`** has RLS enabled with NO policies → service-role-only (the security-critical case).

## Migration policy

- Forward-only. No down migrations. If a migration is wrong, write a corrective forward migration.
- Each migration must be idempotent (`IF NOT EXISTS`, `OR REPLACE`, `ON CONFLICT DO NOTHING`).
- Apply via Supabase MCP (`apply_migration`); the local `.sql` file is the source of truth.
- Bump this snapshot when adding/removing tables.
