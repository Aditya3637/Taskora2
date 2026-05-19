"""Transactional email via Resend.

send_email() never raises: a missing API key or a provider error is logged
and returns False, so callers (invite creation, trial nudges) keep working
even when email is unconfigured or Resend is down.
"""
import logging
from typing import Optional

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

_RESEND_ENDPOINT = "https://api.resend.com/emails"


def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
) -> bool:
    """Send one email. Returns True on accepted send, False otherwise."""
    settings = get_settings()
    api_key = settings.resend_api_key

    if not api_key:
        logger.info("[EMAIL:noop] to=%s subject=%r (RESEND_API_KEY unset)", to, subject)
        return False

    payload = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        resp = httpx.post(
            _RESEND_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10.0,
        )
        if resp.status_code >= 400:
            logger.error(
                "[EMAIL:fail] to=%s status=%s body=%s", to, resp.status_code, resp.text[:300]
            )
            return False
        logger.info("[EMAIL:sent] to=%s subject=%r", to, subject)
        return True
    except Exception as e:  # network/timeout — never break the caller
        logger.error("[EMAIL:error] to=%s err=%s", to, e)
        return False
