-- 054_webhook_idempotency.sql
-- Replay/idempotency guard for inbound payment-provider webhooks (Razorpay).
--
-- The webhook signature proves a payload was minted by the provider, but a
-- *validly-signed* event can be replayed indefinitely (captured-and-resent, or
-- duplicate/out-of-order delivery). Without a dedup gate a replayed
-- `subscription.activated` could revive a cancelled subscription, and a
-- replayed `subscription.charged` could keep pushing `current_period_end`
-- forward — a free, unpaid subscription extension. This table records each
-- event exactly once; the handler refuses to re-apply an event it has seen.
--
-- Backend-only: RLS enabled with NO policies, so only the service-role client
-- the backend uses can touch it (anon/authenticated never can). Same pattern as
-- 046/047/048/049.
create table if not exists public.processed_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null default 'razorpay',
  event_id    text not null,                 -- provider event id, or sha256(body) fallback
  event_type  text,                          -- e.g. subscription.charged (for auditing)
  received_at timestamptz not null default now(),
  -- The DB-level backstop: even under concurrent duplicate delivery, only one
  -- insert per (provider, event_id) can win. The app does a SELECT-first check
  -- for the common case; this constraint closes the TOCTOU race.
  unique (provider, event_id)
);

alter table public.processed_webhook_events enable row level security;
