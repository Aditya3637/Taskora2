"""Notebook router — personal-first, team-connected notes.

Surface model:
- Projects (folders) and pages within them are user-scoped.
- Pages can be shared per-page with viewer/editor followers.
- A single global checklist per user, with a delegation inbox tab.
- Single goals doc per user, owner-only edit.
- Assignment flow: @workspace-mention -> recipient's inbox -> accept ->
  promotes to recipient's checklist. Sender sees status pill.

Authorization model:
- Most endpoints: caller owns the row (owner_id = caller).
- Pages: read = owner | follower (any role); edit = owner | editor follower;
  share/unshare = owner only.
- Cross-workspace assignments are forbidden — the sender must share at
  least one workspace with the recipient.

No PostgREST RLS protects this — every notebook_* table denies
anon/authenticated. The backend service role is the only writer; this
module is the ONLY enforcement layer for ownership + sharing rules.
"""
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from supabase import Client

from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/notebook", tags=["notebook"])


# ─────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    sort_order: Optional[int] = None


class PageCreate(BaseModel):
    project_id: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=200)
    body: Optional[list] = None


class PageUpdate(BaseModel):
    project_id: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body: Optional[list] = None
    sort_order: Optional[int] = None


class GoalsUpdate(BaseModel):
    body: list


class ChecklistCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    due_date: Optional[str] = None  # ISO YYYY-MM-DD
    source_page_id: Optional[str] = None
    parent_item_id: Optional[str] = None


class ChecklistUpdate(BaseModel):
    content: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    due_date: Optional[str] = None
    status: Optional[Literal["open", "done"]] = None
    sort_order: Optional[int] = None
    parent_item_id: Optional[str] = None


class AssignmentCreate(BaseModel):
    recipient_id: str
    content: str = Field(min_length=1, max_length=2000)
    source_page_id: Optional[str] = None
    source_block_id: Optional[str] = None


class FollowerAdd(BaseModel):
    user_id: str
    role: Literal["viewer", "editor"] = "viewer"


class FollowerUpdate(BaseModel):
    role: Literal["viewer", "editor"]


# ─────────────────────────────────────────────────────────────────────
# Helpers — ownership + sharing checks
# ─────────────────────────────────────────────────────────────────────

