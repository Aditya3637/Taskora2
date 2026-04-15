"""Shared FastAPI dependencies used across routers."""
from supabase import create_client, Client
from fastapi import Depends
from config import get_settings, Settings


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Create a Supabase service-role client. Override in tests via app.dependency_overrides."""
    return create_client(settings.supabase_url, settings.supabase_service_key)
