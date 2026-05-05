from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import get_settings
from routers import (
    admin, analytics, billing, businesses, daily_brief, decisions,
    entities, initiatives, tasks, users, war_room,
    programs, activity, invites, templates, reports, whatsapp, themes,
)

settings = get_settings()

app = FastAPI(
    title="Taskora API",
    version="1.0.0",
    description="60-second decision-making backend",
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
app.include_router(templates.router)
app.include_router(reports.router)
app.include_router(whatsapp.router)
app.include_router(themes.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
