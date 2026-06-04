"""'My day' — the personal worklist cockpit (Slice 1 of the Programs plan).

One screen that answers "what is on ME today" without making a member walk the
Program -> Initiative -> Task tree. Aggregates four sources that already exist
in separate tables but were never unified:

  1. tasks       — open tasks where the caller is the primary stakeholder or a
                   task_stakeholder, scoped to the active workspace.
  2. approvals   — tasks awaiting the caller's approval (item_watchers
                   role=approver, scope=task) whose approval_state is pending.
  3. delegations — pending notebook delegations addressed to the caller
                   (notebook_assignments). Personal / cross-workspace.
  4. checklist   — the caller's own open checklist items due soon or undated
                   (notebook_checklist_items). Personal / cross-workspace.

Strictly personal: every list is filtered to the CALLING user's own rows. An
admin/owner gets THEIR OWN my-day here — this endpoint never exposes another
member's worklist (that's what the team-scoped Daily Brief is for).

Additive, no schema change. tasks/approvals are workspace-scoped (require_member
on business_id); delegations/checklist are personal and span workspaces by
design — they belong to the notebook, which is cross-workspace.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/my-day", tags=["my_day"])

# A task is no longer "on me" once it reaches one of these resting states.
_CLOSED_STATES = {"done", "archived", "cancelled"}
# Checklist horizon: show items due within the next week, plus undated ones
# (undated personal to-dos are still "on me" — they just have no deadline).
_CHECKLIST_HORIZON_DAYS = 7

# Higher = surfaced first. Mirrors the Daily Brief's priority ranking so the
# two screens speak the same urgency language.
_PRIORITY_RANK = {"critical": 4, "urgent": 3, "high": 2, "medium": 1, "low": 0}


@router.get("")
def get_my_day(
    business_id: str = Query(..., description="Active workspace. tasks + approvals are scoped to it."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the calling user's personal worklist for one workspace.

    403 if the caller is not a member of `business_id`. tasks/approvals are
    confined to that workspace AND to the caller's own stakeholder/approver
    rows; delegations/checklist are the caller's own notebook rows (personal,
    cross-workspace).
    """
    uid = user["id"]
    require_member(sb, business_id, uid)

    today = date.today()
    today_str = today.isoformat()
    soon_str = (today + timedelta(days=_CHECKLIST_HORIZON_DAYS)).isoformat()

    # Workspace anchor: a task belongs to this workspace via its initiative.
    # We keep the id->name map both to filter (membership) and to label rows.
    init_name: dict[str, str] = {
        r["id"]: r.get("name") or ""
        for r in sb.table("initiatives")
        .select("id, name")
        .eq("business_id", business_id)
        .execute()
        .data
    }
    biz_init_ids = set(init_name.keys())

    # ---- 1. tasks ---------------------------------------------------------
    # The caller's tasks come from two workspace-agnostic sources (primary +
    # stakeholder rows), so we MUST re-scope to this workspace's initiatives
    # or a multi-workspace member would see pooled tasks. Tasks with a NULL
    # initiative_id have no workspace anchor and are dropped.
    primary_ids = [
        r["id"]
        for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data
    ]
    stake_ids = [
        r["task_id"]
        for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
    ]
    my_task_ids = list(set(primary_ids + stake_ids))

    tasks_out: list[dict] = []
    if my_task_ids:
        rows = (
            sb.table("tasks")
            .select("id, title, status, priority, due_date, initiative_id, approval_state, created_at")
            .in_("id", my_task_ids)
            .execute()
            .data
        )
        for t in rows:
            if t.get("initiative_id") not in biz_init_ids:
                continue  # other workspace, or unanchored (NULL initiative)
            if t.get("status") in _CLOSED_STATES:
                continue
            overdue = bool(
                t.get("due_date")
                and t["due_date"] < today_str
                and t.get("status") not in ("done", "archived")
            )
            tasks_out.append({
                "id": t["id"],
                "title": t.get("title"),
                "status": t.get("status"),
                "priority": t.get("priority"),
                "due_date": t.get("due_date"),
                "overdue": overdue,
                "initiative_id": t.get("initiative_id"),
                "initiative_name": init_name.get(t.get("initiative_id") or ""),
            })

    # Worst first: overdue, then earliest due (undated last), then priority.
    tasks_out.sort(
        key=lambda t: (
            not t["overdue"],
            t["due_date"] is None,
            t["due_date"] or "",
            -_PRIORITY_RANK.get(t.get("priority") or "", 0),
        )
    )

    # ---- 2. approvals -----------------------------------------------------
    # Task-scoped approver rows for the caller, narrowed to tasks that are
    # actually pending approval AND in this workspace.
    approver_task_ids = [
        r["task_id"]
        for r in sb.table("item_watchers")
        .select("task_id")
        .eq("user_id", uid)
        .eq("role", "approver")
        .eq("scope_type", "task")
        .execute()
        .data
        if r.get("task_id")
    ]
    approvals_out: list[dict] = []
    if approver_task_ids:
        rows = (
            sb.table("tasks")
            .select("id, title, status, due_date, priority, initiative_id, approval_state")
            .in_("id", list(set(approver_task_ids)))
            .eq("approval_state", "pending")
            .execute()
            .data
        )
        for t in rows:
            if t.get("initiative_id") not in biz_init_ids:
                continue
            approvals_out.append({
                "id": t["id"],
                "title": t.get("title"),
                "status": t.get("status"),
                "priority": t.get("priority"),
                "due_date": t.get("due_date"),
                "approval_state": t.get("approval_state"),
                "initiative_id": t.get("initiative_id"),
                "initiative_name": init_name.get(t.get("initiative_id") or ""),
            })

    # ---- 3. delegations ---------------------------------------------------
    # Pending notebook delegations addressed to the caller. Pending-only on
    # purpose: accepting one promotes it into the caller's checklist (see
    # notebook.accept_assignment), so showing 'accepted' here would
    # double-count with list 4. Personal / cross-workspace by design.
    deleg_rows = (
        sb.table("notebook_assignments")
        .select("*")
        .eq("recipient_id", uid)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    sender_names: dict[str, str] = {}
    sender_ids = sorted({r["sender_id"] for r in deleg_rows if r.get("sender_id")})
    if sender_ids:
        for u in sb.table("users").select("id, name").in_("id", sender_ids).execute().data:
            sender_names[u["id"]] = u.get("name") or ""
    delegations_out = [
        {
            "id": r["id"],
            "content": r.get("content"),
            "sender_id": r.get("sender_id"),
            "sender_name": sender_names.get(r.get("sender_id") or "", ""),
            "source_page_id": r.get("source_page_id"),
            "created_at": r.get("created_at"),
        }
        for r in deleg_rows
    ]

    # ---- 4. checklist -----------------------------------------------------
    # Caller's own open checklist items, kept focused to "soon": due within the
    # horizon OR undated. Personal / cross-workspace.
    cl_rows = (
        sb.table("notebook_checklist_items")
        .select("*")
        .eq("owner_id", uid)
        .eq("status", "open")
        .execute()
        .data
    )
    checklist_out: list[dict] = []
    for c in cl_rows:
        due = c.get("due_date")
        if due is not None and due > soon_str:
            continue  # due later than the horizon — not "today's" work yet
        checklist_out.append({
            "id": c["id"],
            "content": c.get("content"),
            "due_date": due,
            "overdue": bool(due and due < today_str),
            "status": c.get("status"),
            "source_page_id": c.get("source_page_id"),
        })
    # Overdue/dated first, undated last.
    checklist_out.sort(key=lambda c: (c["due_date"] is None, c["due_date"] or ""))

    return {
        "user_id": uid,
        "business_id": business_id,
        "generated_at": today_str,
        "tasks": tasks_out,
        "approvals": approvals_out,
        "delegations": delegations_out,
        "checklist": checklist_out,
        "counts": {
            "tasks": len(tasks_out),
            "overdue_tasks": sum(1 for t in tasks_out if t["overdue"]),
            "approvals": len(approvals_out),
            "delegations": len(delegations_out),
            "checklist": len(checklist_out),
        },
    }
