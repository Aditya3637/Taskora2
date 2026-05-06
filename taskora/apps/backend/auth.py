import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from config import get_settings

bearer = HTTPBearer()

_http = httpx.Client(timeout=10)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    settings=Depends(get_settings),
) -> dict:
    """
    Verifies a Supabase JWT by calling Supabase's /auth/v1/user endpoint.
    Returns dict with 'id' and 'email'.
    """
    token = credentials.credentials
    resp = _http.get(
        f"{settings.supabase_url}/auth/v1/user",
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": settings.supabase_service_key,
        },
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    data = resp.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {
        "id": user_id,
        "email": data.get("email"),
        "role": data.get("role", "authenticated"),
    }
