-- 059_notification_indexes.sql
-- Notification Center reuses `messages` (channel='inapp') as the bell feed
-- store (see automation/notify.py + routers/notifications.py). These two
-- partial indexes keep the per-recipient feed query and the unread-badge
-- count fast as the messages table grows. Additive + idempotent — safe to
-- apply before the new backend ships.

CREATE INDEX IF NOT EXISTS messages_inapp_feed_idx
  ON public.messages (user_id, business_id, ts DESC)
  WHERE channel = 'inapp';

CREATE INDEX IF NOT EXISTS messages_inapp_unread_idx
  ON public.messages (user_id, business_id)
  WHERE channel = 'inapp' AND opened_at IS NULL;
