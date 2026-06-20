"""Company-level rollup (G4) — the founder's cross-workspace cockpit.

A company owns many workspaces (migration 064). This endpoint rolls up health
across the workspaces in the caller's company *that the caller is a member of* —
tenant isolation stays at the workspace boundary, so the company view never
leaks a workspace the caller doesn't belong to.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/companies", tags=["companies"])

_OPEN = {"backlog", "todo", "in_progress", "blocked", "reopened", "pending_decision"}


def _workspace_rollup(sb: Client, business_id: str) -> dict:
    today = date.today().isoformat()
    init_ids = [
        r["id"] for r in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]
    tasks = []
    if init_ids:
        tasks = (
            sb.table("tasks").select("status, due_date, archived_at")
            .in_("initiative_id", init_ids).execute().data
        )
    open_n = overdue = blocked = done = 0
    for t in tasks:
        if t.get("archived_at"):
            continue
        st = t.get("status") or ""
        if st == "done":
            done += 1
            continue
        if st in _OPEN:
            open_n += 1
            if st == "blocked":
                blocked += 1
            due = t.get("due_date")
            if due and due < today:
                overdue += 1
    health = "bad" if overdue else ("warn" if blocked else "ok")
    return {"open": open_n, "overdue": overdue, "blocked": blocked, "done": done, "health": health}


@router.get("/overview")
def company_overview(
    business_id: str = Query(..., description="The caller's active workspace; its company is rolled up."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    uid = user["id"]

    biz = sb.table("businesses").select("id, name, company_id").eq("id", business_id).execute().data
    company_id = biz[0].get("company_id") if biz else None

    # Workspaces in this company the caller is a member of (isolation-safe).
    member_biz_ids = {
        r["business_id"] for r in sb.table("business_members").select("business_id").eq("user_id", uid).execute().data
    }
    if company_id:
        company = sb.table("companies").select("id, name").eq("id", company_id).execute().data
        company_obj = company[0] if company else {"id": company_id, "name": ""}
        ws_rows = sb.table("businesses").select("id, name, owner_id").eq("company_id", company_id).execute().data
        ws_rows = [w for w in ws_rows if w["id"] in member_biz_ids]
    else:
        company_obj = None
        ws_rows = [w for w in (biz or []) if w["id"] in member_biz_ids]

    role_by_biz = {
        r["business_id"]: r["role"]
        for r in sb.table("business_members").select("business_id, role").eq("user_id", uid).execute().data
    }

    workspaces = []
    totals = {"open": 0, "overdue": 0, "blocked": 0, "done": 0, "workspaces": 0}
    for w in ws_rows:
        roll = _workspace_rollup(sb, w["id"])
        workspaces.append({
            "id": w["id"], "name": w.get("name") or "",
            "role": role_by_biz.get(w["id"], "member"),
            "is_owner": w.get("owner_id") == uid,
            **roll,
        })
        for k in ("open", "overdue", "blocked", "done"):
            totals[k] += roll[k]
        totals["workspaces"] += 1

    # Worst-health first.
    rank = {"bad": 0, "warn": 1, "ok": 2}
    workspaces.sort(key=lambda x: rank.get(x["health"], 3))
    return {"company": company_obj, "workspaces": workspaces, "totals": totals}
