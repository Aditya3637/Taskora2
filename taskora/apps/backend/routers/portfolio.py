"""Portfolio — the Founder glance (M2).

One workspace-level screen a founder/exec reads to decide where to push. It
ranks every program they can see by the P3 composite-health score, surfaces the
handful of initiatives that need attention across the whole portfolio, and lets
them nudge the responsible lead in one click (the nudge lands in that lead's
"My day" as a delegation).

Read-only glance + a single write (nudge). Reuses P3's `program_risk` and the
existing program-visibility scoping — admins/owners see the whole portfolio,
members see only the programs visible to them.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from supabase import Client

from auth import get_current_user
from deps import (
    get_supabase, require_member, is_admin_or_owner,
    visible_program_ids, get_member_role,
)
from routers.programs import program_risk, program_outcome_pct

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])

_PROGRAM_COLS = "id, name, color, status, manual_health, lead_user_id, business_id"
# Completed programs still count (they're green); only truly inactive ones drop
# out of the live glance.
_EXCLUDED_STATES = {"archived", "cancelled"}
# Cap on the cross-portfolio "needs you" list — a founder wants the few that
# matter, not every amber initiative.
_MAX_NEEDS = 8


@router.get("")
def get_portfolio(
    business_id: str = Query(..., description="Workspace to glance at."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Programs ranked worst-first by composite risk + the top at-risk
    initiatives across the portfolio (each with a nudge target = the program
    lead). 403 for non-members; members see only programs visible to them."""
    uid = user["id"]
    require_member(sb, business_id, uid)
    today = date.today()

    rows = (
        sb.table("programs").select(_PROGRAM_COLS)
        .eq("business_id", business_id).execute().data
    )
    rows = [p for p in rows if p.get("status") not in _EXCLUDED_STATES]
    # Visibility: admins/owners see the whole portfolio; members see only the
    # programs they can see (same scoping the Programs list uses).
    if not is_admin_or_owner(sb, business_id, uid):
        vis = visible_program_ids(sb, business_id, uid)
        rows = [p for p in rows if p["id"] in vis]

    programs_out: list = []
    needs: list = []
    lead_ids: set = set()
    for p in rows:
        risk = program_risk(sb, p, today)
        ranked = risk["ranked_initiatives"]
        at_risk = [i for i in ranked if i["health"] in ("red", "amber")]
        if p.get("lead_user_id"):
            lead_ids.add(p["lead_user_id"])
        programs_out.append({
            "id": p["id"], "name": p["name"], "color": p.get("color"),
            "status": p.get("status"),
            "composite_health": risk["composite_health"],
            "composite_score": risk["composite_score"],
            "outcome_pct": program_outcome_pct(sb, p["id"]),
            "components": risk["components"],
            "lead_user_id": p.get("lead_user_id"),
            "initiative_total": len(ranked),
            "at_risk_count": len(at_risk),
        })
        for i in at_risk:
            needs.append({
                "program_id": p["id"], "program_name": p["name"],
                "initiative_id": i["id"], "initiative_name": i["name"],
                "risk_score": i["risk_score"], "health": i["health"],
                "reasons": i["reasons"],
                "nudge_user_id": p.get("lead_user_id"),  # nudge the program lead
            })

    # Worst first; programs/initiatives with no signal at all sort last.
    programs_out.sort(key=lambda p: (p["composite_score"] is None, -(p["composite_score"] or 0.0)))
    needs.sort(key=lambda n: (n["risk_score"] is None, -(n["risk_score"] or 0.0)))
    needs = needs[:_MAX_NEEDS]

    # Resolve lead names once (used on both program cards and nudge targets).
    names: dict = {}
    if lead_ids:
        for u in sb.table("users").select("id, name").in_("id", list(lead_ids)).execute().data:
            names[u["id"]] = u.get("name") or ""
    for p in programs_out:
        p["lead_name"] = names.get(p.get("lead_user_id") or "")
    for n in needs:
        n["nudge_user_name"] = names.get(n.get("nudge_user_id") or "")

    rag = {"red": 0, "amber": 0, "green": 0, "not_started": 0}
    for p in programs_out:
        rag[p["composite_health"]] = rag.get(p["composite_health"], 0) + 1

    return {
        "business_id": business_id,
        "generated_at": today.isoformat(),
        "programs": programs_out,
        "needs_attention": needs,
        "counts": {
            "programs_total": len(programs_out),
            "red": rag["red"], "amber": rag["amber"], "green": rag["green"],
            "needs_attention": len(needs),
        },
    }


class NudgeIn(BaseModel):
    recipient_id: str
    note: str
    program_id: Optional[str] = None
    initiative_id: Optional[str] = None

    @field_validator("note")
    @classmethod
    def note_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("note cannot be empty")
        return v[:500]


@router.post("/nudge", status_code=201)
def nudge(
    body: NudgeIn,
    business_id: str = Query(..., description="Workspace both users belong to."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Founder nudges a lead about an at-risk program/initiative. Recorded as a
    pending notebook delegation, so it lands in the recipient's "My day" inbox.

    Guards: caller must be a member of the workspace; recipient must be a member
    too (no cross-tenant / non-member targets); can't nudge yourself."""
    uid = user["id"]
    require_member(sb, business_id, uid)
    if body.recipient_id == uid:
        raise HTTPException(status_code=400, detail="Cannot nudge yourself")
    if get_member_role(sb, business_id, body.recipient_id) is None:
        raise HTTPException(status_code=400, detail="Recipient is not a member of this workspace")

    row = (
        sb.table("notebook_assignments").insert({
            "sender_id": uid,
            "recipient_id": body.recipient_id,
            "content": body.note,
            "status": "pending",
            "source_page_id": None,
            "source_block_id": None,
        }).execute().data
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to send nudge")
    return row[0]
