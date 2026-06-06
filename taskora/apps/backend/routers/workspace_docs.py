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
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from supabase import Client

from auth import get_current_user
from config import Settings, get_settings
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


def _writable(sb: Client, init: dict, user_id: str) -> bool:
    """True if the user may edit docs on this initiative (admin/owner, program
    lead, or initiative writer). Used to tell the editor whether to be editable
    — followers get read-only."""
    business_id = init["business_id"]
    if is_admin_or_owner(sb, business_id, user_id):
        return True
    if _is_program_lead(sb, init.get("program_id"), user_id):
        return True
    return init["id"] in writable_initiative_ids(sb, business_id, user_id)


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


# ── D3: mentions → entity_links (backlinks) ─────────────────────────────────
# Mention nodes in the TipTap body carry attrs.id = "<type>:<uuid>" (e.g.
# "initiative:abc"). We reconcile the doc's entity_links from the body on every
# save, so backlinks are always exactly what the document currently mentions —
# no fragile per-keystroke insert/delete tracking on the client.

_MENTION_TYPES = {"initiative", "task", "user"}


def _extract_mention_targets(body) -> set:
    """Walk the ProseMirror JSON and collect (target_type, target_id) from every
    mention node. Tolerant of any nesting / shape."""
    found: set = set()

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "mention":
                raw = (node.get("attrs") or {}).get("id") or ""
                if isinstance(raw, str) and ":" in raw:
                    t, _, i = raw.partition(":")
                    if t in _MENTION_TYPES and i:
                        found.add((t, i))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(body)
    return found


def _valid_targets(sb: Client, business_id: str, targets: set) -> set:
    """Keep only mention targets that actually belong to this workspace — a
    forged body can't create cross-tenant or bogus link rows."""
    inits = [i for (t, i) in targets if t == "initiative"]
    tasks = [i for (t, i) in targets if t == "task"]
    users = [i for (t, i) in targets if t == "user"]
    valid: set = set()
    if inits:
        rows = sb.table("initiatives").select("id").eq("business_id", business_id).in_("id", inits).execute().data
        valid |= {("initiative", r["id"]) for r in rows}
    if tasks:
        trows = sb.table("tasks").select("id, initiative_id").in_("id", tasks).execute().data
        init_ids = list({r["initiative_id"] for r in trows if r.get("initiative_id")})
        biz_inits = set()
        if init_ids:
            irows = sb.table("initiatives").select("id").eq("business_id", business_id).in_("id", init_ids).execute().data
            biz_inits = {r["id"] for r in irows}
        valid |= {("task", r["id"]) for r in trows if r.get("initiative_id") in biz_inits}
    if users:
        rows = sb.table("business_members").select("user_id").eq("business_id", business_id).in_("user_id", users).execute().data
        valid |= {("user", r["user_id"]) for r in rows}
    return valid


def _reconcile_doc_links(sb: Client, doc: dict, user_id: str) -> None:
    """Sync entity_links for a doc to the targets its body currently mentions.
    Best-effort: never breaks the save (entity_links may be absent pre-047)."""
    try:
        want = _valid_targets(sb, doc["business_id"], _extract_mention_targets(doc.get("body")))
        existing = (
            sb.table("entity_links").select("id, target_type, target_id")
            .eq("source_type", "doc").eq("source_id", doc["id"]).execute().data
        )
        have = {(l["target_type"], l["target_id"]): l["id"] for l in existing}
        for tt, ti in want - set(have):
            sb.table("entity_links").insert({
                "business_id": doc["business_id"], "source_type": "doc",
                "source_id": doc["id"], "target_type": tt, "target_id": ti,
                "created_by": user_id,
            }).execute()
        for key in set(have) - want:
            sb.table("entity_links").delete().eq("id", have[key]).execute()
    except Exception:
        pass


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
    if payload["body"]:
        _reconcile_doc_links(sb, rows[0], user["id"])
    return {**_shape(rows[0]), "can_write": True}  # the creator just passed the write gate


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
    return {**_shape(doc), "can_write": _writable(sb, init, user["id"])}


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
    if "body" in updates:
        _reconcile_doc_links(sb, rows[0], user["id"])
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


