import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import get_settings
from routers import (
    admin, analytics, billing, businesses, daily_brief, decisions,
    entities, initiatives, tasks, users, war_room,
    programs, activity, invites, whatsapp, themes, onboarding,
    people,
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
