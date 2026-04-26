# Taskora2 — Free Hosting Guide

This guide explains how to deploy the entire Taskora stack — Next.js frontend, FastAPI backend, and Supabase database — at **zero cost** using free tiers of modern cloud platforms.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   USERS / CLIENTS                   │
└────────────────────────┬────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │     Vercel (Frontend)        │
          │   Next.js 14 PWA — Free Tier │
          └──────────────┬──────────────┘
                         │ API calls
          ┌──────────────▼──────────────┐
          │  Render or Railway (Backend) │
          │   FastAPI / Python — Free   │
          └──────────────┬──────────────┘
                         │ DB + Auth + Storage
          ┌──────────────▼──────────────┐
          │    Supabase (Database)       │
          │  PostgreSQL + Auth + Storage │
          │      Free Tier (500 MB)      │
          └─────────────────────────────┘
```

---

## Platform Choices

| Layer    | Platform      | Free Limits                          | Notes                       |
|----------|---------------|--------------------------------------|-----------------------------|
| Frontend | **Vercel**    | Unlimited deployments, 100 GB BW/mo  | Native Next.js host          |
| Backend  | **Render**    | 750 hrs/mo, spins down after 15 min  | Upgrade to Railway if needed |
| Database | **Supabase**  | 500 MB DB, 1 GB storage, 50k MAU     | Already used in project      |
| Media    | **Supabase Storage** | 1 GB included in free tier    | Already in stack             |

---

## Step 1 — Supabase (Database)

Supabase is already your database. The free tier is generous for early-stage apps.

### Setup
1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Create a new **project** (choose the region closest to your users).
3. Go to **Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY`
   - `JWT Secret` → `SUPABASE_JWT_SECRET`

### Run Migrations
Open **SQL Editor** in the Supabase dashboard and run each migration file in order:

```
taskora/apps/backend/migrations/001_core_schema.sql
taskora/apps/backend/migrations/002_initiatives_tasks.sql
taskora/apps/backend/migrations/003_activity_billing.sql
taskora/apps/backend/migrations/004_rls.sql
```

### Free Tier Limits
- 500 MB database storage
- 1 GB file storage
- 50,000 monthly active users
- 2 GB bandwidth
- Pauses after **1 week of inactivity** (re-activates on next request)

---

## Step 2 — Backend (FastAPI on Render)

### Option A: Render (Recommended for zero-cost start)

