from datetime import date, timedelta, datetime, timezone
from typing import List

from fastapi import APIRouter, Depends
from supabase import Client
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/daily-brief", tags=["daily_brief"])


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
):
    uid = user["id"]
    today = date.today()
    today_str = today.isoformat()
    week_out = (today + timedelta(days=7)).isoformat()
    stale_threshold = (today - timedelta(days=7)).isoformat()

    # Collect ALL task IDs where user is primary OR any stakeholder role
    primary_ids: List[str] = [
        r["id"]
        for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data
    ]
    secondary_ids: List[str] = [
        r["task_id"]
        for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
    ]
    all_task_ids = list(set(primary_ids + secondary_ids))

    def _fetch(filters_fn, ids: List[str]):
        if not ids:
            return []
        rows = (
            sb.table("tasks")
            .select("*, task_entities(*), task_stakeholders(*)")
            .in_("id", ids)
            .execute()
        )
        filtered = [t for t in rows.data if filters_fn(t)]
        # Resolve entity names
        for t in filtered:
            t["task_entities"] = _resolve_entity_names(sb, t.get("task_entities") or [])
        return filtered

    pending_decisions = _fetch(lambda t: t["status"] == "pending_decision", all_task_ids)
    overdue_tasks     = _fetch(lambda t: (t.get("due_date") or "") < today_str and t["status"] not in ("done","archived"), all_task_ids)
    stale_tasks       = _fetch(lambda t: (t.get("updated_at") or "") < stale_threshold and t["status"] not in ("done","archived"), all_task_ids)
    due_this_week     = _fetch(lambda t: today_str <= (t.get("due_date") or "") <= week_out, all_task_ids)
    blocked_tasks     = _fetch(lambda t: t["status"] == "blocked", all_task_ids)

    # Quick stats
    if all_task_ids:
        all_tasks_data = sb.table("tasks").select("id, status, updated_at, created_at").in_("id", all_task_ids).execute().data
    else:
        all_tasks_data = []
    open_count = sum(1 for t in all_tasks_data if t["status"] not in ("done", "archived", "cancelled"))
    since_week = (today - timedelta(days=7)).isoformat()
    done_this_week = sum(1 for t in all_tasks_data if t["status"] == "done" and (t.get("updated_at") or "") >= since_week)
    total_non_done = sum(1 for t in all_tasks_data if t["status"] not in ("done","archived"))
    completion_rate = round(done_this_week / total_non_done * 100) if total_non_done else 0

    # Initiative progress (businesses the user belongs to)
    biz_rows = sb.table("business_members").select("business_id").eq("user_id", uid).execute().data
    biz_ids = [r["business_id"] for r in biz_rows]
    initiative_progress = []
    if biz_ids:
        inits = sb.table("initiatives").select("id, name, status").in_("business_id", biz_ids).eq("status", "active").execute().data
        for init in inits:
            it_rows = sb.table("tasks").select("id, status").eq("initiative_id", init["id"]).execute().data
            it_total = len(it_rows)
            it_done  = sum(1 for t in it_rows if t["status"] == "done")
            initiative_progress.append({
                "id": init["id"],
                "title": init["name"],
                "name": init["name"],
                "completion_pct": round(it_done / it_total * 100) if it_total else 0,
                "total_tasks": it_total,
                "done_tasks": it_done,
                "entity_breakdown": [],
            })

    return {
        "user_id": uid,
        "generated_at": today_str,
        "pending_decisions": pending_decisions,
        "overdue_tasks": overdue_tasks,
        "stale_tasks": stale_tasks,
        "due_this_week": due_this_week,
        "blocked_tasks": blocked_tasks,
        "initiative_progress": initiative_progress,
        "quick_stats": {
            "open_tasks": open_count,
            "completion_rate_this_week": completion_rate,
            "stale_count": len(stale_tasks),
        },
        "greeting": {
            "summary_line": f"You have {len(pending_decisions)} decisions pending and {len(overdue_tasks)} overdue tasks.",
        },
    }
