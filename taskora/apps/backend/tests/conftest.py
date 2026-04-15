"""
Set required environment variables before any test module is imported.
This runs before pytest collects test files, so module-level calls to
get_settings() (e.g. in main.py) see these values.
"""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key-for-testing-only")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-at-least-32-chars-long!!")
