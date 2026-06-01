from typing import Optional
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel, field_validator

from auth import get_current_user
from deps import (
    get_supabase, require_member, require_admin_or_owner, get_member_role,
    is_admin_or_owner, aligned_initiative_ids, program_follower_ids,
    visible_program_ids, visible_initiative_ids,
)

router = APIRouter(prefix="/api/v1/programs", tags=["programs"])

# Expanded to match the values the frontend already renders badges for; the
# migration 031 check constraint enforces the same set in the DB.
_VALID_STATUSES = {"planning", "active", "paused", "on_hold", "completed", "archived", "cancelled"}
_VALID_IMPACT_CATS = {"cost", "customer_experience", "process_efficiency", "other"}
_VALID_HEALTH = {"green", "amber", "red", "not_started"}
# Initiatives whose target end is within this window count as "at risk" in the rollup.
_AT_RISK_WINDOW_DAYS = 14


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProgramCreate(BaseModel):
    business_id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3B82F6"
    objective: Optional[str] = None
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("color")
    @classmethod
    def valid_color(cls, v: Optional[str]) -> str:
        if v and not v.startswith("#"):
            raise ValueError("color must be a hex value starting with #")
        return v or "#3B82F6"


class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    objective: Optional[str] = None
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None
    lead_user_id: Optional[str] = None
    manual_health: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, v: Optional[str]) -> Optional[str]:
        # Mirror ProgramCreate's rule. Create rejected blank/over-long names but
        # update silently accepted them (whitespace-only, 500-char names).
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
        return v

    @field_validator("manual_health")
    @classmethod
    def valid_health(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_HEALTH:
            raise ValueError(f"manual_health must be one of {sorted(_VALID_HEALTH)}")
        return v


class InitiativeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    primary_stakeholder_id: Optional[str] = None
    impact_category: Optional[str] = "other"
    impact: Optional[str] = None
    impact_metric: Optional[str] = None
    target_end_date: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 150:
            raise ValueError("name cannot exceed 150 characters")
        return v

    @field_validator("impact_category")
    @classmethod
    def valid_impact_cat(cls, v: Optional[str]) -> str:
        if v and v not in _VALID_IMPACT_CATS:
            return "other"
        return v or "other"


# ── Helpers ───────────────────────────────────────────────────────────────────

_PROGRAM_COLS = (
    "id, business_id, name, description, status, color, lead_user_id, "
    "objective, start_date, target_end_date, manual_health, created_at"
)


def _get_program_or_404(sb: Client, program_id: str) -> dict:
    rows = (
        sb.table("programs")
        .select(_PROGRAM_COLS)
        .eq("id", program_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return rows[0]


def _derive_initiative_health(initiative: dict, today: date) -> str:
    """Health dot for a single initiative on the program timeline.

    Rules (consistent with the rollup endpoint):
      - no dates                              → not_started
      - status == 'completed' / 'done'        → green (treated as on track)
      - target_end_date < today               → red
      - target_end_date <= today + 14d window → amber
      - else                                  → green
    """
    if initiative.get("status") in ("completed", "done"):
        return "green"
    end = initiative.get("target_end_date")
    if not end:
        return "not_started"
    end_d = end if isinstance(end, date) else date.fromisoformat(end[:10])
    if end_d < today:
        return "red"
    if end_d <= today + timedelta(days=_AT_RISK_WINDOW_DAYS):
        return "amber"
    return "green"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_programs(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all programs for a business with their initiative counts."""
    require_member(sb, business_id, user["id"])

    programs = (
        sb.table("programs")
        .select("id, name, description, status, color, objective, start_date, target_end_date, manual_health, lead_user_id, created_at")
        .eq("business_id", business_id)
        .order("created_at")
        .execute()
        .data
    )

    # Non-admins see programs they're "visible" on: either they have an
    # aligned initiative under it, OR they're an explicit program_followers
    # row. Admins/owners see everything. Followed-but-empty programs are
    # kept (initiative_count=0) so the apex of the pyramid stays reachable.
    is_priv = is_admin_or_owner(sb, business_id, user["id"])
    follower_progs: set[str] = set()
    if programs and not is_priv:
        prog_id_set = visible_program_ids(sb, business_id, user["id"])
        if not prog_id_set:
            return []
        programs = [p for p in programs if p["id"] in prog_id_set]
        follower_progs = program_follower_ids(sb, business_id, user["id"])

    if programs:
        prog_ids = [p["id"] for p in programs]
        # For non-admins, the initiative_count must reflect only the aligned
        # initiatives — otherwise the badge lies about what they can see.
        # Exception: program followers see the full count (cascade grants
        # read of every initiative under followed programs).
        init_q = (
            sb.table("initiatives")
            .select("program_id, id")
            .in_("program_id", prog_ids)
            .neq("status", "cancelled")
        )
        init_rows = init_q.execute().data
        if not is_priv:
            scope_set = visible_initiative_ids(sb, business_id, user["id"])
            init_rows = [
                r for r in init_rows
                if r["id"] in scope_set or r["program_id"] in follower_progs
            ]
        counts: dict = {}
        for r in init_rows:
            pid = r["program_id"]
            counts[pid] = counts.get(pid, 0) + 1
        for p in programs:
            p["initiative_count"] = counts.get(p["id"], 0)

    return programs


@router.post("", status_code=201)
def create_program(
    body: ProgramCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create a new program under a business."""
    require_member(sb, body.business_id, user["id"])

    now = datetime.now(timezone.utc).isoformat()
    result = sb.table("programs").insert({
        "business_id": body.business_id,
        "name": body.name,
        "description": body.description or None,
        "objective": body.objective or None,
        "start_date": body.start_date.isoformat() if body.start_date else None,
        "target_end_date": body.target_end_date.isoformat() if body.target_end_date else None,
        "lead_user_id": user["id"],
        "color": body.color,
        "created_at": now,
        "updated_at": now,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create program",
        )
    return result.data[0]


@router.get("/{program_id}")
def get_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Get a single program with all its non-cancelled initiatives."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    initiatives = (
        sb.table("initiatives")
        .select(
            "id, name, status, description, impact, impact_category, "
            "impact_metric, primary_stakeholder_id, start_date, target_end_date"
        )
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Non-admins: program followers see every initiative in the program;
    # everyone else is scoped to initiatives they're aligned to. 403 if
    # neither path grants visibility — the program listing won't have
    # surfaced this program to them either.
    if not is_admin_or_owner(sb, program["business_id"], user["id"]):
        is_program_follower = program_id in program_follower_ids(
            sb, program["business_id"], user["id"]
        )
        if not is_program_follower:
            scope = visible_initiative_ids(sb, program["business_id"], user["id"])
            initiatives = [i for i in initiatives if i["id"] in scope]
            if not initiatives:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have access to any initiative in this program",
                )

    # Resolve primary stakeholder names in one bulk query
    ps_ids = list({i["primary_stakeholder_id"] for i in initiatives if i.get("primary_stakeholder_id")})
    name_map: dict = {}
    if ps_ids:
        rows = sb.table("users").select("id, name").in_("id", ps_ids).execute().data
        name_map = {r["id"]: r["name"] for r in rows}
    for init in initiatives:
        init["primary_stakeholder_name"] = name_map.get(
            init.get("primary_stakeholder_id") or "", ""
        )

    program["initiatives"] = initiatives
    return program


@router.post("/{program_id}/initiatives", status_code=201)
def add_initiative(
    program_id: str,
    body: InitiativeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Add an initiative directly to a program."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    result = sb.table("initiatives").insert({
        "business_id": program["business_id"],
        "program_id": program_id,
        "name": body.name,
        "description": body.description or None,
        "owner_id": user["id"],
        "primary_stakeholder_id": body.primary_stakeholder_id or user["id"],
        "impact_category": body.impact_category,
        "impact": body.impact or None,
        "impact_metric": body.impact_metric or None,
        "target_end_date": body.target_end_date or None,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create initiative",
        )
    return result.data[0]


@router.patch("/{program_id}")
def update_program(
    program_id: str,
    body: ProgramUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update a program's fields."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields to update",
        )
    for k in ("start_date", "target_end_date"):
        if k in updates and updates[k] is not None and hasattr(updates[k], "isoformat"):
            updates[k] = updates[k].isoformat()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = sb.table("programs").update(updates).eq("id", program_id).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return result.data[0]


@router.delete("/{program_id}", status_code=204)
def delete_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Delete a program. Only the owner, admin, or program lead may delete."""
    program = _get_program_or_404(sb, program_id)

    member = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", program["business_id"])
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this business")

    is_admin = member[0]["role"] in ("owner", "admin")
    is_lead = program.get("lead_user_id") == user["id"]

    if not is_admin and not is_lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owner, admin, or program lead may delete",
        )

    sb.table("programs").delete().eq("id", program_id).execute()
    return None


# ── Rollup + Gantt ────────────────────────────────────────────────────────────

@router.get("/{program_id}/rollup")
def get_program_rollup(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Aggregate health & progress numbers for the program dashboard.

    Computed live from child initiatives + their open tasks. Returns:
      health, progress_pct, initiative_count {total, done, active, at_risk,
      overdue}, overdue_task_count, oldest_open_task {title, age_days}.
    """
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()

    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, start_date, target_end_date")
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )

    total = len(initiatives)
    done_states = {"done", "completed"}
    done = sum(1 for i in initiatives if i.get("status") in done_states)
    active = total - done

    at_risk = 0
    overdue_inits = 0
    no_dates = 0
    for init in initiatives:
        if init.get("status") in done_states:
            continue
        h = _derive_initiative_health(init, today)
        if h == "amber":
            at_risk += 1
        elif h == "red":
            overdue_inits += 1
        elif h == "not_started":
            no_dates += 1

    # Health: manual override wins, else derived from children.
    if program.get("manual_health"):
        health = program["manual_health"]
    elif total == 0 or (no_dates == total):
        health = "not_started"
    elif overdue_inits >= 2:
        health = "red"
    elif overdue_inits >= 1 or at_risk >= 1:
        health = "amber"
    else:
        health = "green"

    progress_pct = round((done / total) * 100) if total else 0

    # Overdue tasks across all child initiatives (open, past due).
    overdue_task_count = 0
    oldest_open: Optional[dict] = None
    if initiatives:
        init_ids = [i["id"] for i in initiatives]
        tasks = (
            sb.table("tasks")
            .select("id, title, status, due_date, created_at")
            .in_("initiative_id", init_ids)
            .neq("status", "done")
            .neq("status", "cancelled")
            .execute()
            .data
        )
        today_iso = today.isoformat()
        for t in tasks:
            if t.get("due_date") and t["due_date"] < today_iso:
                overdue_task_count += 1
        # Oldest open task by created_at
        tasks_with_age = [t for t in tasks if t.get("created_at")]
        if tasks_with_age:
            oldest = min(tasks_with_age, key=lambda t: t["created_at"])
            age = (today - date.fromisoformat(oldest["created_at"][:10])).days
            oldest_open = {"title": oldest.get("title") or "", "age_days": age}

    return {
        "health": health,
        "progress_pct": progress_pct,
        "initiative_count": {
            "total": total,
            "done": done,
            "active": active,
            "at_risk": at_risk,
            "overdue": overdue_inits,
        },
        "overdue_task_count": overdue_task_count,
        "oldest_open_task": oldest_open,
    }


@router.get("/{program_id}/gantt")
def get_program_gantt(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return one Gantt row per child initiative for the program-level timeline.

    Each row carries the initiative's own dates + a derived health dot so the
    frontend can render bars without recomputing.
    """
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()

    initiatives = (
        sb.table("initiatives")
        .select(
            "id, name, status, start_date, target_end_date, "
            "primary_stakeholder_id, impact_category"
        )
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Resolve stakeholder names in bulk.
    sh_ids = list({i["primary_stakeholder_id"] for i in initiatives if i.get("primary_stakeholder_id")})
    name_map: dict = {}
    if sh_ids:
        rows = sb.table("users").select("id, name").in_("id", sh_ids).execute().data
        name_map = {r["id"]: r.get("name") or "" for r in rows}

    rows = []
    for init in initiatives:
        rows.append({
            "id": init["id"],
            "title": init["name"],
            "status": init.get("status"),
            "start_date": init.get("start_date"),
            "end_date": init.get("target_end_date"),
            "primary_stakeholder_id": init.get("primary_stakeholder_id"),
            "primary_stakeholder_name": name_map.get(init.get("primary_stakeholder_id") or "", ""),
            "impact_category": init.get("impact_category"),
            "health": _derive_initiative_health(init, today),
        })

    return {
        "program": {
            "id": program["id"],
            "name": program["name"],
            "start_date": program.get("start_date"),
            "end_date": program.get("target_end_date"),
            "color": program.get("color"),
        },
        "rows": rows,
    }


# ── Program followers (P1 cascade) ────────────────────────────────────────────
# Program followers are read-only viewers at the apex of the visibility
# pyramid: follow a program -> see every initiative under it (and via the
# task cascade, every task/subtask). Add/remove gated to workspace owner/
# admin, mirroring initiative_followers (033).


class _ProgramFollowerAdd(BaseModel):
    user_id: str


@router.get("/{program_id}/followers")
def list_program_followers(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List followers of a program. Any business member can view the roster
    so people know who else has read access."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    rows = (
        sb.table("program_followers")
        .select("user_id, added_by, added_at")
        .eq("program_id", program_id)
        .execute()
        .data
    )
    user_ids = list({r["user_id"] for r in rows})
    name_map: dict = {}
    email_map: dict = {}
    if user_ids:
        users = sb.table("users").select("id, name, email").in_("id", user_ids).execute().data
        name_map = {u["id"]: u.get("name") or "" for u in users}
        email_map = {u["id"]: u.get("email") or "" for u in users}
    return [
        {
            "user_id": r["user_id"],
            "name": name_map.get(r["user_id"], ""),
            "email": email_map.get(r["user_id"], ""),
            "added_by": r.get("added_by"),
            "added_at": r.get("added_at"),
        }
        for r in rows
    ]


@router.post("/{program_id}/followers", status_code=201)
def add_program_follower(
    program_id: str,
    body: _ProgramFollowerAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Add a follower. Workspace owner/admin only — mirrors the initiative
    follower gate so only admins can grant read access."""
    program = _get_program_or_404(sb, program_id)
    require_admin_or_owner(sb, program["business_id"], user["id"])

    if get_member_role(sb, program["business_id"], body.user_id) is None:
        raise HTTPException(
            status_code=400,
            detail="user_id must be a member of this workspace",
        )

    sb.table("program_followers").upsert(
        {
            "program_id": program_id,
            "user_id": body.user_id,
            "added_by": user["id"],
        },
        on_conflict="program_id,user_id",
    ).execute()
    return {"ok": True}


@router.delete("/{program_id}/followers/{user_id}", status_code=204)
def remove_program_follower(
    program_id: str,
    user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Remove a follower. Workspace owner/admin only."""
    program = _get_program_or_404(sb, program_id)
    require_admin_or_owner(sb, program["business_id"], user["id"])

    sb.table("program_followers").delete().eq(
        "program_id", program_id
    ).eq("user_id", user_id).execute()
