from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from supabase import Client
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/war-room", tags=["war_room"])


def _age_label(created_at_str: str) -> str:
    try:
        created = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        seconds = int((datetime.now(timezone.utc) - created).total_seconds())
        if seconds < 3600:
            return f"{seconds // 60}m"
        elif seconds < 86400:
            h = seconds // 3600
            m = (seconds % 3600) // 60
            return f"{h}h {m}m" if m else f"{h}h"
        else:
            d = seconds // 86400
            h = (seconds % 86400) // 3600
            return f"{d}d {h}h" if h else f"{d}d"
    except Exception:
        return "—"


@router.get("/queue")
def get_queue(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    uid = user["id"]
    # Get all task IDs for this user
    primary_ids = [r["id"] for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data]
    secondary_ids = [r["task_id"] for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return {"queue": [], "counts": {"pending": 0, "blocked": 0, "overdue": 0}}

    tasks = (
        sb.table("tasks")
        .select("*, task_entities(*)")
        .in_("id", all_ids)
        .in_("status", ["pending_decision", "blocked"])
        .order("created_at")
        .execute()
        .data
    )

    # Resolve entity names
    all_entities = [e for t in tasks for e in (t.get("task_entities") or [])]
    building_ids = [e["entity_id"] for e in all_entities if e.get("entity_type") == "building"]
    client_ids   = [e["entity_id"] for e in all_entities if e.get("entity_type") == "client"]
    name_map = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            name_map[r["id"]] = r["name"]

    today = datetime.now(timezone.utc).date().isoformat()
    queue = []
    for t in tasks:
        for e in t.get("task_entities") or []:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        t["age_label"] = _age_label(t.get("created_at") or "")
        t["is_overdue"] = (t.get("due_date") or "") < today and t["status"] != "done"
        queue.append(t)

    pending = sum(1 for t in queue if t["status"] == "pending_decision")
    blocked = sum(1 for t in queue if t["status"] == "blocked")
    overdue = sum(1 for t in queue if t.get("is_overdue"))

    return {"queue": queue, "counts": {"pending": pending, "blocked": blocked, "overdue": overdue}}


@router.get("/battlefield")
def get_battlefield(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    uid = user["id"]
    primary_ids = [r["id"] for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data]
    secondary_ids = [r["task_id"] for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return {"pending_decisions": 0, "overdue_decisions": 0, "blocked_tasks": 0, "decisions_today": 0, "stale_tasks": 0}

    tasks = sb.table("tasks").select("id, status, due_date, updated_at").in_("id", all_ids).execute().data
    today = datetime.now(timezone.utc).date().isoformat()
    stale_threshold = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    pending_decisions = sum(1 for t in tasks if t["status"] == "pending_decision")
    overdue_decisions = sum(1 for t in tasks if t["status"] == "pending_decision" and (t.get("due_date") or "") < today)
    blocked_tasks = sum(1 for t in tasks if t["status"] == "blocked")
    stale_tasks = sum(1 for t in tasks if t["status"] not in ("done","archived") and (t.get("updated_at") or "") < stale_threshold)

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    decisions_today = (
        sb.table("decision_log")
        .select("id", count="exact")
        .eq("user_id", uid)
        .gte("created_at", today_start)
        .execute()
        .count or 0
    )

    return {
        "pending_decisions": pending_decisions,
        "overdue_decisions": overdue_decisions,
        "blocked_tasks": blocked_tasks,
        "decisions_today": decisions_today,
        "stale_tasks": stale_tasks,
    }
