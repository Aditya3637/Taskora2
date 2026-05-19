import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from config import get_settings
from routers import (
    admin, analytics, billing, businesses, daily_brief, decisions,
    entities, initiatives, tasks, users, war_room,
    programs, activity, invites, whatsapp, themes, onboarding,
    people, join_requests,
)

settings = get_settings()

app = FastAPI(
    title="Taskora API",
    version="1.0.0",
    description="60-second decision-making backend",
    redirect_slashes=False,
)

# TODO: tighten allow_origins / allow_methods / allow_headers before production
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    # constraint names and query internals to any caller.
    tb = traceback.format_exc()
    print(f"UNHANDLED 500: {request.method} {request.url}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
