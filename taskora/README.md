# Taskora

**60-Second Decision Making App** — Replace 60-minute meetings with 60-second decisions.

## Architecture

| Layer | Technology |
|---|---|
| Mobile | Flutter 3 (iOS + Android) |
| Web | Next.js 14 (React PWA) |
| Backend | FastAPI (Python) |
| Database | Supabase (PostgreSQL + Realtime + Auth + Storage) |
| Push | Firebase Cloud Messaging |
| Payments | Razorpay (India) · Stripe (International) |

## Structure

```
apps/
  mobile/     # Flutter app
  web/        # Next.js web PWA
  backend/    # FastAPI backend
packages/
  shared-types/  # Shared TypeScript types
```

## Getting Started

See each app's directory for setup instructions.
