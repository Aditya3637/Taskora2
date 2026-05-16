from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from routers._decision_context import enrich_task_items

router = APIRouter(prefix="/api/v1/war-room", tags=["war_room"])

_STALE_DAYS = 7
_TAT_OVERDUE_DAYS = 7


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


def _scope_task_ids(sb: Client, uid: str, scope: str, biz_ids: list,
                     init_meta: dict) -> list:
    if scope == "team":
        scoped = sorted(init_meta.keys())
        if not scoped:
            return []
        return [r["id"] for r in sb.table("tasks").select("id").in_("initiative_id", scoped).execute().data]
    primary = [r["id"] for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data]
    secondary = [r["task_id"] for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data]
    return list(set(primary + secondary))


def _biz_and_inits(sb: Client, uid: str):
    biz_ids = [r["business_id"] for r in
               sb.table("business_members").select("business_id").eq("user_id", uid).execute().data]
    init_meta: dict = {}
    if biz_ids:
        for r in (sb.table("initiatives")
                  .select("id, name, business_id, program_id, owner_id, status")
                  .in_("business_id", biz_ids).execute().data):
            init_meta[r["id"]] = r
    return biz_ids, init_meta


@router.get("/queue")
def get_queue(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    scope: str = Query("mine", pattern="^(mine|team)$"),
):
    uid = user["id"]
    biz_ids, init_meta = _biz_and_inits(sb, uid)
    all_ids = _scope_task_ids(sb, uid, scope, biz_ids, init_meta)
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

    # Entity names (kept here — caller-specific) then shared enrichment.
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
    for t in tasks:
        for e in t.get("task_entities") or []:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        t["age_label"] = _age_label(t.get("created_at") or "")
        t["is_overdue"] = (t.get("due_date") or "") < today and t["status"] != "done"

    enrich_task_items(sb, tasks)
    queue = tasks

    pending = sum(1 for t in queue if t["status"] == "pending_decision")
    blocked = sum(1 for t in queue if t["status"] == "blocked")
    overdue = sum(1 for t in queue if t.get("is_overdue"))

    return {"queue": queue, "counts": {"pending": pending, "blocked": blocked, "overdue": overdue}}


@router.get("/battlefield")
def get_battlefield(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    uid = user["id"]
    biz_ids, init_meta = _biz_and_inits(sb, uid)
    all_ids = _scope_task_ids(sb, uid, "mine", biz_ids, init_meta)
    if not all_ids:
        return {"pending_decisions": 0, "overdue_decisions": 0, "blocked_tasks": 0,
                "decisions_today": 0, "stale_tasks": 0, "awaiting_approval": 0,
                "tat_breaches": 0}

    tasks = sb.table("tasks").select(
        "id, status, due_date, updated_at, approval_state, closed_at"
    ).in_("id", all_ids).execute().data
    today = datetime.now(timezone.utc).date()
    today_s = today.isoformat()
    stale_threshold = (datetime.now(timezone.utc) - timedelta(days=_STALE_DAYS)).isoformat()
    breach_cut = (today - timedelta(days=3)).isoformat()

    pending_decisions = sum(1 for t in tasks if t["status"] == "pending_decision")
    overdue_decisions = sum(1 for t in tasks if t["status"] == "pending_decision" and (t.get("due_date") or "") < today_s)
    blocked_tasks = sum(1 for t in tasks if t["status"] == "blocked")
    stale_tasks = sum(1 for t in tasks if t["status"] not in ("done", "archived") and (t.get("updated_at") or "") < stale_threshold)
    awaiting_approval = sum(1 for t in tasks if t.get("approval_state") == "pending")

    def _breach(t: dict) -> bool:
        due = t.get("due_date") or ""
        if due and due < today_s and t["status"] not in ("done", "archived"):
            if (today - datetime.fromisoformat(due[:10]).date()).days > _TAT_OVERDUE_DAYS:
                return True
        if t["status"] == "blocked" and (t.get("updated_at") or "") < stale_threshold:
            return True
        if t.get("approval_state") == "pending" and (t.get("closed_at") or "")[:10] and (t.get("closed_at") or "")[:10] < breach_cut:
            return True
        return False
    tat_breaches = sum(1 for t in tasks if _breach(t))

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
        "awaiting_approval": awaiting_approval,
        "tat_breaches": tat_breaches,
    }


@router.get("/battlefield/initiatives")
def get_battlefield_initiatives(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    program: Optional[str] = None,
):
    """Per-initiative rollout for the caller's businesses — the portfolio
    view. Each row links straight to its initiative."""
    uid = user["id"]
    biz_ids, init_meta = _biz_and_inits(sb, uid)
    inits = [i for i in init_meta.values()
             if i.get("status") not in ("cancelled",)
             and (not program or i.get("program_id") == program)]
    if not inits:
        return {"initiatives": []}

    prog_ids = sorted({i["program_id"] for i in inits if i.get("program_id")})
    prog_names: dict = {}
    if prog_ids:
        for r in sb.table("programs").select("id, name").in_("id", prog_ids).execute().data:
            prog_names[r["id"]] = r["name"]
    owner_ids = sorted({i["owner_id"] for i in inits if i.get("owner_id")})
    owner_names: dict = {}
    if owner_ids:
        for r in sb.table("users").select("id, name").in_("id", owner_ids).execute().data:
            owner_names[r["id"]] = r["name"]

    today_s = datetime.now(timezone.utc).date().isoformat()
    out = []
    for i in sorted(inits, key=lambda x: x.get("name") or ""):
        it = sb.table("tasks").select("id, status, due_date, approval_state").eq("initiative_id", i["id"]).execute().data
        total = len(it)
        done = sum(1 for t in it if t["status"] == "done")
        out.append({
            "initiative_id": i["id"],
            "name": i["name"],
            "program_id": i.get("program_id"),
            "program_name": prog_names.get(i.get("program_id") or ""),
            "primary_owner_name": owner_names.get(i.get("owner_id") or "", ""),
            "completion_pct": round(done / total * 100) if total else 0,
            "total": total,
            "done": done,
            "blocked": sum(1 for t in it if t["status"] == "blocked"),
            "overdue": sum(1 for t in it if (t.get("due_date") or "") < today_s and t["status"] not in ("done", "archived")),
            "awaiting_approval": sum(1 for t in it if t.get("approval_state") == "pending"),
            "link": {"type": "initiative", "task_id": None, "subtask_id": None,
                     "initiative_id": i["id"], "program_id": i.get("program_id")},
        })
    return {"initiatives": out}
