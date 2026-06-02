"""Internal endpoints not meant for end users — the cron heartbeat.

Vercel Cron calls GET /api/v1/internal/cron/tick on a schedule (see
apps/backend/vercel.json). Vercel injects `Authorization: Bearer <CRON_SECRET>`
automatically when an env var named CRON_SECRET exists; we also accept an
`X-Cron-Secret` header for manual curling. When cron_secret is unset the
endpoint is disabled (503) so it can't be triggered anonymously.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from supabase import Client

from config import get_settings
from deps import get_supabase
from automation import runner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _authorize(request: Request) -> None:
    secret = get_settings().cron_secret
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Cron not configured")
    auth = request.headers.get("authorization", "")
    bearer = auth[7:] if auth.lower().startswith("bearer ") else ""
    header = request.headers.get("x-cron-secret", "")
    if secret not in (bearer, header):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Bad cron secret")


@router.get("/cron/tick")
@router.post("/cron/tick")
def cron_tick(request: Request, sb: Client = Depends(get_supabase)):
    """Run one automation heartbeat: process due jobs + campaign scans."""
    _authorize(request)
    return runner.tick(sb)
