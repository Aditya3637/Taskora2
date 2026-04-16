"""Firebase Cloud Messaging push notification helper."""
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_firebase_initialized = False


def _ensure_firebase(credentials_json: Optional[str]) -> bool:
    """Initialize Firebase app lazily. Returns True if available, False if not configured."""
    global _firebase_initialized
    if _firebase_initialized:
        return True
    if not credentials_json:
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials
        cred_dict = json.loads(credentials_json)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        _firebase_initialized = True
        return True
    except Exception as exc:
        logger.warning("Firebase init failed: %s", exc)
        return False


def send_push(token: str, title: str, body: str, data: dict = None) -> None:
    """Send a push notification to a device token. No-op if Firebase not configured."""
    from config import get_settings
    settings = get_settings()
    if not _ensure_firebase(settings.firebase_credentials_json):
        logger.debug("Firebase not configured — skipping push notification")
        return
    try:
        from firebase_admin import messaging
        msg = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            token=token,
        )
        messaging.send(msg)
    except Exception as exc:
        logger.warning("Push send failed: %s", exc)


def send_push_to_user(sb, user_id: str, title: str, body: str, data: dict = None) -> None:
    """Look up a user's FCM token and send a push. Accepts the supabase client to avoid circular imports."""
    user_rows = (
        sb.table("users")
        .select("settings")
        .eq("id", user_id)
        .execute()
        .data
    )
    if not user_rows:
        return
    token = (user_rows[0].get("settings") or {}).get("fcm_token")
    if token:
        send_push(token, title, body, data)