@router.get("/initiatives/{initiative_id}/backlinks")
def initiative_backlinks(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Docs (anywhere in the workspace) that @-mention this initiative. Read-
    gated by the initiative's visibility."""
    init = _initiative_or_404(sb, initiative_id)
    _gate(sb, init, user["id"], write=False)
    try:
        links = (
            sb.table("entity_links").select("source_id")
            .eq("target_type", "initiative").eq("target_id", initiative_id)
            .eq("source_type", "doc").execute().data
        )
    except Exception:
        links = []
    doc_ids = list({l["source_id"] for l in links})
    out: list = []
    if doc_ids:
        docs = sb.table("workspace_docs").select("id, title, parent_id, archived_at").in_("id", doc_ids).execute().data
        parent_ids = list({d["parent_id"] for d in docs if d.get("parent_id")})
        names: dict = {}
        if parent_ids:
            for r in sb.table("initiatives").select("id, name").in_("id", parent_ids).execute().data:
                names[r["id"]] = r["name"]
        for d in docs:
            if d.get("archived_at"):
                continue
            out.append({
                "doc_id": d["id"], "doc_title": d.get("title"),
                "initiative_id": d.get("parent_id"),
                "initiative_name": names.get(d.get("parent_id") or "", ""),
            })
    return {"backlinks": out}


@router.get("/mentions/search")
def mentions_search(
    business_id: str = Query(...),
    q: str = Query(default=""),
    limit: int = Query(default=8, ge=1, le=25),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Picker for the @ menu: initiatives + tasks + people the caller can see,
    matching `q`. Admins see all; members see only visible initiatives/tasks.
    Returns items as {type, id, label, sub} where id is the mention payload
    'type:uuid'."""
    uid = user["id"]
    require_member(sb, business_id, uid)
    ql = (q or "").strip().lower()

    init_rows = sb.table("initiatives").select("id, name").eq("business_id", business_id).execute().data
    if not is_admin_or_owner(sb, business_id, uid):
        vis = visible_initiative_ids(sb, business_id, uid)
        init_rows = [r for r in init_rows if r["id"] in vis]
    if ql:
        init_rows = [r for r in init_rows if ql in (r.get("name") or "").lower()]

    init_ids = [r["id"] for r in init_rows]
    task_rows: list = []
    if init_ids:
        task_rows = sb.table("tasks").select("id, title").in_("initiative_id", init_ids).execute().data
        if ql:
            task_rows = [t for t in task_rows if ql in (t.get("title") or "").lower()]

    member_ids = [m["user_id"] for m in
                  sb.table("business_members").select("user_id").eq("business_id", business_id).execute().data]
    people: list = []
    if member_ids:
        people = sb.table("users").select("id, name").in_("id", member_ids).execute().data
        if ql:
            people = [u for u in people if ql in (u.get("name") or "").lower()]

    results: list = []
    for r in init_rows[:limit]:
        results.append({"type": "initiative", "id": f"initiative:{r['id']}", "label": r.get("name") or "", "sub": "Initiative"})
    for t in task_rows[:limit]:
        results.append({"type": "task", "id": f"task:{t['id']}", "label": t.get("title") or "", "sub": "Task"})
    for u in people[:limit]:
        results.append({"type": "user", "id": f"user:{u['id']}", "label": u.get("name") or "", "sub": "Person"})
    return {"results": results}


# ── D5: doc-driven creation — promote a block/selection to a task ────────────

class PromoteIn(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("title is required")
        return v[:120]  # tasks.title CHECK is <= 120


@router.post("/initiatives/{initiative_id}/promote-task", status_code=201)
def promote_doc_block_to_task(
    initiative_id: str,
    body: PromoteIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Promote a line/selection from the initiative's work doc into a real task
    under that initiative. Gated by the doc WRITE set (anyone who can edit the
    doc can promote). The promoter becomes the task's primary stakeholder — they
    can reassign later. Mirrors the create_task insert (+ primary stakeholder
    row) so the task behaves like any other."""
    init = _initiative_or_404(sb, initiative_id)
    _gate(sb, init, user["id"], write=True)
    uid = user["id"]

    rows = sb.table("tasks").insert({
        "title": body.title,
        "initiative_id": initiative_id,
        "primary_stakeholder_id": uid,
        "created_by": uid,
        "priority": "medium",
        "status": "todo",
        "date_mode": "uniform",
        "entity_inheritance": "inherited",
    }).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create task")
    task = rows[0]
    sb.table("task_stakeholders").insert({
        "task_id": task["id"], "user_id": uid, "role": "primary",
    }).execute()
    return {
        "id": task["id"], "title": task["title"],
        "status": task["status"], "initiative_id": initiative_id,
    }


# ── D6 (§8): uploads & attachments ──────────────────────────────────────────
# Real files live in the private `workspace-docs` Storage bucket (migration
# 052), never in the doc body. The body references an attachment by id. Three
# guarantees make this tenant-safe:
#   1. The object PATH is generated server-side, tenant-prefixed
#      `{business_id}/{doc_id}/{uuid}-{filename}` — the client never picks it.
#   2. Recording an attachment re-checks the path sits under THIS doc's prefix,
#      so a forged body can't register an object from another tenant/doc.
#   3. Every download mints a short-lived SIGNED url only after re-checking the
#      doc's initiative visibility — the bucket is private, so a leaked path is
#      useless without a fresh signature and can never cross tenants.

# Allowlist (defence-in-depth alongside the bucket's allowed_mime_types).
# Executables and anything unlisted are rejected.
_IMAGE_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_ALLOWED_MIME = _IMAGE_MIME | {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   # .docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",          # .xlsx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # .pptx
    "text/csv",
    "text/plain",
}

_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
_DOWNLOAD_TTL = 3600  # 1h signed-download lifetime


def _safe_filename(name: Optional[str]) -> str:
    """Strip any directory part and reduce to a safe basename for the object
    key (the real filename is also stored verbatim in the row for display)."""
    base = (name or "file").replace("\\", "/").split("/")[-1].strip()
    base = _SAFE_FILENAME.sub("_", base).strip("._") or "file"
    return base[:120]


def _validate_upload(mime_type: str, size_bytes: Optional[int], max_bytes: int) -> None:
    if mime_type not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"File type '{mime_type}' is not allowed")
    if size_bytes is None or size_bytes <= 0:
        raise HTTPException(status_code=422, detail="size_bytes must be a positive integer")
    if size_bytes > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds the {max_bytes}-byte limit")


def _attachment_or_404(sb: Client, attachment_id: str) -> dict:
    """Load an attachment. Missing doc_attachments table (pre-052/047) → 404."""
    try:
        rows = sb.table("doc_attachments").select("*").eq("id", attachment_id).execute().data
    except Exception:
        rows = []
    if not rows:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return rows[0]


def _shape_attachment(a: dict) -> dict:
    return {
        "id": a["id"], "doc_id": a.get("doc_id"),
        "filename": a.get("filename"), "mime_type": a.get("mime_type"),
        "size_bytes": a.get("size_bytes"), "storage_path": a.get("storage_path"),
        "uploaded_by": a.get("uploaded_by"), "created_at": a.get("created_at"),
        "is_image": a.get("mime_type") in _IMAGE_MIME,
    }


class AttachmentSignIn(BaseModel):
    filename: str
    mime_type: str
    size_bytes: int

    @field_validator("filename", "mime_type")
    @classmethod
    def _nonblank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class AttachmentRecordIn(AttachmentSignIn):
    storage_path: str

    @field_validator("storage_path")
    @classmethod
    def _path_nonblank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("storage_path is required")
        return v


@router.post("/docs/{doc_id}/attachments/sign")
def sign_attachment_upload(
    doc_id: str,
    body: AttachmentSignIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings: Settings = Depends(get_settings),
):
    """Mint a short-lived signed UPLOAD url for a new attachment. Write-gated.
    The object path is generated here (tenant-prefixed) — the client uploads to
    exactly this path, then calls POST /attachments to record the row."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=True)
    _validate_upload(body.mime_type, body.size_bytes, settings.doc_upload_max_bytes)

    path = f"{doc['business_id']}/{doc_id}/{uuid4().hex}-{_safe_filename(body.filename)}"
    try:
        signed = sb.storage.from_(settings.workspace_docs_bucket).create_signed_upload_url(path)
    except Exception:
        raise HTTPException(status_code=503, detail="File storage is not available")
    return {
        "path": path,
        "token": signed.get("token"),
        "signed_url": signed.get("signed_url") or signed.get("signedURL"),
        "bucket": settings.workspace_docs_bucket,
        "max_bytes": settings.doc_upload_max_bytes,
    }


@router.post("/docs/{doc_id}/attachments", status_code=201)
def record_attachment(
    doc_id: str,
    body: AttachmentRecordIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings: Settings = Depends(get_settings),
):
    """Record a freshly-uploaded object as a doc_attachments row. Write-gated.
    Re-validates type/size and that the path sits under THIS doc's tenant prefix
    so a forged path can't register another tenant's or another doc's object."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=True)
    _validate_upload(body.mime_type, body.size_bytes, settings.doc_upload_max_bytes)

    prefix = f"{doc['business_id']}/{doc_id}/"
    if not body.storage_path.startswith(prefix) or ".." in body.storage_path:
        raise HTTPException(status_code=400, detail="storage_path is not within this document")

    rows = sb.table("doc_attachments").insert({
        "business_id": doc["business_id"], "doc_id": doc_id,
        "storage_path": body.storage_path, "filename": _safe_filename(body.filename),
        "mime_type": body.mime_type, "size_bytes": body.size_bytes,
        "uploaded_by": user["id"],
    }).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to record attachment")
    return _shape_attachment(rows[0])


@router.get("/docs/{doc_id}/attachments")
def list_attachments(
    doc_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List attachments on a doc, oldest first. Read-gated by doc visibility."""
    doc = _doc_or_404(sb, doc_id)
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=False)
    try:
        rows = (
            sb.table("doc_attachments").select("*")
            .eq("doc_id", doc_id).order("created_at", desc=False).execute().data
        )
    except Exception:
        rows = []
    return [_shape_attachment(r) for r in rows]


@router.get("/attachments/{attachment_id}/url")
def attachment_download_url(
    attachment_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings: Settings = Depends(get_settings),
):
    """Mint a short-lived signed DOWNLOAD url. Read-gated — re-checks the doc's
    initiative visibility on EVERY call, so a business-B user can never fetch a
    business-A attachment even with its id or object path."""
    att = _attachment_or_404(sb, attachment_id)
    doc = _doc_or_404(sb, att["doc_id"])
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=False)
    try:
        res = sb.storage.from_(settings.workspace_docs_bucket).create_signed_url(
            att["storage_path"], _DOWNLOAD_TTL
        )
    except Exception:
        raise HTTPException(status_code=503, detail="File storage is not available")
    url = res.get("signedURL") or res.get("signed_url") or res.get("signedUrl")
    return {
        "url": url, "filename": att.get("filename"),
        "mime_type": att.get("mime_type"), "size_bytes": att.get("size_bytes"),
        "is_image": att.get("mime_type") in _IMAGE_MIME, "expires_in": _DOWNLOAD_TTL,
    }


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(
    attachment_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings: Settings = Depends(get_settings),
):
    """Delete an attachment (row + Storage object). Write-gated. Removing the
    object is best-effort — the orphan sweep (automation engine) reclaims any
    object whose row is already gone."""
    att = _attachment_or_404(sb, attachment_id)
    doc = _doc_or_404(sb, att["doc_id"])
    init = _initiative_or_404(sb, doc["parent_id"])
    _gate(sb, init, user["id"], write=True)
    try:
        sb.storage.from_(settings.workspace_docs_bucket).remove([att["storage_path"]])
    except Exception:
        pass
    sb.table("doc_attachments").delete().eq("id", attachment_id).execute()
    return None
