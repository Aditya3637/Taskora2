"""Predictive risk radar — which initiatives are most likely to slip.

A deterministic model over slip-momentum signals: baseline drift (mig 066),
repeated date pushes (task_date_change_log), and overdue/blocked load. Repeated
pushes + drift are the leading indicators of future slippage, so this predicts
risk rather than just reporting today's state. (An LLM narrative can wrap this
later; the scoring stays deterministic and testable.)
"""
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, Query
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/risk", tags=["risk"])

_OPEN = {"backlog", "todo", "in_progress", "blocked", "reopened", "pending_decision"}


@router.get("")
def risk_radar(
    business_id: str,
    limit: int = Query(default=8, ge=1, le=25),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    today = date.today().isoformat()

    inits = (
        sb.table("initiatives")
        .select("id, name, status, target_end_date, baseline_end_date")
        .eq("business_id", business_id).neq("status", "cancelled").execute().data
    )
    if not inits:
        return {"items": []}
    init_ids = [i["id"] for i in inits]

    tasks = (
        sb.table("tasks").select("id, initiative_id, status, due_date")
        .in_("initiative_id", init_ids).execute().data
    )
    task_init = {t["id"]: t["initiative_id"] for t in tasks}

    # Slip momentum: count + total of positive date pushes per initiative.
    pushes = defaultdict(int)
    delay = defaultdict(int)
    task_ids = [t["id"] for t in tasks]
    if task_ids:
        logs = (
            sb.table("task_date_change_log").select("task_id, delay_days")
            .in_("task_id", task_ids).execute().data
        )
        for l in logs:
            d = l.get("delay_days") or 0
            if d and d > 0:
                ii = task_init.get(l["task_id"])
                pushes[ii] += 1
                delay[ii] += d

    overdue = defaultdict(int)
    blocked = defaultdict(int)
    for t in tasks:
        st = t.get("status") or ""
        if st == "done" or st not in _OPEN:
            continue
        iid = t["initiative_id"]
        if st == "blocked":
            blocked[iid] += 1
        due = t.get("due_date")
        if due and due < today:
            overdue[iid] += 1

    items = []
    for i in inits:
        iid = i["id"]
        drift = 0
        te, be = i.get("target_end_date"), i.get("baseline_end_date")
        if te and be and te > be:
            drift = (date.fromisoformat(te) - date.fromisoformat(be)).days
        od, bl, pu, dl = overdue[iid], blocked[iid], pushes[iid], delay[iid]
        score = drift * 1.0 + od * 10 + bl * 8 + pu * 3 + dl * 0.5
        if score <= 0:
            continue
        reasons = []
        if drift > 0:
            reasons.append(f"slipped {drift}d from baseline")
        if od:
            reasons.append(f"{od} overdue")
        if bl:
            reasons.append(f"{bl} blocked")
        if pu:
            reasons.append(f"pushed {pu}×")
        items.append({
            "id": iid, "name": i.get("name") or "",
            "score": round(score, 1), "reasons": reasons,
            "drift_days": drift, "overdue": od, "blocked": bl, "pushes": pu,
        })

    items.sort(key=lambda x: -x["score"])
    return {"items": items[:limit]}
