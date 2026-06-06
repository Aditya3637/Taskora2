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
    # Sentry — when DSN is unset Sentry init becomes a no-op (tests + local
    # dev unaffected). vercel_env (auto-set by Vercel) tags events as
    # production/preview/development for filtering in the dashboard.
    sentry_dsn: Optional[str] = None
    vercel_env: Optional[str] = None
    # Lifecycle automation. cron_secret guards the /internal/cron/tick
    # endpoint that Vercel Cron calls (Vercel injects this as a Bearer token
    # automatically when an env var named CRON_SECRET is set). When unset,
    # the tick endpoint is disabled (503) so it can't be triggered anonymously.
    cron_secret: Optional[str] = None
    # AI features (D4 program summary). When anthropic_api_key is unset, the
    # AI-summary endpoints report "not configured" and the regenerate button
    # returns 503 — nothing else breaks (mirrors the resend_api_key pattern).
    anthropic_api_key: Optional[str] = None
    anthropic_model: str = "claude-opus-4-8"
    # Workspace-doc uploads (D6). The private Storage bucket provisioned by
    # migration 052; the per-file size cap is enforced on the sign + record
    # endpoints and mirrored as the bucket's storage-layer file_size_limit.
    workspace_docs_bucket: str = "workspace-docs"
    doc_upload_max_bytes: int = 26_214_400  # 25 MiB


@lru_cache
def get_settings() -> Settings:
    return Settings()
