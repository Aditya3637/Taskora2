import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from jose import jwt
from datetime import datetime, timedelta, timezone

from main import app

client = TestClient(app)

FAKE_SECRET = "test-secret-key-at-least-32-chars-long!!"
FAKE_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_token(sub=FAKE_USER_ID, audience="authenticated", secret=FAKE_SECRET, **kwargs):
    payload = {
        "sub": sub,
        "aud": audience,
        "email": "test@example.com",
        "role": "authenticated",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        **kwargs,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_health_no_auth_required():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_missing_token_returns_403():
    # HTTPBearer returns 403 when no Authorization header is present
    r = client.get("/api/v1/me")
    assert r.status_code == 403


def test_invalid_token_returns_401():
    r = client.get(
        "/api/v1/me",
        headers={"Authorization": "Bearer totally.invalid.token"},
    )
    assert r.status_code == 401


def test_valid_token_accepted():
    """Valid JWT with correct secret and audience should decode successfully."""
    token = make_token()
    with patch("auth.get_settings") as mock_get_settings:
        mock_settings = MagicMock()
        mock_settings.supabase_jwt_secret = FAKE_SECRET
        mock_get_settings.return_value = mock_settings
        # We test the function directly since /api/v1/me doesn't exist yet
        from auth import get_current_user
        from fastapi.security import HTTPAuthorizationCredentials
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        result = get_current_user(creds, mock_settings)
        assert result["id"] == FAKE_USER_ID
        assert result["email"] == "test@example.com"


def test_expired_token_returns_401():
    token = make_token(exp=datetime.now(timezone.utc) - timedelta(hours=1))
    with patch("auth.get_settings") as mock_get_settings:
        mock_settings = MagicMock()
        mock_settings.supabase_jwt_secret = FAKE_SECRET
        mock_get_settings.return_value = mock_settings
        from auth import get_current_user
        from fastapi.security import HTTPAuthorizationCredentials
        from fastapi import HTTPException
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        with pytest.raises(HTTPException) as exc:
            get_current_user(creds, mock_settings)
        assert exc.value.status_code == 401


def test_wrong_audience_returns_401():
    token = make_token(audience="wrong-audience")
    with patch("auth.get_settings") as mock_get_settings:
        mock_settings = MagicMock()
        mock_settings.supabase_jwt_secret = FAKE_SECRET
        mock_get_settings.return_value = mock_settings
        from auth import get_current_user
        from fastapi.security import HTTPAuthorizationCredentials
        from fastapi import HTTPException
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        with pytest.raises(HTTPException) as exc:
            get_current_user(creds, mock_settings)
        assert exc.value.status_code == 401
