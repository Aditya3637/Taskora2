from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member, require_admin_or_owner
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses/{business_id}", tags=["entities"])


class EntityCreate(BaseModel):
    name: str
    address: Optional[str] = None
    contact_info: Optional[dict] = None
    code: Optional[str] = None


@router.post("/buildings", status_code=201)
def add_building(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    result = sb.table("buildings").insert({
        "name": body.name,
        "address": body.address,
        "business_id": business_id,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create building")
    return result.data[0]


@router.get("/buildings")
def list_buildings(
    business_id: str,
    btype: Optional[str] = Query(default=None, description="Filter by building type"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    query = (
        sb.table("buildings")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
    )
    if btype is not None:
        query = query.eq("btype", btype)
    return query.execute().data


@router.post("/clients", status_code=201)
def add_client(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    payload: dict = {"name": body.name, "contact_info": body.contact_info or {}, "business_id": business_id}
    if body.code:
        payload["code"] = body.code
    result = sb.table("clients").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create client")
    return result.data[0]


@router.get("/clients")
def list_clients(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    return (
        sb.table("clients")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .execute()
        .data
    )


@router.get("/sites")
def get_sites(
    business_id: str,
    kind: str = Query(default="building", description="building | client"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Cross-cutting Sites view: each building/client with a rollup of the work
    happening at it across ALL programmes — #initiatives/#tasks, next deadline,
    overdue/blocked health. Aggregates task_entities (per-building work)."""
    require_member(sb, business_id, user["id"])
    if kind not in ("building", "client"):
        raise HTTPException(status_code=422, detail="kind must be 'building' or 'client'")
    today = date.today().isoformat()

    tbl = "buildings" if kind == "building" else "clients"
    ent_rows = sb.table(tbl).select("*").eq("business_id", business_id).execute().data
    entities = {e["id"]: e for e in ent_rows}
    if not entities:
        return []

    init_ids = [r["id"] for r in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data]
    task_meta: dict = {}
    if init_ids:
        for t in sb.table("tasks").select("id, initiative_id, due_date").in_("initiative_id", init_ids).execute().data:
            task_meta[t["id"]] = t
    task_ids = list(task_meta.keys())

    links: list = []
    if task_ids:
        links = (
            sb.table("task_entities")
            .select("task_id, entity_id, per_entity_status, per_entity_end_date")
            .in_("task_id", task_ids).eq("entity_type", kind).execute().data
        )

    agg = {eid: {"tasks": 0, "open": 0, "overdue": 0, "blocked": 0,
                 "initiatives": set(), "next_deadline": None} for eid in entities}
    for l in links:
        a = agg.get(l["entity_id"])
        if a is None:
            continue
        tm = task_meta.get(l["task_id"]) or {}
        a["tasks"] += 1
        if tm.get("initiative_id"):
            a["initiatives"].add(tm["initiative_id"])
        st = l.get("per_entity_status")
        deadline = l.get("per_entity_end_date") or tm.get("due_date")
        if st != "done":
            a["open"] += 1
            if deadline and deadline < today:
                a["overdue"] += 1
            if deadline and (a["next_deadline"] is None or deadline < a["next_deadline"]):
                a["next_deadline"] = deadline
        if st == "blocked":
            a["blocked"] += 1

    out = []
    for eid, e in entities.items():
        a = agg[eid]
        health = "bad" if a["overdue"] > 0 else ("warn" if a["blocked"] > 0 else "ok")
        out.append({
            "id": eid, "name": e.get("name") or "", "kind": kind,
            "zone": e.get("zone"), "city": e.get("city"), "code": e.get("code"),
            "tasks": a["tasks"], "initiatives": len(a["initiatives"]),
            "open": a["open"], "overdue": a["overdue"], "blocked": a["blocked"],
            "next_deadline": a["next_deadline"], "health": health,
        })
    health_rank = {"bad": 0, "warn": 1, "ok": 2}
    out.sort(key=lambda r: (health_rank.get(r["health"], 3), r["next_deadline"] or "9999-99-99"))
    return out


@router.get("/my-sites")
def my_sites(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """The caller's per-building/client work — powers the mobile field-update
    view. Includes entities on tasks the caller is primary on, plus entities
    the caller owns (task_entities.owner_id, mig 063)."""
    require_member(sb, business_id, user["id"])
    uid = user["id"]
    init_ids = [r["id"] for r in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data]
    if not init_ids:
        return []
    biz_task_ids = {
        r["id"] for r in sb.table("tasks").select("id").in_("initiative_id", init_ids).execute().data
    }
    my_task_ids = [
        r["id"] for r in sb.table("tasks").select("id")
        .eq("primary_stakeholder_id", uid).in_("initiative_id", init_ids).execute().data
    ]

    cols = "task_id, entity_id, entity_type, per_entity_status, per_entity_end_date, owner_id"
    rows: list = []
    if my_task_ids:
        rows += sb.table("task_entities").select(cols).in_("task_id", my_task_ids).execute().data
    rows += sb.table("task_entities").select(cols).eq("owner_id", uid).execute().data

    seen: set = set()
    merged: list = []
    for r in rows:
        if r["task_id"] not in biz_task_ids:
            continue
        k = (r["task_id"], r["entity_id"])
        if k in seen:
            continue
        seen.add(k)
        merged.append(r)
    if not merged:
        return []

    t_ids = list({r["task_id"] for r in merged})
    tmap = {t["id"]: t for t in sb.table("tasks").select("id, title, due_date").in_("id", t_ids).execute().data}
    b_ids = [r["entity_id"] for r in merged if r["entity_type"] == "building"]
    c_ids = [r["entity_id"] for r in merged if r["entity_type"] == "client"]
    names: dict = {}
    if b_ids:
        for b in sb.table("buildings").select("id, name").in_("id", b_ids).execute().data:
            names[b["id"]] = b.get("name") or ""
    if c_ids:
        for cl in sb.table("clients").select("id, name").in_("id", c_ids).execute().data:
            names[cl["id"]] = cl.get("name") or ""

    out = []
    for r in merged:
        t = tmap.get(r["task_id"], {})
        out.append({
            "task_id": r["task_id"], "task_title": t.get("title") or "",
            "entity_id": r["entity_id"], "entity_type": r["entity_type"],
            "entity_name": names.get(r["entity_id"]) or "",
            "status": r.get("per_entity_status"),
            "due": r.get("per_entity_end_date") or t.get("due_date"),
        })
    rank = {"blocked": 0, "pending_decision": 1, "in_progress": 2, "todo": 3, "backlog": 4, "done": 9}
    out.sort(key=lambda x: (rank.get(x["status"], 5), x["due"] or "9999-99-99"))
    return out


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


@router.patch("/clients/{client_id}")
def update_client(
    business_id: str,
    client_id: str,
    body: ClientUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Partial update of a client. Admin/owner only — members are read-only."""
    require_admin_or_owner(sb, business_id, user["id"])

    rows = (
        sb.table("clients")
        .select("contact_info")
        .eq("id", client_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Client not found")

    payload: dict = {}
    if body.name is not None:
        payload["name"] = body.name.strip()
    if body.code is not None:
        payload["code"] = body.code.strip() or None

    # contact_info is a JSONB blob; merge email/phone into the existing dict
    # so a partial update doesn't wipe the other field.
    if body.contact_email is not None or body.contact_phone is not None:
        existing_contact = (rows[0].get("contact_info") or {}) if isinstance(rows[0].get("contact_info"), dict) else {}
        contact = dict(existing_contact)
        if body.contact_email is not None:
            email = body.contact_email.strip()
            if email:
                contact["email"] = email
            else:
                contact.pop("email", None)
        if body.contact_phone is not None:
            phone = body.contact_phone.strip()
            if phone:
                contact["phone"] = phone
            else:
                contact.pop("phone", None)
        payload["contact_info"] = contact

    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = sb.table("clients").update(payload).eq("id", client_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/clients/{client_id}", status_code=204)
def delete_client(
    business_id: str,
    client_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_admin_or_owner(sb, business_id, user["id"])
    existing = (
        sb.table("clients")
        .select("id")
        .eq("id", client_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    sb.table("clients").update({"is_active": False}).eq("id", client_id).execute()


# ---------------------------------------------------------------------------
# Building detail & update endpoints
# ---------------------------------------------------------------------------

class BuildingUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    serial_number: Optional[str] = None
    city: Optional[str] = None
    code: Optional[str] = None
    zone: Optional[str] = None
    area: Optional[str] = None
    btype: Optional[str] = None
    soft_handover_date: Optional[date] = None
    hard_handover_date: Optional[date] = None
    completion_pct: Optional[float] = None


@router.get("/buildings/{building_id}")
def get_building(
    business_id: str,
    building_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return full building details including rich metadata fields."""
    require_member(sb, business_id, user["id"])
    rows = (
        sb.table("buildings")
        .select("*")
        .eq("id", building_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Building not found")
    return rows[0]


@router.patch("/buildings/{building_id}")
def update_building(
    business_id: str,
    building_id: str,
    body: BuildingUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Partial update of building rich metadata. Admin/owner only."""
    require_admin_or_owner(sb, business_id, user["id"])

    # Verify building belongs to business
    existing = (
        sb.table("buildings")
        .select("id")
        .eq("id", building_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Building not found")

    payload = {}
    raw = body.model_dump()
    for field, value in raw.items():
        if value is not None:
            if isinstance(value, date):
                payload[field] = value.isoformat()
            else:
                payload[field] = value

    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = sb.table("buildings").update(payload).eq("id", building_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/buildings/{building_id}", status_code=204)
def delete_building(
    business_id: str,
    building_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_admin_or_owner(sb, business_id, user["id"])
    existing = (
        sb.table("buildings")
        .select("id")
        .eq("id", building_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Building not found")
    sb.table("buildings").update({"is_active": False}).eq("id", building_id).execute()


# Bulk import ────────────────────────────────────────────────────────────────

class BulkBuildingItem(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    code: Optional[str] = None
    zone: Optional[str] = None
    area: Optional[str] = None
    serial_number: Optional[str] = None
    btype: Optional[str] = None
    soft_handover_date: Optional[str] = None
    hard_handover_date: Optional[str] = None
    completion_pct: Optional[float] = None


class BulkClientItem(BaseModel):
    name: str
    code: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


class BulkBuildingsBody(BaseModel):
    items: list[BulkBuildingItem]


class BulkClientsBody(BaseModel):
    items: list[BulkClientItem]


@router.post("/buildings/bulk", status_code=201)
def bulk_add_buildings(
    business_id: str,
    body: BulkBuildingsBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    rows = []
    for item in body.items:
        if not item.name.strip():
            continue
        row: dict = {"name": item.name.strip(), "business_id": business_id}
        for field in ("address", "city", "code", "zone", "area", "serial_number", "btype",
                      "soft_handover_date", "hard_handover_date"):
            val = getattr(item, field)
            if val is not None and str(val).strip():
                row[field] = str(val).strip()
        if item.completion_pct is not None:
            row["completion_pct"] = item.completion_pct
        rows.append(row)
    if not rows:
        raise HTTPException(status_code=422, detail="No valid items provided")
    if len(rows) > 500:
        raise HTTPException(status_code=422, detail="Maximum 500 items per import")
    # DB constraint/RLS failures propagate to the global APIError handler
    # (main.py), which maps them to a clean 4xx without leaking internals.
    result = sb.table("buildings").insert(rows).execute()
    return {"inserted": len(result.data or [])}


@router.post("/clients/bulk", status_code=201)
def bulk_add_clients(
    business_id: str,
    body: BulkClientsBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    rows = []
    for item in body.items:
        if not item.name.strip():
            continue
        contact: dict = {}
        if item.contact_email:
            contact["email"] = item.contact_email
        if item.contact_phone:
            contact["phone"] = item.contact_phone
        row: dict = {"name": item.name.strip(), "contact_info": contact, "business_id": business_id}
        if item.code and item.code.strip():
            row["code"] = item.code.strip()
        rows.append(row)
    if not rows:
        raise HTTPException(status_code=422, detail="No valid items provided")
    if len(rows) > 500:
        raise HTTPException(status_code=422, detail="Maximum 500 items per import")
    # See bulk_add_buildings — global APIError handler owns DB-error mapping.
    result = sb.table("clients").insert(rows).execute()
    return {"inserted": len(result.data or [])}
