"""Vercel entrypoint — re-exports the FastAPI app from the backend package."""
import sys
import os

# Add the backend directory to the Python path so all relative imports work
_backend_dir = os.path.join(os.path.dirname(__file__), "..", "taskora", "apps", "backend")
sys.path.insert(0, os.path.abspath(_backend_dir))

from main import app  # noqa: F401, E402  — FastAPI app Vercel will serve
