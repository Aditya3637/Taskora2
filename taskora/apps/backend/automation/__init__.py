"""Lifecycle-automation engine.

A small event-driven layer on top of the existing data model:

    events  → append-only log of meaningful actions
    jobs    → durable retryable work, run by a cron tick
    messages→ every outbound comm (email/push/whatsapp/in-app), deduped

`runner.tick()` is the heartbeat (Vercel Cron → /api/v1/internal/cron/tick):
it processes due jobs and runs the idempotent campaign scans (trial-end
reminders, payment dunning, activation nudges). Everything is best-effort —
nothing here may break a user-facing request.
"""