def _own_project_or_404(sb: Client, project_id: str, user_id: str) -> dict:
    rows = (
        sb.table("notebook_projects")
        .select("*")
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")
    return rows[0]


def _page_or_404(sb: Client, page_id: str) -> dict:
    rows = sb.table("notebook_pages").select("*").eq("id", page_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    return rows[0]


def _follower_role(sb: Client, page_id: str, user_id: str) -> Optional[str]:
    rows = (
        sb.table("notebook_page_followers")
        .select("role")
        .eq("page_id", page_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    return rows[0]["role"] if rows else None


def _page_visible_to(sb: Client, page: dict, user_id: str) -> bool:
    if page["owner_id"] == user_id:
        return True
    return _follower_role(sb, page["id"], user_id) is not None


def _page_writable_by(sb: Client, page: dict, user_id: str) -> bool:
    if page["owner_id"] == user_id:
        return True
    return _follower_role(sb, page["id"], user_id) == "editor"


def _shared_workspace(sb: Client, user_a: str, user_b: str) -> bool:
    """True iff users A and B are members of at least one common workspace."""
    a = {
        r["business_id"]
        for r in sb.table("business_members")
        .select("business_id")
        .eq("user_id", user_a)
        .execute()
        .data
    }
    if not a:
        return False
    b = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user_b)
        .in_("business_id", list(a))
        .limit(1)
        .execute()
        .data
    )
    return bool(b)


# ─────────────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────────────

@router.get("/projects")
def list_projects(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Caller's projects, oldest-first. Archived projects are excluded by
    default — restore via direct PATCH if needed (no archived-list endpoint
    in v1; keeps the UI uncluttered)."""
    rows = (
        sb.table("notebook_projects")
        .select("*")
        .eq("owner_id", user["id"])
        .is_("archived_at", "null")
        .order("sort_order")
        .order("created_at")
        .execute()
        .data
    )
    return rows


@router.post("/projects", status_code=201)
def create_project(
    body: ProjectCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    result = (
        sb.table("notebook_projects")
        .insert({"owner_id": user["id"], "name": body.name.strip()})
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create project")
    return result.data[0]


@router.patch("/projects/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _own_project_or_404(sb, project_id, user["id"])
    patch: dict = {}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.sort_order is not None:
        patch["sort_order"] = body.sort_order
    if not patch:
        return _own_project_or_404(sb, project_id, user["id"])
    result = (
        sb.table("notebook_projects")
        .update(patch)
        .eq("id", project_id)
        .eq("owner_id", user["id"])
        .execute()
    )
    return result.data[0] if result.data else _own_project_or_404(sb, project_id, user["id"])


@router.delete("/projects/{project_id}", status_code=204)
def archive_project(
    project_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Soft-archive. Pages inside become orphan (project_id -> null via FK
    ON DELETE SET NULL would also work for hard delete; we soft-archive
    so the user can still recover)."""
    _own_project_or_404(sb, project_id, user["id"])
    sb.table("notebook_projects").update(
        {"archived_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", project_id).eq("owner_id", user["id"]).execute()
    return None


# ─────────────────────────────────────────────────────────────────────
# Pages
# ─────────────────────────────────────────────────────────────────────

@router.get("/pages")
def list_pages(
    project_id: Optional[str] = Query(default=None, description="Restrict to one project. Omit for all pages owned by caller."),
    shared: bool = Query(default=False, description="When true, returns pages the caller is a follower on (Shared-with-me)."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    if shared:
        follow_rows = (
            sb.table("notebook_page_followers")
            .select("page_id, role")
            .eq("user_id", uid)
            .execute()
            .data
        )
        if not follow_rows:
            return []
        page_ids = [r["page_id"] for r in follow_rows]
        pages = (
            sb.table("notebook_pages")
            .select("*")
            .in_("id", page_ids)
            .is_("archived_at", "null")
            .order("updated_at", desc=True)
            .execute()
            .data
        )
        role_by_id = {r["page_id"]: r["role"] for r in follow_rows}
        for p in pages:
            p["follower_role"] = role_by_id.get(p["id"])
        return pages

    q = (
        sb.table("notebook_pages")
        .select("*")
        .eq("owner_id", uid)
        .is_("archived_at", "null")
    )
    if project_id is not None:
        q = q.eq("project_id", project_id) if project_id != "null" else q.is_("project_id", "null")
    return q.order("sort_order").order("updated_at", desc=True).execute().data


@router.post("/pages", status_code=201)
def create_page(
    body: PageCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    if body.project_id:
        _own_project_or_404(sb, body.project_id, uid)
    payload = {
        "owner_id": uid,
        "project_id": body.project_id,
        "title": (body.title or "Untitled").strip()[:200],
        "body": body.body if body.body is not None else [],
    }
    result = sb.table("notebook_pages").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create page")
    return result.data[0]


@router.get("/pages/{page_id}")
def get_page(
    page_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if not _page_visible_to(sb, page, user["id"]):
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.patch("/pages/{page_id}")
def update_page(
    page_id: str,
    body: PageUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if not _page_writable_by(sb, page, user["id"]):
        raise HTTPException(status_code=403, detail="Read-only on this page")
    patch: dict = {}
    fields_set = body.model_fields_set
    if "project_id" in fields_set:
        # Only the owner can move a page between projects (including to
        # orphan). An editor can edit content but not reorganise the tree.
        if page["owner_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Only the owner can move a page")
        if body.project_id:
            _own_project_or_404(sb, body.project_id, user["id"])
        patch["project_id"] = body.project_id
    if body.title is not None:
        patch["title"] = body.title.strip()[:200]
    if body.body is not None:
        patch["body"] = body.body
    if body.sort_order is not None:
        patch["sort_order"] = body.sort_order
    if not patch:
        return page
    result = sb.table("notebook_pages").update(patch).eq("id", page_id).execute()
    return result.data[0] if result.data else page


@router.delete("/pages/{page_id}", status_code=204)
def archive_page(
    page_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if page["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner can delete a page")
    sb.table("notebook_pages").update(
        {"archived_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", page_id).execute()
    return None


# ─────────────────────────────────────────────────────────────────────
# Goals
# ─────────────────────────────────────────────────────────────────────

@router.get("/goals")
def get_goals(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("notebook_goals").select("*").eq("owner_id", user["id"]).execute().data
    if rows:
        return rows[0]
    # Lazy-create on first read so the FE always gets a writable shape.
    fresh = sb.table("notebook_goals").insert({"owner_id": user["id"], "body": []}).execute()
    return fresh.data[0] if fresh.data else {"owner_id": user["id"], "body": []}


@router.put("/goals")
def update_goals(
    body: GoalsUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Upsert on owner_id (PK), so calling /goals without first GET-ing is safe.
    result = (
        sb.table("notebook_goals")
        .upsert({"owner_id": user["id"], "body": body.body}, on_conflict="owner_id")
        .execute()
    )
    return result.data[0] if result.data else {"owner_id": user["id"], "body": body.body}


# ─────────────────────────────────────────────────────────────────────
# Checklist
# ─────────────────────────────────────────────────────────────────────

@router.get("/checklist")
def list_checklist(
    tab: Literal["mine", "assigned"] = Query(default="mine"),
    include_done: bool = Query(default=False),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Two tabs:
    - tab=mine: items owned by the caller (status filter optional)
    - tab=assigned: pending assignments from other users that the caller
      hasn't acted on yet. Returned shape mirrors checklist items so the
      FE can render both lists with the same row component.
    """
    uid = user["id"]
    if tab == "mine":
        q = sb.table("notebook_checklist_items").select("*").eq("owner_id", uid)
        if not include_done:
            q = q.eq("status", "open")
        return q.order("sort_order").order("created_at").execute().data

    # tab == "assigned"
    rows = (
        sb.table("notebook_assignments")
        .select("*")
        .eq("recipient_id", uid)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    # Resolve sender names for the UI.
    sender_ids = sorted({r["sender_id"] for r in rows})
    sender_names: dict = {}
    if sender_ids:
        for u in (
            sb.table("users").select("id, name").in_("id", sender_ids).execute().data
        ):
            sender_names[u["id"]] = u.get("name") or ""
    for r in rows:
        r["sender_name"] = sender_names.get(r["sender_id"], "")
    return rows


@router.get("/checklist/assigned-count")
def assigned_count(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Just the badge number. Used by the checklist tab counter so the
    UI doesn't have to fetch the full inbox list to render the count."""
    rows = (
        sb.table("notebook_assignments")
        .select("id")
        .eq("recipient_id", user["id"])
        .eq("status", "pending")
        .execute()
        .data
    )
    return {"count": len(rows)}


@router.post("/checklist", status_code=201)
def create_checklist_item(
    body: ChecklistCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    if body.source_page_id:
        page = _page_or_404(sb, body.source_page_id)
        if not _page_visible_to(sb, page, user["id"]):
            raise HTTPException(status_code=404, detail="Source page not found")
    if body.parent_item_id:
        parent = (
            sb.table("notebook_checklist_items")
            .select("owner_id")
            .eq("id", body.parent_item_id)
            .eq("owner_id", user["id"])
            .execute()
            .data
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Parent item not found")
    payload = {
        "owner_id": user["id"],
        "content": body.content.strip(),
        "due_date": body.due_date,
        "source_page_id": body.source_page_id,
        "parent_item_id": body.parent_item_id,
        "status": "open",
    }
    result = sb.table("notebook_checklist_items").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create item")
    return result.data[0]


@router.patch("/checklist/{item_id}")
def update_checklist_item(
    item_id: str,
    body: ChecklistUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    existing = (
        sb.table("notebook_checklist_items")
        .select("*")
        .eq("id", item_id)
        .eq("owner_id", user["id"])
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    patch: dict = {}
    if body.content is not None:
        patch["content"] = body.content.strip()
    if body.due_date is not None:
        patch["due_date"] = body.due_date or None
    if body.status is not None:
        patch["status"] = body.status
        patch["completed_at"] = (
            datetime.now(timezone.utc).isoformat() if body.status == "done" else None
        )
    if body.sort_order is not None:
        patch["sort_order"] = body.sort_order
    if body.parent_item_id is not None:
        patch["parent_item_id"] = body.parent_item_id or None
    if not patch:
        return existing[0]
    result = (
        sb.table("notebook_checklist_items")
        .update(patch)
        .eq("id", item_id)
        .eq("owner_id", user["id"])
        .execute()
    )
    item = result.data[0] if result.data else existing[0]

    # If this item was promoted from an assignment AND it was just marked
    # done, flip the sender-side assignment status to 'done' so the
    # source page's status pill updates.
    if item.get("source_assignment_id") and body.status == "done":
        sb.table("notebook_assignments").update(
            {"status": "done", "completed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", item["source_assignment_id"]).execute()

    return item


@router.delete("/checklist/{item_id}", status_code=204)
def delete_checklist_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    sb.table("notebook_checklist_items").delete().eq("id", item_id).eq(
        "owner_id", user["id"]
    ).execute()
    return None


# ─────────────────────────────────────────────────────────────────────
# Assignments — delegation inbox
# ─────────────────────────────────────────────────────────────────────

@router.post("/assignments", status_code=201)
def create_assignment(
    body: AssignmentCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Sender creates a delegation. Hard requirement: sender and recipient
    must share at least one workspace — cross-org assignments are forbidden
    by design (mention picker should filter these out client-side, but we
    re-check here so a forged request can't bypass)."""
    uid = user["id"]
    if body.recipient_id == uid:
        raise HTTPException(status_code=400, detail="Cannot assign to yourself")
    # Recipient must exist.
    target = sb.table("users").select("id, name").eq("id", body.recipient_id).execute().data
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if not _shared_workspace(sb, uid, body.recipient_id):
        raise HTTPException(
            status_code=403,
            detail="Cannot assign to a user outside your workspaces",
        )
    if body.source_page_id:
        page = _page_or_404(sb, body.source_page_id)
        if not _page_visible_to(sb, page, uid):
            raise HTTPException(status_code=404, detail="Source page not found")
    payload = {
        "sender_id": uid,
        "recipient_id": body.recipient_id,
        "source_page_id": body.source_page_id,
        "source_block_id": body.source_block_id,
        "content": body.content.strip(),
        "status": "pending",
    }
    result = sb.table("notebook_assignments").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create assignment")
    return result.data[0]


@router.get("/assignments/sent")
def list_sent_assignments(
    source_page_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """For the source-side status pills. Caller is the sender."""
    q = (
        sb.table("notebook_assignments")
        .select("*")
        .eq("sender_id", user["id"])
    )
    if source_page_id:
        q = q.eq("source_page_id", source_page_id)
    return q.order("created_at", desc=True).execute().data


@router.post("/assignments/{assignment_id}/accept")
def accept_assignment(
    assignment_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    a = _load_assignment_as_recipient(sb, assignment_id, user["id"])
    if a["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Already {a['status']}")
    # Promote into recipient's checklist.
    item = (
        sb.table("notebook_checklist_items")
        .insert(
            {
                "owner_id": user["id"],
                "content": a["content"],
                "source_assignment_id": a["id"],
                "source_page_id": a.get("source_page_id"),
                "status": "open",
            }
        )
        .execute()
    )
    item_id = item.data[0]["id"] if item.data else None
    sb.table("notebook_assignments").update(
        {
            "status": "accepted",
            "accepted_at": datetime.now(timezone.utc).isoformat(),
            "promoted_checklist_item_id": item_id,
        }
    ).eq("id", assignment_id).execute()
    return {"assignment_id": assignment_id, "checklist_item_id": item_id}


@router.post("/assignments/{assignment_id}/decline")
def decline_assignment(
    assignment_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    a = _load_assignment_as_recipient(sb, assignment_id, user["id"])
    if a["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Already {a['status']}")
    sb.table("notebook_assignments").update({"status": "declined"}).eq(
        "id", assignment_id
    ).execute()
    return {"assignment_id": assignment_id, "status": "declined"}


def _load_assignment_as_recipient(sb: Client, assignment_id: str, user_id: str) -> dict:
    rows = (
        sb.table("notebook_assignments")
        .select("*")
        .eq("id", assignment_id)
        .eq("recipient_id", user_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return rows[0]


# ─────────────────────────────────────────────────────────────────────
# Followers — sharing
# ─────────────────────────────────────────────────────────────────────

@router.get("/pages/{page_id}/followers")
def list_followers(
    page_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if not _page_visible_to(sb, page, user["id"]):
        raise HTTPException(status_code=404, detail="Page not found")
    rows = (
        sb.table("notebook_page_followers")
        .select("user_id, role, added_at")
        .eq("page_id", page_id)
        .execute()
        .data
    )
    if not rows:
        return []
    user_ids = [r["user_id"] for r in rows]
    name_rows = sb.table("users").select("id, name").in_("id", user_ids).execute().data
    name_by_id = {u["id"]: u.get("name") or "" for u in name_rows}
    return [
        {**r, "name": name_by_id.get(r["user_id"], "")}
        for r in rows
    ]


@router.post("/pages/{page_id}/followers", status_code=201)
def add_follower(
    page_id: str,
    body: FollowerAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if page["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner can share a page")
    if body.user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot add yourself as a follower")
    # Recipient must share at least one workspace with the owner.
    if not _shared_workspace(sb, user["id"], body.user_id):
        raise HTTPException(
            status_code=403,
            detail="Can only share with members of a workspace you share",
        )
    sb.table("notebook_page_followers").upsert(
        {
            "page_id": page_id,
            "user_id": body.user_id,
            "role": body.role,
            "added_by": user["id"],
        },
        on_conflict="page_id,user_id",
    ).execute()
    return {"page_id": page_id, "user_id": body.user_id, "role": body.role}


@router.patch("/pages/{page_id}/followers/{user_id}")
def promote_follower(
    page_id: str,
    user_id: str,
    body: FollowerUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    if page["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner can change roles")
    result = (
        sb.table("notebook_page_followers")
        .update({"role": body.role})
        .eq("page_id", page_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Follower not found")
    return result.data[0]


@router.delete("/pages/{page_id}/followers/{user_id}", status_code=204)
def remove_follower(
    page_id: str,
    user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    page = _page_or_404(sb, page_id)
    # Owner can remove anyone; a follower can remove themselves (self-unsub).
    if page["owner_id"] != user["id"] and user_id != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner can remove followers")
    sb.table("notebook_page_followers").delete().eq("page_id", page_id).eq(
        "user_id", user_id
    ).execute()
    return None


# ─────────────────────────────────────────────────────────────────────
# People picker — workspace-scoped first, then global identify
# ─────────────────────────────────────────────────────────────────────

@router.get("/people-picker")
def people_picker(
    q: str = Query(default="", description="Name fragment to search"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return up to 50 results, partitioned:
    - `in_workspace`: people who share a workspace with the caller. Eligible
      for the assignment flow.
    - `external`: name-matched people outside the caller's workspaces.
      Surfaced for identification only; assigning to them is a 403 at
      /assignments.

    Anonymous users / orphaned accounts aren't shown.
    """
    uid = user["id"]
    # Caller's workspaces
    caller_biz = [
        r["business_id"]
        for r in sb.table("business_members")
        .select("business_id")
        .eq("user_id", uid)
        .execute()
        .data
    ]
    in_workspace_ids: set = set()
    if caller_biz:
        peers = (
            sb.table("business_members")
            .select("user_id")
            .in_("business_id", caller_biz)
            .execute()
            .data
        )
        in_workspace_ids = {r["user_id"] for r in peers if r["user_id"] != uid}

    needle = q.strip()
    in_workspace: List[dict] = []
    external: List[dict] = []
    if in_workspace_ids:
        ub = sb.table("users").select("id, name, email").in_("id", list(in_workspace_ids))
        if needle:
            ub = ub.ilike("name", f"%{needle}%")
        ub = ub.order("name").limit(50)
        in_workspace = ub.execute().data or []

    if needle and len(needle) >= 2:
        rest = (
            sb.table("users")
            .select("id, name")  # NB: no email — out-of-workspace users get name only
            .ilike("name", f"%{needle}%")
            .order("name")
            .limit(50)
            .execute()
            .data
            or []
        )
        seen = in_workspace_ids | {uid}
        external = [{"id": u["id"], "name": u["name"], "email": None} for u in rest if u["id"] not in seen]

    return {"in_workspace": in_workspace, "external": external[:25]}
