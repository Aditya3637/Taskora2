"""In-app + push notification fan-out.

`notify()` is the single entry point routers call after a notable write
(assigned / approval / mention / blocked / comment / decision) and the cron
scan calls for due/overdue. It:
  1. records a `platform_events` row (analytics / source of truth),
  2. honours each recipient's per-type routing prefs (users.settings.notify_prefs),
  3. writes one `messages` row per recipient with channel='inapp' — these rows
     ARE the bell feed (see dispatch.send's 'inapp' extension point),
  4. best-effort push via the existing Firebase helper for high-signal types.

Recipients are passed in by the caller (which already knows who's involved);
the actor is excluded and duplicates collapsed here. An optional `dedupe_key`
makes repeated scans idempotent (per-recipient unique key). Never raises — a
notify failure must never break the underlying write.
"""
import logging
from typing import Iterable, Optional

from supabase import Client

from notifications import send_push_to_user

logger = logging.getLogger(__name__)

# Types that default to a push as well as in-app. Overridable per-call + per-user.
_PUSH_TYPES = {
    "assigned", "approval_requested", "approval_resolved",
    "decision_resolved", "blocked",
}


def _record_event(sb: Client, *, type: str, business_id: Optional[str],
                  actor_id: Optional[str], entity_type: Optional[str],
                  entity_id: Optional[str], props: Optional[dict]) -> None:
    try:
        sb.table("platform_events").insert({
            "type": f"notify.{type}",
            "business_id": business_id,
            "user_id": actor_id,
            "props": {"entity_type": entity_type, "entity_id": entity_id, **(props or {})},
        }).execute()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[notify] event log failed: %s", e)


def _prefs_for(sb: Client, user_ids: list[str]) -> dict:
    """Map user_id -> notify_prefs dict (from users.settings). Empty on failure."""
    try:
        rows = sb.table("users").select("id, settings").in_("id", user_ids).execute().data
        return {r["id"]: ((r.get("settings") or {}).get("notify_prefs") or {}) for r in rows}
    except Exception:
        return {}


def _channel_on(prefs: dict, type: str, channel: str) -> bool:
    """A channel is on unless the user explicitly turned it off for this type."""
    p = (prefs or {}).get(type)
    if not isinstance(p, dict):
        return True
    return bool(p.get(channel, True))


def notify(
    sb: Client,
    *,
    type: str,
    business_id: Optional[str],
    actor_id: Optional[str],
    recipients: Iterable[str],
    title: str,
    body: str = "",
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    props: Optional[dict] = None,
    push: Optional[bool] = None,
    dedupe_key: Optional[str] = None,
) -> None:
    """Fan out a notification.

    recipients   iterable of user_ids; the actor is removed and dupes collapsed.
    type         short slug, also stored as messages.template (e.g. 'assigned').
    entity_*     deep-link target the bell row routes to on click.
    push         force-enable/disable push; defaults to (type in _PUSH_TYPES).
    dedupe_key   if set, makes the send idempotent — each recipient gets a unique
                 key f"{dedupe_key}:{uid}" and is skipped if already sent.
    """
    try:
        _record_event(sb, type=type, business_id=business_id, actor_id=actor_id,
                      entity_type=entity_type, entity_id=entity_id, props=props)
        targets = {r for r in (recipients or []) if r and r != actor_id}
        if not targets:
            return

        prefs = _prefs_for(sb, list(targets))

        # Idempotency: drop recipients already notified under this dedupe_key.
        keys: dict[str, str] = {}
        if dedupe_key:
            keys = {uid: f"{dedupe_key}:{uid}" for uid in targets}
            try:
                sent = (
                    sb.table("messages").select("dedupe_key")
                    .in_("dedupe_key", list(keys.values())).execute().data
                )
                already = {r["dedupe_key"] for r in sent}
                targets = {uid for uid in targets if keys[uid] not in already}
            except Exception:
                pass
            if not targets:
                return

        meta = {
            "title": title, "body": body,
            "entity_type": entity_type, "entity_id": entity_id,
            "actor_id": actor_id, **(props or {}),
        }
        inapp_targets = [uid for uid in targets if _channel_on(prefs.get(uid), type, "inapp")]
        rows = []
        for uid in inapp_targets:
            row = {
                "user_id": uid, "business_id": business_id, "channel": "inapp",
                "template": type, "status": "sent", "meta": meta,
            }
            if dedupe_key:
                row["dedupe_key"] = keys[uid]
            rows.append(row)
        if rows:
            try:
                sb.table("messages").insert(rows).execute()
            except Exception as e:
                logger.warning("[notify] inapp insert failed: %s", e)

        want_push_default = push if push is not None else (type in _PUSH_TYPES)
        if want_push_default:
            for uid in targets:
                if not _channel_on(prefs.get(uid), type, "push"):
                    continue
                try:
                    send_push_to_user(
                        sb, uid, title, body or title,
                        data={"entity_type": entity_type or "", "entity_id": entity_id or ""},
                    )
                except Exception:  # pragma: no cover - per-recipient best effort
                    pass
    except Exception as e:  # pragma: no cover - absolute safety net
        logger.warning("[notify] failed (%s): %s", type, e)
