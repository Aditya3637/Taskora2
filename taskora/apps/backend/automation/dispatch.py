"""Channel dispatch + the outbound-message log.

send() is the single choke point for every lifecycle comm. It:
  1. dedupes on dedupe_key (so campaigns are idempotent — "send once"),
  2. renders the template,
  3. routes to the channel (email real / push real / in-app logged /
     whatsapp stubbed — no provider wired yet),
  4. records a row in `messages` for admin visibility + attribution.

Never raises: a send failure is logged as status='failed', not an exception.
"""
import logging
from typing import Optional

from supabase import Client

from email_send import send_email
from notifications import send_push_to_user
from automation import templates

logger = logging.getLogger(__name__)


def _already_sent(sb: Client, dedupe_key: str) -> bool:
    if not dedupe_key:
        return False
    try:
        rows = sb.table("messages").select("id").eq("dedupe_key", dedupe_key).limit(1).execute().data
        return bool(rows)
    except Exception:
        return False


def _log(sb: Client, **row) -> None:
    try:
        sb.table("messages").insert(row).execute()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[dispatch] message log failed: %s", e)


def send(
    sb: Client,
    *,
    channel: str,
    template: str,
    ctx: dict,
    user: Optional[dict],
    business_id: Optional[str],
    dedupe_key: str,
    campaign: Optional[str] = None,
) -> dict:
    """Send one templated message on one channel. Returns the logged row's
    status: 'sent' | 'failed' | 'suppressed' | 'skipped'.

    `user` is the recipient dict ({id, email, phone, name}); for a workspace
    campaign this is the owner / billing contact.
    """
    if _already_sent(sb, dedupe_key):
        return {"status": "suppressed", "dedupe_key": dedupe_key}

    rendered = templates.render(template, ctx)
    user_id = (user or {}).get("id")
    status = "sent"
    meta: dict = {"subject": rendered["subject"]}

    try:
        if channel == "email":
            to = (user or {}).get("email")
            if not to:
                status, meta["reason"] = "skipped", "no email on file"
            else:
                ok = send_email(to=to, subject=rendered["subject"], html=rendered["html"], text=rendered["text"])
                status = "sent" if ok else "failed"
        elif channel == "push":
            if not user_id:
                status, meta["reason"] = "skipped", "no user"
            else:
                send_push_to_user(sb, user_id, rendered["subject"], rendered["text"])
                status = "sent"
        elif channel == "inapp":
            # No in-app inbox table yet — the messages row IS the record the
            # admin sees. (Extension point: surface these in a user bell.)
            status = "sent"
        elif channel == "whatsapp":
            # No WhatsApp provider wired (whatsapp.py only builds digest text).
            # Log intent so the admin can see demand; flip to 'sent' once a
            # provider (Gupshup/WATI/Twilio) is connected.
            status, meta["reason"] = "skipped", "whatsapp provider not configured"
        else:
            status, meta["reason"] = "failed", f"unknown channel {channel}"
    except Exception as e:  # never break the runner
        status, meta["error"] = "failed", str(e)[:300]
        logger.warning("[dispatch] %s/%s failed: %s", channel, template, e)

    _log(
        sb,
        user_id=user_id,
        business_id=business_id,
        channel=channel,
        template=template,
        campaign=campaign,
        status=status,
        dedupe_key=dedupe_key,
        meta=meta,
    )
    return {"status": status, "dedupe_key": dedupe_key}
