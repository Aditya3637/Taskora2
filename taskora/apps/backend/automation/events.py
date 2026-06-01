"""Event emission. Best-effort — emitting an event must NEVER break the
caller (a user signing up, a webhook, a task write). If the table is missing
(migration 045 not yet applied) or the insert fails, we log and move on.
"""
import logging
from typing import Optional

from supabase import Client

logger = logging.getLogger(__name__)

# Canonical event types. Strings, not an enum, so emitting a new type never
# needs a migration — but keep the catalogue here so it's discoverable.
SIGNUP = "user_signed_up"
WORKSPACE_CREATED = "workspace_created"
FIRST_INITIATIVE = "first_initiative_created"
FIRST_TASK_DONE = "first_task_done"
INVITE_SENT = "invite_sent"
SEAT_ADDED = "seat_added"
SUBSCRIBED = "subscribed"
PAYMENT_SUCCEEDED = "payment_succeeded"
PAYMENT_FAILED = "payment_failed"
TRIAL_ENDING = "trial_ending"
TRIAL_EXPIRED = "trial_expired"


def emit(
    sb: Client,
    type: str,
    *,
    user_id: Optional[str] = None,
    business_id: Optional[str] = None,
    props: Optional[dict] = None,
) -> None:
    """Append one event. Swallows all errors by design."""
    try:
        sb.table("platform_events").insert({
            "type": type,
            "user_id": user_id,
            "business_id": business_id,
            "props": props or {},
        }).execute()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[events] emit %s failed: %s", type, e)
