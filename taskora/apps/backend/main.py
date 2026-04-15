from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import get_settings
from routers import businesses, entities, initiatives, tasks

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


app.include_router(businesses.router)
app.include_router(entities.router)
app.include_router(initiatives.router)
app.include_router(tasks.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
