"""
Trial nudge email sequence.
Run as daily cron: python -m tasks.trial_nudges
"""
import logging
import sys
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

NUDGE_SCHEDULE: dict[int, tuple[str, str]] = {
    1: (
        "Your War Room is waiting",
        "You signed up for Taskora — your War Room is ready. Log in and make your first decision in 60 seconds.",
    ),
    3: (
        "Create your first initiative in 60 seconds",
        "Your initiative rollout is one step away. Try it now →",
    ),
    7: (
        "Your first week with Taskora",
        "See what decisions you've moved this week.",
    ),
    14: (
        "2 weeks in! Here's what your team accomplished",
        "Check your Analytics tab for your decision velocity.",
    ),
    30: (
        "30 days left on your trial",
        "You have 30 days left. Explore Pro plan benefits.",
    ),
    45: (
        "Trial ends in 15 days",
        "Add your payment method to keep your War Room.",
    ),
    53: (
        "7 days left",
        "Don't lose your War Room. Upgrade now.",
    ),
    58: (
        "Trial ends in 2 days",
        "Your data is at risk. Upgrade before it expires.",
    ),
}


def _send_email(to_email: str, subject: str, body: str) -> None:
    """Send an email via the configured provider. Logs only — plug in SendGrid/Resend/SES here."""
    logger.info("[EMAIL] to=%s subject=%r", to_email, subject)
    # TODO: replace with actual email provider call
    print(f"[EMAIL] To: {to_email} | Subject: {subject}")
    print(f"        {body[:120]}")


def send_trial_nudges() -> None:
    """Query trialing subscriptions and dispatch nudge emails for today's day offset."""
    from config import get_settings
    from supabase import create_client

    settings = get_settings()
    sb = create_client(settings.supabase_url, settings.supabase_service_key)

    now = datetime.now(timezone.utc)

    # Fetch trialing subs with nested business → user email
    subs = (
        sb.table("subscriptions")
        .select("id, trial_start, business_id, businesses(owner_id)")
        .eq("status", "trialing")
        .execute()
        .data
    )

    for sub in subs:
        trial_start_raw = sub.get("trial_start")
        if not trial_start_raw:
            continue
        trial_start = datetime.fromisoformat(trial_start_raw)
        days_elapsed = (now - trial_start).days
        if days_elapsed not in NUDGE_SCHEDULE:
            continue

        owner_id = (sub.get("businesses") or {}).get("owner_id")
        if not owner_id:
            continue

        # Fetch user email separately to avoid deep nested select quirks
        user_rows = sb.table("users").select("email, name").eq("id", owner_id).execute().data
        if not user_rows:
            continue
        email = user_rows[0].get("email", "")
        name = user_rows[0].get("name", "there")
        if not email:
            continue

        subject, body = NUDGE_SCHEDULE[days_elapsed]
        _send_email(email, subject, f"Hi {name},\n\n{body}")

    logger.info("Trial nudge run complete. Processed %d subscriptions.", len(subs))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    send_trial_nudges()
