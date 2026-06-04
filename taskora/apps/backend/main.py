import logging
import traceback
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from rate_limit import limiter
from config import get_settings

settings = get_settings()

# Sentry — no-op when SENTRY_DSN is unset, so tests + local dev are
# unaffected. Captures the full traceback for every unhandled exception
# *before* the global handler swallows it for the response body.
if settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.vercel_env or "unknown",
        # 5% trace sampling — cheap enough at our scale, enough to spot
        # P95 regressions.
        traces_sample_rate=0.05,
        # Don't ship PII (request body, user emails) to Sentry by default.
        send_default_pii=False,
    )

# Structured-ish logger. Each request gets a short request_id we prefix
# onto every log line + return as X-Request-ID so support can correlate
# user reports with Vercel logs.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("taskora")
from routers import (
    admin, analytics, billing, businesses, daily_brief, decisions,
    entities, initiatives, tasks, users, war_room,
    programs, activity, invites, whatsapp, themes, onboarding,
    people, join_requests, notebook, internal, portfolio, workspace_docs,
    my_day,
)

app = FastAPI(
    title="Taskora API",
    version="1.0.0",
    description="60-second decision-making backend",
    redirect_slashes=False,
)
# Per-IP rate limiter (defined in rate_limit.py so routers can import it
# without circular dependency on `app`). In-memory counters per Vercel
# function instance — fine for basic abuse protection.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: in dev (frontend_url is localhost) accept ANY localhost port via a
# regex, so `next dev` falling back to :3001/:3002 when :3000 is taken
# doesn't break every API call. In prod (frontend_url is a real domain)
# `_is_dev` is False → no regex, no localhost origins, locked to the single
# configured frontend_url. With allow_credentials=True a permanent dev
# entry would otherwise let any tool on localhost hit prod with the user's
# session, so the regex is strictly dev-gated.
_origins = [settings.frontend_url]
_is_dev = "localhost" in (settings.frontend_url or "") or "127.0.0.1" in (settings.frontend_url or "")
# Matches http://localhost:<port> and http://127.0.0.1:<port> (dev only).
_origin_regex = r"^http://(localhost|127\.0\.0\.1):\d+$" if _is_dev else None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Stamp every request with a short id; echo it on the response so
    support can correlate a user-reported error with Vercel logs. Skipped
    when the upstream (a proxy / Vercel) already provided one."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


app.include_router(admin.router)
app.include_router(analytics.router)
app.include_router(billing.router)
app.include_router(businesses.router)
app.include_router(daily_brief.router)
app.include_router(decisions.router)
app.include_router(entities.router)
app.include_router(initiatives.router)
app.include_router(tasks.router)
app.include_router(users.router)
app.include_router(war_room.router)
app.include_router(programs.router)
app.include_router(activity.router)
app.include_router(invites.router)
app.include_router(whatsapp.router)
app.include_router(themes.router)
app.include_router(onboarding.router)
app.include_router(people.router)
app.include_router(join_requests.router)
app.include_router(notebook.router)
app.include_router(internal.router)
app.include_router(portfolio.router)
app.include_router(workspace_docs.router)
app.include_router(my_day.router)


# PostgREST/Supabase errors. Without this, every DB constraint, RLS, or
# schema failure fell through to the generic handler below as an opaque
# "Internal server error" 500 (the original buildings-import symptom).
# Map the user-actionable Postgres SQLSTATEs to clean messages; anything
# else (e.g. undefined column/table — a deploy/schema bug) stays a generic
# 500 so we never leak schema internals to callers.
_DB_ERROR_MAP = {
    "23505": (409, "A record with these details already exists."),
    "23503": (400, "A referenced record does not exist."),
    "23502": (400, "A required field is missing."),
    "23514": (400, "A submitted value is not allowed."),
    "23P01": (409, "This conflicts with an existing record."),
    "42501": (403, "You don't have permission to do that."),
}


@app.exception_handler(APIError)
async def postgrest_exception_handler(request: Request, exc: APIError):
    code = getattr(exc, "code", None)
    mapped = _DB_ERROR_MAP.get(code)
    if mapped is None:
        # Unknown DB error — log loudly, return opaque 500 (no schema leak).
        print(f"UNMAPPED DB ERROR ({code}): {request.method} {request.url}\n"
              f"{getattr(exc, 'message', exc)} | details={getattr(exc, 'details', None)}")
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
    http_status, message = mapped
    print(f"DB ERROR {code} → {http_status}: {request.method} {request.url} | "
          f"{getattr(exc, 'message', exc)}")
    return JSONResponse(status_code=http_status, content={"detail": message})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Log the full traceback server-side only. Returning it in the response
    # body (previous behaviour) leaked file paths, vendored-lib layout, DB
    # constraint names and query internals to any caller. Sentry (when
    # configured) also captures the exception with full context.
    rid = getattr(request.state, "request_id", "-")
    tb = traceback.format_exc()
    logger.error("UNHANDLED 500 rid=%s %s %s\n%s", rid, request.method, request.url, tb)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": rid},
        headers={"X-Request-ID": rid},
    )


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
