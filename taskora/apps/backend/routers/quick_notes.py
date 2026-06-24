"""Quick Capture — tiny per-user scratch cards.

Per-user, cross-workspace (no business_id): the same stack from any workspace.
"Move to page" appends the card's text into one of the user's Notebook pages
(TipTap `body_doc` when the page is on the new format, else the legacy `body`
blocks array) and deletes the card — capture → triage → cleared.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import Client

from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/quick-notes", tags=["quick_notes"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class NoteCreate(BaseModel):
    content: str = Field(default="", max_length=2000)


class NoteUpdate(BaseModel):
    content: str = Field(max_length=2000)


class MoveToPage(BaseModel):
    page_id: str


@router.get("")
def list_notes(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    return (
        sb.table("quick_notes")
        .select("id, content, position, created_at, updated_at")
        .eq("owner_id", user["id"])
        .order("position")
        .order("created_at")
        .execute()
        .data
    )


@router.post("", status_code=201)
def create_note(body: NoteCreate, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    rows = sb.table("quick_notes").insert({
        "owner_id": user["id"],
        "content": body.content,
        "position": 0,
    }).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create note")
    return rows[0]


@router.patch("/{note_id}")
def update_note(note_id: str, body: NoteUpdate, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    rows = (
        sb.table("quick_notes")
        .update({"content": body.content, "updated_at": _now()})
        .eq("id", note_id).eq("owner_id", user["id"]).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")
    return rows[0]


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    sb.table("quick_notes").delete().eq("id", note_id).eq("owner_id", user["id"]).execute()


@router.post("/{note_id}/move-to-page")
def move_to_page(note_id: str, body: MoveToPage, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    """Append the card's text to one of the caller's Notebook pages, then
    delete the card. Handles both the TipTap (`body_doc`) and legacy block
    (`body`) page formats."""
    uid = user["id"]
    note_rows = sb.table("quick_notes").select("content").eq("id", note_id).eq("owner_id", uid).execute().data
    if not note_rows:
        raise HTTPException(status_code=404, detail="Note not found")
    text = (note_rows[0].get("content") or "").strip()

    page_rows = (
        sb.table("notebook_pages").select("id, owner_id, format, body, body_doc")
        .eq("id", body.page_id).execute().data
    )
    if not page_rows or page_rows[0].get("owner_id") != uid:
        raise HTTPException(status_code=404, detail="Page not found")
    page = page_rows[0]

    if text:
        fmt = page.get("format")
        if fmt == "pm" or page.get("body_doc"):
            doc = page.get("body_doc") or {"type": "doc", "content": []}
            content = doc.get("content") or []
            content.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})
            doc["content"] = content
            sb.table("notebook_pages").update(
                {"body_doc": doc, "format": "pm", "updated_at": _now()}
            ).eq("id", body.page_id).execute()
        else:
            blocks = page.get("body") or []
            blocks.append({"id": str(uuid4()), "type": "text", "text": text})
            sb.table("notebook_pages").update(
                {"body": blocks, "updated_at": _now()}
            ).eq("id", body.page_id).execute()

    sb.table("quick_notes").delete().eq("id", note_id).eq("owner_id", uid).execute()
    return {"ok": True, "page_id": body.page_id}
