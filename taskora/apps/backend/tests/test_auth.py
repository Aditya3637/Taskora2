"""Auth tests.

`get_current_user` validates a token by calling Supabase's
`/auth/v1/user` endpoint over HTTP (it does NOT decode the JWT locally).
So these tests mock `auth._http` rather than crafting JWTs — the older
local-decode tests were stale against this design and had been failing
on `main` (MagicMock settings leaking into a real httpx header).
"""
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

import auth
from auth import get_current_user
from main import app

client = TestClient(app)

FAKE_USER_ID = "00000000-0000-0000-0000-000000000001"


class _Resp:
    """Minimal stand-in for an httpx.Response."""
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _Settings:
    supabase_url = "http://supabase.test"
    supabase_service_key = "service-key"


def _creds(token="any.token"):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_health_no_auth_required():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_missing_token_returns_403():
    # No Authorization header — HTTPBearer rejects before get_current_user.
    # Path is slash-less: redirect_slashes=False makes the trailing-slash
    # form 405 (it only matches the POST route).
    r = client.get("/api/v1/businesses")
    assert r.status_code == 403


def test_invalid_token_returns_401():
    # Supabase rejects the token (non-200) -> get_current_user raises 401.
    with patch.object(auth._http, "get", return_value=_Resp(401)):
        r = client.get(
            "/api/v1/businesses",
            headers={"Authorization": "Bearer totally.invalid.token"},
        )
    assert r.status_code == 401


def test_valid_token_accepted():
    """Supabase confirms the token -> user dict returned."""
    resp = _Resp(200, {"id": FAKE_USER_ID, "email": "test@example.com",
                        "role": "authenticated"})
    with patch.object(auth._http, "get", return_value=resp):
        result = get_current_user(_creds(), _Settings())
    assert result["id"] == FAKE_USER_ID
    assert result["email"] == "test@example.com"


def test_rejected_token_returns_401():
    """Any non-200 from Supabase (expired / bad signature / wrong aud —
    all now enforced server-side) maps to a 401."""
    with patch.object(auth._http, "get", return_value=_Resp(401)):
        with pytest.raises(HTTPException) as exc:
            get_current_user(_creds(), _Settings())
    assert exc.value.status_code == 401


def test_forbidden_upstream_also_401():
    with patch.object(auth._http, "get", return_value=_Resp(403)):
        with pytest.raises(HTTPException) as exc:
            get_current_user(_creds(), _Settings())
    assert exc.value.status_code == 401


def test_missing_subject_returns_401():
    """200 from Supabase but no user id -> 401 (the local guard)."""
    with patch.object(auth._http, "get", return_value=_Resp(200, {})):
        with pytest.raises(HTTPException) as exc:
            get_current_user(_creds(), _Settings())
    assert exc.value.status_code == 401
