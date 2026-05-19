from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    supabase_url: str
    supabase_service_key: str
    supabase_jwt_secret: Optional[str] = None  # unused since auth switched to Supabase /auth/v1/user
    # Payment keys are optional at startup — missing values raise errors at call time
    razorpay_key_id: Optional[str] = None
    razorpay_key_secret: Optional[str] = None
    stripe_secret_key: Optional[str] = None
    stripe_webhook_secret: Optional[str] = None
    firebase_credentials_json: Optional[str] = None
    frontend_url: str = "http://localhost:3000"
    # Transactional email (Resend). When resend_api_key is unset, sending is
    # a logged no-op so invite/onboarding flows never break unconfigured.
    resend_api_key: Optional[str] = None
    # "onboarding@resend.dev" works for testing before a domain is verified
    # in Resend; switch to e.g. "Taskora <noreply@taskora.deftai.in>" after.
    email_from: str = "Taskora <onboarding@resend.dev>"


@lru_cache
def get_settings() -> Settings:
    return Settings()
