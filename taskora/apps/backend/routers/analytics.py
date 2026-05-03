from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _resolve_entity_names_dict(sb: Client, entity_progress: dict) -> list:
    """Convert {eid: {total, done, blocked}} dict → list with names + completion_pct."""
    eids = list(entity_progress.keys())
    if not eids:
        return []
    name_map = {}
    # Try buildings first, then clients
    b_rows = sb.table("buildings").select("id, name").in_("id", eids).execute().data or []
    for r in b_rows: name_map[r["id"]] = r["name"]
    remaining = [e for e in eids if e not in name_map]
    if remaining:
        c_rows = sb.table("clients").select("id, name").in_("id", remaining).execute().data or []
        for r in c_rows: name_map[r["id"]] = r["name"]
    result = []
    for eid, stats in entity_progress.items():
        total = stats.get("total", 0)
        done  = stats.get("done", 0)
        result.append({
            "entity_id": eid,
            "entity_name": name_map.get(eid, eid),
            "total": total,
            "done": done,
            "blocked": stats.get("blocked", 0),
            "completion_pct": round(done / total * 100) if total else 0,
        })
    return result


@router.get("/my-performance")
def my_performance(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    done_tasks = (
        sb.table("tasks")
        .select("created_at, updated_at")
        .eq("primary_stakeholder_id", uid)
        .eq("status", "done")
        .gte("updated_at", since)
        .execute()
        .data
    )

    tat_hours: List[float] = []
    for t in done_tasks:
        try:
            created = datetime.fromisoformat(t["created_at"])
            updated = datetime.fromisoformat(t["updated_at"])
            tat_hours.append((updated - created).total_seconds() / 3600)
        except (KeyError, ValueError, TypeError):
            pass

    avg_tat = round(sum(tat_hours) / len(tat_hours), 1) if tat_hours else 0.0

    decisions = (
        sb.table("decision_log")
        .select("created_at, action")
        .eq("user_id", uid)
        .gte("created_at", since)
        .execute()
        .data
    )
    delegation_count = sum(1 for d in decisions if d.get("action") == "delegate")

    today = datetime.now(timezone.utc).date().isoformat()
    overdue = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .lt("due_date", today)
        .neq("status", "done")
        .execute()
        .count or 0
    )
    stale_threshold = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    stale = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .lt("updated_at", stale_threshold)
        .neq("status", "done")
        .neq("status", "archived")
        .execute()
        .count or 0
    )
    blocked = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .eq("status", "blocked")
        .execute()
        .count or 0
    )

    return {
        "avg_tat_hours": avg_tat,
        "tasks_completed": len(done_tasks),
        "decisions_made": len(decisions),
        "delegation_count": delegation_count,
        "overdue_count": overdue,
        "stale_count": stale,
        "blocked_count": blocked,
        "timeframe_days": days,
    }


@router.get("/initiative/{initiative_id}")
def initiative_analytics(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init_row = sb.table("initiatives").select("business_id").eq("id", initiative_id).execute().data
    if not init_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    require_member(sb, init_row[0]["business_id"], user["id"])

    tasks = (
        sb.table("tasks")
        .select("*, task_entities(*)")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )

    total = len(tasks)
    done = sum(1 for t in tasks if t.get("status") == "done")
    blocked = sum(1 for t in tasks if t.get("status") == "blocked")

    entity_progress: dict = {}
    for t in tasks:
        for e in t.get("task_entities") or []:
            eid = e.get("entity_id", "")
            if eid not in entity_progress:
                entity_progress[eid] = {"total": 0, "done": 0, "blocked": 0}
            entity_progress[eid]["total"] += 1
            if e.get("per_entity_status") == "done":
                entity_progress[eid]["done"] += 1
            if e.get("per_entity_status") == "blocked":
                entity_progress[eid]["blocked"] += 1

    return {
        "total_tasks": total,
        "completed_count": done,
        "blocked": blocked,
        "completion_pct": round(done / total * 100) if total else 0,
        "entity_progress": _resolve_entity_names_dict(sb, entity_progress),
    }


@router.get("/business/{business_id}")
def business_analytics(
    business_id: str,
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])

    initiative_ids = [
        i["id"]
        for i in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]

    all_tasks = (
        sb.table("tasks")
        .select("id, status, task_entities(*)")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    ) if initiative_ids else []

    total_tasks        = len(all_tasks)
    completed_count    = sum(1 for t in all_tasks if t.get("status") == "done")
    stale_threshold    = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    stale_count        = sum(1 for t in all_tasks if t.get("status") not in ("done","archived") and (t.get("updated_at") or "") < stale_threshold)
    blocked_count      = sum(1 for t in all_tasks if t.get("status") == "blocked")
    pending_decision_count = sum(1 for t in all_tasks if t.get("status") == "pending_decision")

    # Entity progress
    entity_progress: dict = {}
    for t in all_tasks:
        for e in t.get("task_entities") or []:
            eid = e.get("entity_id", "")
            if eid not in entity_progress:
                entity_progress[eid] = {"total": 0, "done": 0, "blocked": 0}
            entity_progress[eid]["total"] += 1
            if e.get("per_entity_status") == "done":
                entity_progress[eid]["done"] += 1
            if e.get("per_entity_status") == "blocked":
                entity_progress[eid]["blocked"] += 1

    return {
        "total_tasks": total_tasks,
        "completed_count": completed_count,
        "stale_count": stale_count,
        "blocked_count": blocked_count,
        "pending_decision_count": pending_decision_count,
        "entity_progress": _resolve_entity_names_dict(sb, entity_progress),
    }
