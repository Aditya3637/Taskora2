"""Workspace Documents engine (D0).

The shared, initiative-level work-document CRUD. Visibility is inherited from
the initiative cascade (deps.py) — there is NO per-doc sharing model:

  - READ a doc  = admin/owner, the program lead, or the initiative is visible to
                  the caller (visible_initiative_ids).
  - WRITE a doc = admin/owner, the program lead, or the caller has write access
                  to the initiative (writable_initiative_ids — primary
                  stakeholder, task stakeholder, task creator). Per the plan,
                  contributors can co-author; followers/clients are read-only.

The body is opaque ProseMirror/TipTap JSON — this engine just stores and gates
it; the editor (TipTap) is the next slice (D2). Reads degrade gracefully if the
047 migration hasn't been applied yet (returns empty / 404 rather than 500),
matching the best-effort pattern used elsewhere (program_outcome_pct).
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from supabase import Client

from auth import get_current_user
from deps import (
    get_supabase, require_member, is_admin_or_owner,
    visible_initiative_ids, writable_initiative_ids,
)

router = APIRouter(prefix="/api/v1", tags=["workspace_docs"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── models ─────────────────────────────────────────────────────────────────

class DocCreate(BaseModel):
    title: Optional[str] = None
    body: Optional[dict] = None

    @field_validator("title")
    @classmethod
    def title_len(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        return (v or "Work document")[:200]


class DocUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[dict] = None

    @field_validator("title")
    @classmethod
    def title_len(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("title cannot be empty")
        return v[:200]


class ArchiveIn(BaseModel):
    archived: bool = True


# ── helpers ────────────────────────────────────────────────────────────────

def _initiative_or_404(sb: Client, initiative_id: str) -> dict:
    rows = (
        sb.table("initiatives")
        .select("id, business_id, program_id")
        .eq("id", initiative_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Initiative not found")
    return rows[0]


def _is_program_lead(sb: Client, program_id: Optional[str], user_id: str) -> bool:
    if not program_id:
        return False
    rows = sb.table("programs").select("lead_user_id").eq("id", program_id).execute().data
    return bool(rows and rows[0].get("lead_user_id") == user_id)


def _gate(sb: Client, init: dict, user_id: str, *, write: bool) -> None:
    """Enforce read/write access to an initiative's docs. Non-members 403 via
    require_member; members who can't see the initiative get 404 on read (don't
    leak existence) and 403 on write."""
    business_id = init["business_id"]
    require_member(sb, business_id, user_id)
    if is_admin_or_owner(sb, business_id, user_id):
        return
    if _is_program_lead(sb, init.get("program_id"), user_id):
        return
    ids = (
        writable_initiative_ids(sb, business_id, user_id) if write
        else visible_initiative_ids(sb, business_id, user_id)
    )
    if init["id"] in ids:
        return
    if write:
        raise HTTPException(status_code=403, detail="You don't have write access to this initiative's docs")
    raise HTTPException(status_code=404, detail="Initiative not found")


def _doc_or_404(sb: Client, doc_id: str) -> dict:
    """Load a doc. Treats a missing workspace_docs table (047 not yet applied)
    as 'not found' rather than 500."""
    try:
        rows = sb.table("workspace_docs").select("*").eq("id", doc_id).execute().data
    except Exception:
        rows = []
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    return rows[0]


def _shape(d: dict) -> dict:
    """The public doc shape (drop nothing sensitive — these are all app fields)."""
    return {
        "id": d["id"], "business_id": d.get("business_id"),
        "parent_type": d.get("parent_type"), "parent_id": d.get("parent_id"),
        "title": d.get("title"), "body": d.get("body") or {},
        "created_by": d.get("created_by"),
        "created_at": d.get("created_at"), "updated_at": d.get("updated_at"),
        "archived_at": d.get("archived_at"),
    }


# ── routes ─────────────────────────────────────────────────────────────────

@router.get("/initiatives/{initiative_id}/docs")
def list_docs(
    initiative_id: str,
    include_archived: bool = False,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Docs attached to an initiative, newest first. Read-gated."""
    init = _initiative_or_404(sb, initiative_id)
    _gate(sb, init, user["id"], write=False)
    try:
        rows = (
            sb.table("workspace_docs")
            .select("*")
            .eq("parent_type", "initiative")
            .eq("parent_id", initiative_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )
    except Exception:
        rows = []  # 047 not applied yet
    if not include_archived:
        rows = [r for r in rows if not r.get("archived_at")]
    return [_shape(r) for r in rows]


@router.post("/initiatives/{initiative_id}/docs", status_code=201)
def create_doc(
    initiative_id: str,
    body: DocCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create a work doc on an initiative. Write-gated."""
    init = _initiative_or_404(sb, initiative_id)
    _gate(sb, init, user["id"], write=True)
    payload = {
        "business_id": init["business_id"],
        "parent_type": "initiative",
        "parent_id": initiative_id,
        "title": body.title or "Work document",
        "body": body.body or {},
        "created_by": user["id"],
        "updated_at": _now(),
    }
    rows = sb.table("workspace_docs").insert(payload).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create document")
    return _shape(rows[0])


@router.get("/docs/{doc_id}")
def get_doc(
    doc_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Read one doc. Gated by the doc's initiative visibility."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=False)
    return _shape(doc)


@router.patch("/docs/{doc_id}")
def update_doc(
    doc_id: str,
    body: DocUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Autosave: update title and/or body. Write-gated."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=True)

    sent = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in sent.items() if v is not None}
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    updates["updated_at"] = _now()
    rows = (
        sb.table("workspace_docs").update(updates)
        .eq("id", doc_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    return _shape(rows[0])


@router.post("/docs/{doc_id}/archive")
def archive_doc(
    doc_id: str,
    body: ArchiveIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Soft-delete (archived=true) or restore (archived=false). Write-gated."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=True)
    rows = (
        sb.table("workspace_docs")
        .update({"archived_at": _now() if body.archived else None, "updated_at": _now()})
        .eq("id", doc_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    return _shape(rows[0])
