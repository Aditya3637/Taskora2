"""Shared decision-context enrichment for Daily Brief and War Room.

Both surfaces exist so a user can decide *fast*. To do that each task row
needs the project context around it (where it rolls up, who's waiting, the
latest signal, what's blocking) and a stable `link` back to the exact
task / subtask / initiative / program.

`enrich_task_items` takes rows the caller has already fetched and authorised
(so we never widen access here) and decorates them in place. Every external
table is read with a single batched `in_(...)` query — the number of queries
is constant regardless of how many tasks are passed in (no N+1).
"""
from datetime import date
from typing import List

from supabase import Client

# Subtask status enum (migration 002) has no 'blocked' — open == not done.
_DONE = ("done", "archived", "cancelled")


def _today() -> date:
    return date.today()


def _days_overdue(due: str | None, status: str | None) -> int:
    if not due or status in ("done", "archived"):
        return 0
    try:
        d = date.fromisoformat(due[:10])
    except ValueError:
        return 0
    delta = (_today() - d).days
    return delta if delta > 0 else 0


def make_link(task: dict, *, subtask_id: str | None = None) -> dict:
    """Stable navigation target for a task row. `type` is the most specific
    thing the row represents so the UI can pick inline-expand vs route."""
    return {
        "type": "subtask" if subtask_id else "task",
        "task_id": task.get("id"),
        "subtask_id": subtask_id,
        "initiative_id": task.get("initiative_id"),
        "program_id": task.get("program_id"),
    }


def _newest_by(rows: list, key: str, ts: str = "created_at") -> dict:
    """Reduce rows to the newest one per `key` (Python-side, single pass)."""
    best: dict = {}
    for r in rows:
        k = r.get(key)
        if k is None:
            continue
        cur = best.get(k)
        if cur is None or (r.get(ts) or "") > (cur.get(ts) or ""):
            best[k] = r
    return best


def enrich_task_items(sb: Client, tasks: List[dict]) -> List[dict]:
    """Decorate task rows with decision context. Mutates and returns `tasks`.

    Adds per row: link, initiative_name, program_id, program_name,
    primary_stakeholder_name, secondary_stakeholders[], last_comment,
    open_subtasks, done_subtasks, total_subtasks, pending_approvers[],
    days_overdue. Existing keys are never removed (back-compatible).
    """
    if not tasks:
        return tasks

    task_ids = [t["id"] for t in tasks if t.get("id")]
    init_ids = sorted({t["initiative_id"] for t in tasks if t.get("initiative_id")})

    # 1. initiatives -> name, program_id (+ owner for downstream callers)
    init_map: dict = {}
    prog_ids: set = set()
    if init_ids:
        for r in (
            sb.table("initiatives")
            .select("id, name, program_id, owner_id")
            .in_("id", init_ids)
            .execute()
            .data
        ):
            init_map[r["id"]] = r
            if r.get("program_id"):
                prog_ids.add(r["program_id"])

    # 2. programs -> name
    prog_map: dict = {}
    if prog_ids:
        for r in (
            sb.table("programs")
            .select("id, name")
            .in_("id", sorted(prog_ids))
            .execute()
            .data
        ):
            prog_map[r["id"]] = r["name"]

    # 3. newest comment per task (+ author names later)
    comment_map: dict = {}
    if task_ids:
        c_rows = (
            sb.table("comments")
            .select("id, task_id, content, kind, user_id, created_at")
            .in_("task_id", task_ids)
            .execute()
            .data
        )
        comment_map = _newest_by(c_rows, "task_id")

    # 4. subtask rollup per task
    sub_counts: dict = {}
    if task_ids:
        for r in (
            sb.table("subtasks")
            .select("task_id, status")
            .in_("task_id", task_ids)
            .execute()
            .data
        ):
            c = sub_counts.setdefault(r["task_id"], {"open": 0, "done": 0, "total": 0})
            c["total"] += 1
            if r.get("status") == "done":
                c["done"] += 1
            else:
                c["open"] += 1

    # 5. all stakeholders per task
    stk_map: dict = {}
    if task_ids:
        for r in (
            sb.table("task_stakeholders")
            .select("task_id, user_id, role")
            .in_("task_id", task_ids)
            .execute()
            .data
        ):
            stk_map.setdefault(r["task_id"], []).append(r)

    # 6. task-scope approvers per task (only matters while pending)
    appr_map: dict = {}
    if task_ids:
        for r in (
            sb.table("item_watchers")
            .select("task_id, user_id, role, scope_type")
            .in_("task_id", task_ids)
            .eq("role", "approver")
            .eq("scope_type", "task")
            .execute()
            .data
        ):
            appr_map.setdefault(r["task_id"], []).append(r["user_id"])

    # 7. resolve every referenced user id -> name in one query
    user_ids: set = set()
    for t in tasks:
        if t.get("primary_stakeholder_id"):
            user_ids.add(t["primary_stakeholder_id"])
    for lst in stk_map.values():
        user_ids.update(s["user_id"] for s in lst)
    for lst in appr_map.values():
        user_ids.update(lst)
    for c in comment_map.values():
        if c.get("user_id"):
            user_ids.add(c["user_id"])
    name_map: dict = {}
    if user_ids:
        for r in (
            sb.table("users")
            .select("id, name")
            .in_("id", sorted(user_ids))
            .execute()
            .data
        ):
            name_map[r["id"]] = r["name"]

    for t in tasks:
        init = init_map.get(t.get("initiative_id") or "", {})
        t["program_id"] = init.get("program_id")
        t["link"] = make_link(t)
        t["initiative_name"] = init.get("name")
        t["program_name"] = prog_map.get(t.get("program_id") or "")
        t["primary_stakeholder_name"] = name_map.get(
            t.get("primary_stakeholder_id") or "", ""
        )
        t["secondary_stakeholders"] = [
            {"user_id": s["user_id"], "role": s.get("role"),
             "name": name_map.get(s["user_id"], "")}
            for s in stk_map.get(t["id"], [])
            if s["user_id"] != t.get("primary_stakeholder_id")
        ]
        c = comment_map.get(t["id"])
        if c:
            snippet = (c.get("content") or "")
            t["last_comment"] = {
                "snippet": snippet[:160],
                "kind": c.get("kind"),
                "at": c.get("created_at"),
                "author_name": name_map.get(c.get("user_id") or "", ""),
            }
        else:
            t["last_comment"] = None
        sc = sub_counts.get(t["id"], {"open": 0, "done": 0, "total": 0})
        t["open_subtasks"] = sc["open"]
        t["done_subtasks"] = sc["done"]
        t["total_subtasks"] = sc["total"]
        t["pending_approvers"] = (
            [name_map.get(u, "") for u in appr_map.get(t["id"], [])]
            if t.get("approval_state") == "pending" else []
        )
        t["days_overdue"] = _days_overdue(t.get("due_date"), t.get("status"))

    return tasks
