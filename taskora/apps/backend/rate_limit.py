"""Shared slowapi limiter. Lives outside main.py so routers can import
it without circular dependency on the FastAPI app object.

Per-IP keying via X-Forwarded-For (Vercel sets it). Counters are in-memory
per function instance — fine for basic abuse protection; if we need
strict global limits, swap in a Redis storage backend.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
