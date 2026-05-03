"""WhatsApp digest generation — formats task summaries as WhatsApp-ready messages."""
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/whatsapp", tags=["whatsapp"])


class DigestRequest(BaseModel):
    business_id: str
    stakeholder_user_id: Optional[str] = None  # None = all primary stakeholders


def _format_date(d: Optional[str]) -> str:
    if not d:
        return "—"
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").strftime("%-d %b %Y")
    except Exception:
        return d[:10]


def _build_message(user_name: str, overdue: list, pending: list, blocked: list, due_week: list) -> str:
    today = datetime.now(timezone.utc).strftime("%-d %b %Y")
    lines = [
        f"📋 *Taskora Update — {user_name}*",
        f"Date: {today}",
        "",
    ]

    lines.append(f"🔴 *OVERDUE ({len(overdue)})*")
    if overdue:
        for t in overdue:
            init_title = (t.get("initiatives") or {}).get("name") or (t.get("initiatives") or {}).get("title") or "—"
            lines.append(f"• {t['title']} — {init_title} — Due: {_format_date(t.get('due_date'))}")
    else:
        lines.append("• None")
    lines.append("")

    lines.append(f"⏳ *PENDING DECISION ({len(pending)})*")
    if pending:
        for t in pending:
            init_title = (t.get("initiatives") or {}).get("name") or (t.get("initiatives") or {}).get("title") or "—"
            lines.append(f"• {t['title']} — {init_title}")
    else:
        lines.append("• None")
    lines.append("")

    lines.append(f"🚫 *BLOCKED ({len(blocked)})*")
    if blocked:
        for t in blocked:
            reason = t.get("blocker_reason") or ""
            suffix = f" — {reason}" if reason else ""
            lines.append(f"• {t['title']}{suffix}")
    else:
        lines.append("• None")
    lines.append("")

    lines.append(f"📅 *DUE THIS WEEK ({len(due_week)})*")
    if due_week:
        for t in due_week:
            lines.append(f"• {t['title']} — Due: {_format_date(t.get('due_date'))}")
    else:
        lines.append("• None")

    return "\n".join(lines)


def _tasks_for_user(sb: Client, uid: str, business_id: str) -> dict:
    """Fetch categorised tasks for a user within a business."""
    today = date.today()
    week_end = date.fromordinal(today.toordinal() + (6 - today.weekday()))

    # Primary task IDs
    primary_ids = [
        r["id"] for r in sb.table("tasks").select("id")
        .eq("primary_stakeholder_id", uid).execute().data
    ]
    # Secondary task IDs
    secondary_ids = [
        r["task_id"] for r in sb.table("task_stakeholders").select("task_id")
        .eq("user_id", uid).execute().data
    ]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return {"overdue": [], "pending": [], "blocked": [], "due_week": []}

    # Fetch tasks with initiative join
    tasks = (
        sb.table("tasks")
        .select("id, title, status, due_date, blocker_reason, initiatives(name, title)")
        .in_("id", all_ids)
        .execute()
        .data
    )

    today_str = today.isoformat()
    week_end_str = week_end.isoformat()

    overdue, pending, blocked, due_week = [], [], [], []
    for t in tasks:
        s = t.get("status", "")
        due = t.get("due_date")
        if s == "done":
            continue
        if due and due < today_str and s != "done":
            overdue.append(t)
        elif s == "pending_decision":
            pending.append(t)
        elif s == "blocked":
            blocked.append(t)
        elif due and today_str <= due <= week_end_str:
            due_week.append(t)

    return {"overdue": overdue, "pending": pending, "blocked": blocked, "due_week": due_week}


@router.post("/digest")
def generate_digest(
    body: DigestRequest,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, body.business_id, user["id"])

    # Determine which users to generate for
    if body.stakeholder_user_id:
        user_ids = [body.stakeholder_user_id]
    else:
        # All members of the business
        member_rows = (
            sb.table("business_members")
            .select("user_id")
            .eq("business_id", body.business_id)
            .execute()
            .data
        )
        user_ids = [r["user_id"] for r in member_rows]

    if not user_ids:
        return {"messages": []}

    # Fetch user details
    user_rows = (
        sb.table("users")
        .select("id, email, settings")
        .in_("id", user_ids)
        .execute()
        .data
    )
    user_map = {u["id"]: u for u in user_rows}

    messages = []
    for uid in user_ids:
        u = user_map.get(uid)
        if not u:
            continue
        user_name = (u.get("settings") or {}).get("full_name") or u.get("email") or uid
        phone = (u.get("settings") or {}).get("phone")
        cats = _tasks_for_user(sb, uid, body.business_id)
        text = _build_message(
            user_name,
            cats["overdue"],
            cats["pending"],
            cats["blocked"],
            cats["due_week"],
        )
        wa_link = f"https://wa.me/?text={quote(text)}"
        if phone:
            clean_phone = "".join(c for c in phone if c.isdigit() or c == "+")
            wa_link = f"https://wa.me/{clean_phone}?text={quote(text)}"

        messages.append({
            "user_id": uid,
            "user_name": user_name,
            "phone_number": phone,
            "message": text,
            "wa_link": wa_link,
        })

    return {"messages": messages}