1. Go to [render.com](https://render.com) and sign up with your GitHub account.
2. Click **New → Web Service** and connect your `Taskora2` repository.
3. Configure the service:

   | Setting       | Value                                      |
   |---------------|--------------------------------------------|
   | Root Directory | `taskora/apps/backend`                    |
   | Runtime        | Python 3                                  |
   | Build Command  | `pip install -r requirements.txt`         |
   | Start Command  | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Instance Type  | **Free**                                  |

4. Under **Environment Variables**, add:

   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   SUPABASE_JWT_SECRET=your-jwt-secret
   RAZORPAY_KEY_ID=rzp_test_xxx
   RAZORPAY_KEY_SECRET=xxx
   STRIPE_SECRET_KEY=sk_test_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
   FRONTEND_URL=https://your-app.vercel.app
   ```

   > For `FIREBASE_CREDENTIALS_JSON`, paste the entire JSON content as a single-line string value.

5. Deploy. Render will give you a URL like `https://taskora-backend.onrender.com`.

**Important caveat**: The free tier **spins down after 15 minutes of inactivity**. The first request after a cold start takes ~30–60 seconds. This is acceptable for demos but not ideal for production.

### Option B: Railway ($5 free credit/month, no cold starts)

1. Go to [railway.app](https://railway.app) and sign up.
2. Click **New Project → Deploy from GitHub Repo**.
3. Select `Taskora2`, set root to `taskora/apps/backend`.
4. Railway auto-detects Python. Add a `Procfile` if needed:
   ```
   web: uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
5. Add the same environment variables as above.
6. Railway gives **$5 free credit/month** — enough for ~500 hours of a small instance, with no cold starts.

### Option C: Koyeb (Always-on free tier)

[koyeb.com](https://www.koyeb.com) offers a truly **always-on free tier** (1 nano instance) with no cold starts. Good alternative if Render's spin-down is a problem.

---

## Step 3 — Frontend (Next.js on Vercel)

Vercel is the official platform for Next.js and has the most generous free tier.

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub.
2. Click **Add New → Project** and import `Taskora2`.
3. Set the **Root Directory** to `taskora/apps/web`.
4. Vercel auto-detects Next.js. Leave Framework Preset as **Next.js**.
5. Under **Environment Variables**, add:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   NEXT_PUBLIC_API_URL=https://taskora-backend.onrender.com
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
   ```

6. Click **Deploy**. Vercel gives you a URL like `https://taskora2.vercel.app`.
7. Go back to your **backend** environment variables and update `FRONTEND_URL` to this Vercel URL.

### Free Tier Limits
- Unlimited personal projects
- 100 GB bandwidth/month
- Serverless Functions: 100 GB-hrs compute
- Custom domains supported

---

## Step 4 — Connect Everything

After all three services are deployed, update cross-service references:

1. **Backend CORS**: Make sure your FastAPI `main.py` allows the Vercel domain. In `main.py`, the `FRONTEND_URL` env var controls CORS origins — set it to `https://your-app.vercel.app`.

2. **Frontend API URL**: Ensure `NEXT_PUBLIC_API_URL` in Vercel points to your Render/Railway backend URL.

3. **Supabase Auth Redirect URLs**: In Supabase Dashboard → **Authentication → URL Configuration**, add your Vercel URL to the allowed redirect URLs:
   ```
   https://your-app.vercel.app/**
   ```

4. **Health Check**: Visit `https://taskora-backend.onrender.com/health` — you should see:
   ```json
   { "status": "ok", "version": "1.0.0" }
   ```

---

## Step 5 — Custom Domain (Optional, Free)

### Frontend (Vercel)
- Go to your Vercel project → **Settings → Domains**.
- Add your custom domain (e.g., `taskora.yourdomain.com`).
- Update DNS records as instructed. SSL is automatic.

### Backend (Render)
- Render free tier supports custom domains. Go to **Settings → Custom Domains**.

### Free Domain Options
If you don't own a domain, you can get one free:
- [Freenom](https://www.freenom.com) — `.tk`, `.ml`, `.ga` domains (free)
- [js.org](https://js.org) — free `yourname.js.org` subdomain for JS projects
- GitHub Student Pack includes free `.me` domain via Namecheap

---

## Environment Variables Reference

### Backend (Render / Railway)

```env
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWT_SECRET=your-jwt-secret

# Payments (use test keys for dev)
RAZORPAY_KEY_ID=<your-razorpay-key-id>
RAZORPAY_KEY_SECRET=<your-razorpay-key-secret>
STRIPE_SECRET_KEY=<your-stripe-test-secret-key>
STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>

# Firebase (paste full JSON as single string)
FIREBASE_CREDENTIALS_JSON={"type":"service_account","project_id":"..."}

# CORS
FRONTEND_URL=https://your-app.vercel.app
```

### Frontend (Vercel)

```env
# Supabase (use public/anon key, NOT service role key)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Backend API
NEXT_PUBLIC_API_URL=https://taskora-backend.onrender.com

# Payments (publishable keys only)
NEXT_PUBLIC_RAZORPAY_KEY_ID=<your-razorpay-key-id>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-stripe-publishable-key>
```

---

## Keeping the Backend Alive (Render Free Tier)

Render's free tier spins down after 15 minutes of inactivity. To prevent cold starts:

### Option 1: Cron-job ping (free)
Use [cron-job.org](https://cron-job.org) (free service) to ping your `/health` endpoint every 10 minutes:

```
URL: https://taskora-backend.onrender.com/health
Schedule: Every 10 minutes
```

### Option 2: Upgrade to Railway
Railway's $5/month free credit keeps the instance always warm.

### Option 3: Vercel Edge Functions
Move lightweight API routes to Next.js API routes — they run on Vercel's edge and don't have cold-start spin-down issues.

---

## Free Firebase Setup (Push Notifications)

1. Go to [console.firebase.google.com](https://console.firebase.google.com).
2. Create a new project (free **Spark plan**).
3. Go to **Project Settings → Service Accounts → Generate New Private Key**.
4. Download the JSON file and paste its contents as the `FIREBASE_CREDENTIALS_JSON` env var.

The free Spark plan includes unlimited push notifications (FCM).

---

## Cost Summary

| Service        | Platform       | Monthly Cost |
|----------------|----------------|--------------|
| Frontend       | Vercel         | **$0**       |
| Backend        | Render / Railway | **$0**     |
| Database       | Supabase       | **$0**       |
| File Storage   | Supabase       | **$0**       |
| Push Notifications | Firebase   | **$0**       |
| Custom Domain  | Freenom / own  | **$0–$10**   |
| **Total**      |                | **$0/mo**    |

---

## Scaling Beyond Free

When you outgrow the free tiers:

| Need               | Upgrade Path                        | Cost      |
|--------------------|-------------------------------------|-----------|
| No cold starts     | Render Starter or Railway Pro       | ~$7/mo    |
| More DB storage    | Supabase Pro                        | $25/mo    |
| More bandwidth     | Vercel Pro                          | $20/mo    |
| Full production    | All three Pro tiers                 | ~$52/mo   |

---

## Quick Deployment Checklist

- [ ] Create Supabase project and run all 4 migration files
- [ ] Copy `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`
- [ ] Deploy backend to Render (root: `taskora/apps/backend`)
- [ ] Set all backend environment variables on Render
- [ ] Verify backend health: `GET /health`
- [ ] Deploy frontend to Vercel (root: `taskora/apps/web`)
- [ ] Set all frontend environment variables on Vercel
- [ ] Update `FRONTEND_URL` in Render to Vercel URL
- [ ] Add Vercel URL to Supabase Auth redirect list
- [ ] Set up cron-job.org ping to prevent Render cold starts
- [ ] (Optional) Add custom domain
