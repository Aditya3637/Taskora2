"""Shared FastAPI dependencies used across routers."""
from functools import lru_cache

from supabase import create_client, Client
from fastapi import Depends
from config import get_settings, Settings


@lru_cache(maxsize=1)
def _make_supabase_client(url: str, key: str) -> Client:
    """Cached Supabase client factory — one client per (url, key) pair."""
    return create_client(url, key)


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Return a cached Supabase service-role client.
    Override in tests via app.dependency_overrides[get_supabase].
    """
    return _make_supabase_client(settings.supabase_url, settings.supabase_service_key)
