from datetime import datetime, timezone, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member, require_admin_or_owner
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


class BusinessCreate(BaseModel):
    name: str
    type: Literal["building", "client"]
    workspace_mode: Optional[Literal["personal", "organisation"]] = None


class BusinessUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["building", "client"]] = None
    workspace_mode: Optional[Literal["personal", "organisation"]] = None
    logo_url: Optional[str] = None
    time_zone: Optional[str] = None
    currency: Optional[str] = None
    fiscal_year_start_month: Optional[int] = None
    company_name: Optional[str] = None
    domain: Optional[str] = None


class MemberRoleUpdate(BaseModel):
    role: Literal["member", "admin"]


class MemberPermissionUpdate(BaseModel):
    can_view_people_board: bool


class MemberOnboardedUpdate(BaseModel):
    onboarded: bool


@router.post("/", status_code=201)
@router.post("", status_code=201, include_in_schema=False)
def create_business(
    body: BusinessCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create the caller's workspace. **Cap: one owned workspace per user.**
    Users can still be members of unlimited workspaces via invite, but
    creating multiple owned workspaces is disabled — that path multiplied
    trial-abuse, edge cases, and isolation bugs (see audit tasksheet).
    Returns 409 if the caller already owns one.
    """
    existing = (
        sb.table("businesses")
        .select("id, name")
        .eq("owner_id", user["id"])
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already own a workspace. Edit it from Workspace settings or delete it before creating a new one.",
        )

    insert_payload: dict = {"name": body.name.strip(), "type": body.type, "owner_id": user["id"]}
    if body.workspace_mode:
        insert_payload["workspace_mode"] = body.workspace_mode
    biz_result = sb.table("businesses").insert(insert_payload).execute()
    if not biz_result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create business")
    biz = biz_result.data[0]

    # No DB transaction spans these PostgREST calls, so compensate by hand: if
    # the owner-membership insert fails, delete the business we just made.
    # Otherwise the user is left with an orphaned workspace that makes every
    # later create_business 409 ("you already have a workspace") with no way
    # back. (This is exactly the partial-state failure we hit in production.)
    try:
        member_result = sb.table("business_members").insert({
            "business_id": biz["id"],
            "user_id": user["id"],
            "role": "owner",
        }).execute()
        if not member_result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Business created but failed to assign owner membership",
            )
    except Exception as exc:
        try:
            sb.table("businesses").delete().eq("id", biz["id"]).execute()
        except Exception:
            pass  # best effort — surface the original error regardless
        if isinstance(exc, HTTPException):
            raise
        # A raw driver/constraint error would otherwise bubble out as an
        # unhandled 500 with no body — normalise it to a clean response.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Business created but failed to assign owner membership",
        ) from exc

    # The 60-day free-trial subscription is auto-provisioned by the
    # `trg_create_trial` AFTER INSERT trigger on businesses
    # (create_trial_subscription()). The previous app-level upsert here was
    # redundant AND broken — it referenced a non-existent `amount_inr` column
    # and used on_conflict="business_id" with no matching unique constraint,
    # so it 500'd and blocked workspace creation for every new customer.
    return biz


@router.get("/my")
def get_my_business(
    prefer: Optional[str] = Query(default=None, description="Preferred business_id — respected when the user is a member there. Lets a multi-workspace user pin their current context via localStorage."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the user's "active" workspace. For multi-workspace members
    (e.g. an owner of one workspace who's also a member of another), accept
    a `?prefer=<business_id>` hint — when the user is a member there, that
    workspace wins. Otherwise pick by activity: workspaces where the user is
    primary on initiatives / tasks, then ownership, then membership age.
    """
    # Honour the explicit preference (front-end caches the last selection
    # in localStorage and forwards it here so switchers persist).
    if prefer:
        member = (
            sb.table("business_members")
            .select("business_id")
            .eq("user_id", user["id"])
            .eq("business_id", prefer)
            .execute()
            .data
        )
        if member:
            biz = (
                sb.table("businesses")
                .select("*")
                .eq("id", prefer)
                .execute()
                .data
            )
            if biz:
                return biz[0]
        # Fall through if `prefer` isn't a workspace they're in (stale id).

    memberships = (
        sb.table("business_members")
        .select("business_id, joined_at")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not memberships:
        raise HTTPException(status_code=404, detail="No business found for this user")
    biz_ids = [m["business_id"] for m in memberships]

    # Rank by activity: where is this user actually doing the most work?
    # init_primary > task_primary > tasks_created > ownership recency.
    init_counts = sb.table("initiatives").select("business_id").in_("business_id", biz_ids).eq("primary_stakeholder_id", user["id"]).execute().data
    init_score: dict = {}
    for r in init_counts:
        init_score[r["business_id"]] = init_score.get(r["business_id"], 0) + 1
    task_rows = sb.table("tasks").select("initiative_id").eq("primary_stakeholder_id", user["id"]).execute().data
    task_score: dict = {}
    if task_rows:
        init_to_biz = {
            r["id"]: r["business_id"]
            for r in sb.table("initiatives").select("id, business_id").in_("id", [t["initiative_id"] for t in task_rows if t.get("initiative_id")]).execute().data
        }
        for t in task_rows:
            bid = init_to_biz.get(t.get("initiative_id"))
            if bid:
                task_score[bid] = task_score.get(bid, 0) + 1
    owned_ids = {
        r["id"]
        for r in sb.table("businesses").select("id").in_("id", biz_ids).eq("owner_id", user["id"]).execute().data
    }
    joined_at_by_biz = {m["business_id"]: m.get("joined_at") or "" for m in memberships}

    def score(bid: str) -> tuple:
        return (
            init_score.get(bid, 0),
            task_score.get(bid, 0),
            1 if bid in owned_ids else 0,
            joined_at_by_biz.get(bid, ""),
        )

    best_bid = max(biz_ids, key=score)
    biz = sb.table("businesses").select("*").eq("id", best_bid).execute().data
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    return biz[0]


@router.get("/mine")
def list_my_businesses(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Every workspace the caller is a member of. Powers the workspace
    switcher in the sidebar so multi-workspace users can flip between
    contexts without losing their place."""
    memberships = (
        sb.table("business_members")
        .select("business_id, role")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not memberships:
        return []
    biz_ids = [m["business_id"] for m in memberships]
    biz_rows = (
        sb.table("businesses")
        .select("id, name, owner_id")
        .in_("id", biz_ids)
        .execute()
        .data
    )
    role_by_biz = {m["business_id"]: m["role"] for m in memberships}
    return [
        {
            "id": b["id"],
            "name": b.get("name") or "",
            "role": role_by_biz.get(b["id"], "member"),
            "is_owner": b.get("owner_id") == user["id"],
        }
        for b in biz_rows
    ]


@router.patch("/{business_id}")
def update_business(
    business_id: str,
    body: BusinessUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update workspace identity fields. Owner or admin only.

    workspace_mode is treated as a one-way decision: once the workspace has
    real data tied to a mode (assignees for personal, non-owner members for
    organisation) we refuse to flip it, because the other mode has no
    migration path for that data. The frontend disables the toggle in the
    same conditions; this is defense in depth.
    """
    require_admin_or_owner(sb, business_id, user["id"])
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    if "workspace_mode" in payload:
        current = (
            sb.table("businesses")
            .select("workspace_mode")
            .eq("id", business_id)
            .execute()
            .data
        )
        current_mode = (current[0].get("workspace_mode") if current else None) or None
        new_mode = payload["workspace_mode"]
        if current_mode and new_mode != current_mode:
            if current_mode == "personal":
                assignees = (
                    sb.table("assignees")
                    .select("id")
                    .eq("business_id", business_id)
                    .limit(1)
                    .execute()
                    .data
                )
                if assignees:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Can't switch to organisation mode while named "
                            "assignees exist. Delete them first or contact "
                            "support for a migration."
                        ),
                    )
            else:  # current_mode == "organisation"
                non_owner = (
                    sb.table("business_members")
                    .select("user_id")
                    .eq("business_id", business_id)
                    .neq("role", "owner")
                    .limit(1)
                    .execute()
                    .data
                )
                if non_owner:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Can't switch to personal mode while other "
                            "members exist. Remove them first or contact "
                            "support for a migration."
                        ),
                    )

    result = sb.table("businesses").update(payload).eq("id", business_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/{business_id}", status_code=204)
def delete_business(
    business_id: str,
    confirm_name: str = Query(..., description="Must echo the workspace's current name exactly. Guards against accidental destruction."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Permanently delete a workspace.

    Owner-only. Irreversible. Cascades through every related table via the
    ON DELETE CASCADE FK chain (initiatives → tasks → subtasks, members,
    invites, billing rows, programs, themes, activity log, etc.).

    The `confirm_name` query parameter must match the workspace's current
    `name` — defense-in-depth against a stray DELETE call. The frontend
    presents a "type the workspace name to confirm" modal before sending.
    """
    biz = (
        sb.table("businesses")
        .select("id, name, owner_id")
        .eq("id", business_id)
        .execute()
        .data
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Workspace not found")
    b = biz[0]
    if b["owner_id"] != user["id"]:
        raise HTTPException(
            status_code=403,
            detail="Only the workspace owner can delete the workspace.",
        )
    if (confirm_name or "").strip() != (b["name"] or ""):
        raise HTTPException(
            status_code=400,
            detail="Confirmation name doesn't match — type the workspace name exactly to delete.",
        )
    # Cascade does the rest. FK audit confirmed every child table from
    # businesses uses ON DELETE CASCADE (buildings, clients,
    # business_members, initiatives, subscriptions, invoices, programs,
    # activity_log, workspace_invites, themes, assignees,
    # workspace_join_requests).
    sb.table("businesses").delete().eq("id", business_id).execute()
    return


@router.get("")
def list_businesses(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    memberships = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    ids = [m["business_id"] for m in memberships]
    if not ids:
        return []
    return sb.table("businesses").select("*").in_("id", ids).execute().data


@router.get("/{business_id}/members")
def list_business_members(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    members = (
        sb.table("business_members")
        .select("user_id, role, joined_at, can_view_people_board, onboarded_at")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    user_ids = [m["user_id"] for m in members]
    if not user_ids:
        return []
    users_rows = sb.table("users").select("id, name").in_("id", user_ids).execute().data
    user_map = {u["id"]: u for u in users_rows}

    # last_sign_in_at and email live in auth.users — only reachable via the
    # admin API. last_sign_in_at flags members who have never logged in (the
    # "needs onboarding" surface); email lets the frontend search and detect
    # external-domain invites. Best-effort: a failure here just leaves both
    # fields null, which the UI degrades to gracefully.
    last_sign_in: dict[str, str | None] = {}
    auth_email: dict[str, str] = {}
    try:
        auth_users = sb.auth.admin.list_users()
        for u in auth_users:
            uid = str(getattr(u, "id", "") or "")
            ts = getattr(u, "last_sign_in_at", None)
            em = getattr(u, "email", "") or ""
            if uid:
                last_sign_in[uid] = ts.isoformat() if ts else None
                if em:
                    auth_email[uid] = em
    except Exception:
        pass

    for m in members:
        u = user_map.get(m["user_id"], {})
        m["name"] = u.get("name", "")
        m["last_sign_in_at"] = last_sign_in.get(m["user_id"])
        m["email"] = auth_email.get(m["user_id"])
    return members


@router.patch("/{business_id}/members/{target_user_id}")
def update_member_role(
    business_id: str,
    target_user_id: str,
    body: MemberRoleUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    caller_role = require_admin_or_owner(sb, business_id, user["id"])

    # Can't modify yourself
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    # Fetch target's current role
    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    target_role = target_rows[0]["role"]

    # Protect the owner — never reassignable via this endpoint
    if target_role == "owner":
        raise HTTPException(status_code=403, detail="Cannot change the workspace owner's role")

    # Admins can only manage members, not other admins
    if caller_role == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot change another admin's role")

    result = (
        sb.table("business_members")
        .update({"role": body.role})
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
    )
    return result.data[0] if result.data else {}


@router.patch("/{business_id}/members/{target_user_id}/permissions")
def update_member_permissions(
    business_id: str,
    target_user_id: str,
    body: MemberPermissionUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Grant/revoke a member's access to the People board. Owner/admin only."""
    require_admin_or_owner(sb, business_id, user["id"])

    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    result = (
        sb.table("business_members")
        .update({"can_view_people_board": body.can_view_people_board})
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
    )
    return result.data[0] if result.data else {}


@router.patch("/{business_id}/members/{target_user_id}/onboarded")
def update_member_onboarded(
    business_id: str,
    target_user_id: str,
    body: MemberOnboardedUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Mark a member as onboarded (or revert). Owner/admin only.

    Combined with auth.users.last_sign_in_at, this decides whether the
    member stays in the always-visible "needs onboarding" group on the
    Workspace > Team settings page.
    """
    require_admin_or_owner(sb, business_id, user["id"])

    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    if target_rows[0]["role"] == "owner":
        raise HTTPException(status_code=400, detail="Owner is always onboarded")

    onboarded_at = datetime.now(timezone.utc).isoformat() if body.onboarded else None
    result = (
        sb.table("business_members")
        .update({"onboarded_at": onboarded_at})
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
    )
    return result.data[0] if result.data else {}


@router.delete("/{business_id}/members/{target_user_id}", status_code=204)
def remove_member(
    business_id: str,
    target_user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    caller_role = require_admin_or_owner(sb, business_id, user["id"])

    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the workspace")

    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    target_role = target_rows[0]["role"]

    if target_role == "owner":
        raise HTTPException(status_code=403, detail="Cannot remove the workspace owner")

    if caller_role == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot remove other admins")

    # Preserve their tasks but drop their assignments. primary_stakeholder_id
    # and initiatives.owner_id are NOT NULL with ON DELETE RESTRICT — reassign
    # to the caller (the admin/owner clicking Remove). Scoped to *this*
    # business only; the same user in another workspace is untouched.
    init_ids = [
        r["id"]
        for r in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]
    task_ids = []
    if init_ids:
        task_ids = [
            r["id"]
            for r in sb.table("tasks").select("id").in_("initiative_id", init_ids).execute().data
        ]

    if init_ids:
        sb.table("initiatives").update({"owner_id": user["id"]}).in_("id", init_ids).eq(
            "owner_id", target_user_id
        ).execute()

    if task_ids:
        sb.table("tasks").update({"primary_stakeholder_id": user["id"]}).in_("id", task_ids).eq(
            "primary_stakeholder_id", target_user_id
        ).execute()
        sb.table("task_stakeholders").delete().in_("task_id", task_ids).eq(
            "user_id", target_user_id
        ).execute()
        sb.table("subtasks").update({"assignee_id": None}).in_("task_id", task_ids).eq(
            "assignee_id", target_user_id
        ).execute()
        sb.table("item_watchers").delete().in_("task_id", task_ids).eq(
            "user_id", target_user_id
        ).execute()

    sb.table("business_members").delete().eq("business_id", business_id).eq("user_id", target_user_id).execute()


@router.get("/{business_id}/my-role")
def get_my_role(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the current user's role in this business."""
    rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not a member of this business")
    return {"role": rows[0]["role"]}
