from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from routers._decision_context import enrich_task_items

router = APIRouter(prefix="/api/v1/daily-brief", tags=["daily_brief"])

# A row is "breaching" if it has clearly slipped past a reasonable bar. Kept
# deliberately simple/explicit so the number is trustworthy at a glance.
_TAT_OVERDUE_DAYS = 7
_STALE_DAYS = 7


def _resolve_entity_names(sb: Client, task_entities: list) -> list:
    """Replace entity_id UUIDs with entity_name strings."""
    building_ids = [e["entity_id"] for e in task_entities if e.get("entity_type") == "building"]
    client_ids   = [e["entity_id"] for e in task_entities if e.get("entity_type") == "client"]
    name_map = {}
    if building_ids:
        rows = sb.table("buildings").select("id, name").in_("id", building_ids).execute().data
        for r in rows: name_map[r["id"]] = r["name"]
    if client_ids:
        rows = sb.table("clients").select("id, name").in_("id", client_ids).execute().data
        for r in rows: name_map[r["id"]] = r["name"]
    for e in task_entities:
        e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
    return task_entities


@router.get("")
def get_daily_brief(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    scope: str = Query("mine", pattern="^(mine|team)$"),
    initiative: Optional[str] = None,
    program: Optional[str] = None,
    owner: Optional[str] = None,
    group_by: str = Query("none", pattern="^(none|initiative|program)$"),
):
    """One screen to decide from.

    `scope=mine` (default) = tasks where the caller is primary/stakeholder
    (legacy behaviour). `scope=team` = every task across the businesses the
    caller belongs to (the leader/portfolio view). `initiative`/`program`/
    `owner` narrow it; `group_by` adds a rollup alongside the flat buckets.
    The response is additive — existing keys are unchanged.
    """
    uid = user["id"]
    today = date.today()
    today_str = today.isoformat()
    week_out = (today + timedelta(days=7)).isoformat()
    stale_threshold = (today - timedelta(days=_STALE_DAYS)).isoformat()

    biz_rows = sb.table("business_members").select("business_id").eq("user_id", uid).execute().data
    biz_ids = [r["business_id"] for r in biz_rows]

    # initiative_id -> {business_id, program_id, name} for filtering + grouping
    init_meta: dict = {}
    if biz_ids:
        for r in (
            sb.table("initiatives")
            .select("id, name, business_id, program_id")
            .in_("business_id", biz_ids)
            .execute()
            .data
        ):
            init_meta[r["id"]] = r

    if scope == "team":
        scoped_ids = sorted(init_meta.keys())
        all_task_ids = [
            r["id"]
            for r in (
                sb.table("tasks").select("id").in_("initiative_id", scoped_ids).execute().data
                if scoped_ids else []
            )
        ]
    else:
        primary_ids: List[str] = [
            r["id"]
            for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data
        ]
        secondary_ids: List[str] = [
            r["task_id"]
            for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
        ]
        all_task_ids = list(set(primary_ids + secondary_ids))

    # Single full fetch for everything in scope, then partition + enrich once
    # (was 5 separate full-table fetches).
    rows: list = []
    if all_task_ids:
        rows = (
            sb.table("tasks")
            .select("*, task_entities(*), task_stakeholders(*)")
            .in_("id", all_task_ids)
            .execute()
            .data
        )

    # Filters (initiative / program / owner)
    def _keep(t: dict) -> bool:
        im = init_meta.get(t.get("initiative_id") or "")
        if initiative and t.get("initiative_id") != initiative:
            return False
        if program and (not im or im.get("program_id") != program):
            return False
        if owner and t.get("primary_stakeholder_id") != owner:
            return False
        return True

    rows = [t for t in rows if _keep(t)]

    for t in rows:
        t["task_entities"] = _resolve_entity_names(sb, t.get("task_entities") or [])
    enrich_task_items(sb, rows)

    def bucket(pred) -> list:
        return [t for t in rows if pred(t)]

    open_states = lambda s: s not in ("done", "archived", "cancelled")
    pending_decisions = bucket(lambda t: t["status"] == "pending_decision")
    overdue_tasks     = bucket(lambda t: (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived"))
    stale_tasks       = bucket(lambda t: (t.get("updated_at") or "") < stale_threshold and t["status"] not in ("done", "archived"))
    due_this_week     = bucket(lambda t: today_str <= (t.get("due_date") or "") <= week_out)
    blocked_tasks     = bucket(lambda t: t["status"] == "blocked")
    awaiting_approval = bucket(lambda t: t.get("approval_state") == "pending")

    def _is_breach(t: dict) -> bool:
        if t.get("days_overdue", 0) > _TAT_OVERDUE_DAYS:
            return True
        if t["status"] == "blocked" and (t.get("updated_at") or "") < stale_threshold:
            return True
        if t.get("approval_state") == "pending" and (t.get("closed_at") or "") and \
           (t.get("closed_at") or "")[:10] < (today - timedelta(days=3)).isoformat():
            return True
        return False
    tat_breaches = bucket(_is_breach)

    # Quick stats (over the in-scope, filtered set)
    open_count = sum(1 for t in rows if open_states(t["status"]))
    since_week = stale_threshold
    done_this_week = sum(1 for t in rows if t["status"] == "done" and (t.get("updated_at") or "") >= since_week)
    total_non_done = sum(1 for t in rows if t["status"] not in ("done", "archived"))
    completion_rate = round(done_this_week / total_non_done * 100) if total_non_done else 0

    # Initiative progress (active initiatives in caller's businesses)
    initiative_progress = []
    if biz_ids:
        inits = (
            sb.table("initiatives")
            .select("id, name, status, program_id")
            .in_("business_id", biz_ids)
            .eq("status", "active")
            .execute()
            .data
        )
        prog_ids = sorted({i["program_id"] for i in inits if i.get("program_id")})
        prog_names: dict = {}
        if prog_ids:
            for r in sb.table("programs").select("id, name").in_("id", prog_ids).execute().data:
                prog_names[r["id"]] = r["name"]
        for init in inits:
            it_rows = sb.table("tasks").select(
                "id, status, due_date, approval_state"
            ).eq("initiative_id", init["id"]).execute().data
            it_total = len(it_rows)
            it_done  = sum(1 for t in it_rows if t["status"] == "done")
            initiative_progress.append({
                "id": init["id"],
                "title": init["name"],
                "name": init["name"],
                "program_id": init.get("program_id"),
                "program_name": prog_names.get(init.get("program_id") or ""),
                "completion_pct": round(it_done / it_total * 100) if it_total else 0,
                "total_tasks": it_total,
                "done_tasks": it_done,
                "blocked": sum(1 for t in it_rows if t["status"] == "blocked"),
                "overdue": sum(1 for t in it_rows if (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived")),
                "awaiting_approval": sum(1 for t in it_rows if t.get("approval_state") == "pending"),
                "entity_breakdown": [],
                "link": {"type": "initiative", "task_id": None, "subtask_id": None,
                         "initiative_id": init["id"], "program_id": init.get("program_id")},
            })

    # Optional rollup grouping over the in-scope, filtered tasks
    groups = []
    if group_by != "none":
        key = "program_id" if group_by == "program" else "initiative_id"
        agg: dict = {}
        for t in rows:
            gid = t.get(key)
            if not gid:
                continue
            g = agg.setdefault(gid, {
                "id": gid, "group_by": group_by, "open": 0, "overdue": 0,
                "blocked": 0, "pending_decision": 0, "awaiting_approval": 0,
            })
            if open_states(t["status"]):
                g["open"] += 1
            if (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived"):
                g["overdue"] += 1
            if t["status"] == "blocked":
                g["blocked"] += 1
            if t["status"] == "pending_decision":
                g["pending_decision"] += 1
            if t.get("approval_state") == "pending":
                g["awaiting_approval"] += 1
        for gid, g in agg.items():
            if group_by == "program":
                g["name"] = next((init_meta[i]["name"] for i in init_meta
                                   if init_meta[i].get("program_id") == gid), None)
                g["link"] = {"type": "program", "task_id": None, "subtask_id": None,
                             "initiative_id": None, "program_id": gid}
            else:
                im = init_meta.get(gid, {})
                g["name"] = im.get("name")
                g["link"] = {"type": "initiative", "task_id": None, "subtask_id": None,
                             "initiative_id": gid, "program_id": im.get("program_id")}
            groups.append(g)

    return {
        "user_id": uid,
        "generated_at": today_str,
        "scope": scope,
        "filters": {"initiative": initiative, "program": program, "owner": owner},
        "pending_decisions": pending_decisions,
        "overdue_tasks": overdue_tasks,
        "stale_tasks": stale_tasks,
        "due_this_week": due_this_week,
        "blocked_tasks": blocked_tasks,
        "awaiting_approval": awaiting_approval,
        "tat_breaches": tat_breaches,
        "initiative_progress": initiative_progress,
        "groups": groups,
        "quick_stats": {
            "open_tasks": open_count,
            "completion_rate_this_week": completion_rate,
            "stale_count": len(stale_tasks),
            "awaiting_approval_count": len(awaiting_approval),
            "tat_breach_count": len(tat_breaches),
        },
        "greeting": {
            "summary_line": (
                f"You have {len(pending_decisions)} decisions pending, "
                f"{len(overdue_tasks)} overdue, and {len(awaiting_approval)} awaiting approval."
            ),
        },
    }
