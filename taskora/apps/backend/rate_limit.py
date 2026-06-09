"""Shared slowapi limiter. Lives outside main.py so routers can import
it without circular dependency on the FastAPI app object.

Keying (see `_client_key`): for authenticated calls we key on the bearer
token, so many users behind one NAT'd corporate IP aren't throttled as a
single client; anonymous calls (webhooks, invite-accept by token, etc.) fall
back to the source IP via X-Forwarded-For (Vercel sets it). Counters are
in-memory per function instance — fine for basic abuse/cost protection;
strict global limits need a Redis storage backend.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _client_key(request: Request) -> str:
    # Prefer a stable per-session key (the bearer-token tail) so a shared public
    # IP doesn't collapse every authenticated user into one bucket. Fall back to
    # the remote address for anonymous traffic.
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return "tok:" + auth[-32:]
    return get_remote_address(request)


limiter = Limiter(key_func=_client_key)
