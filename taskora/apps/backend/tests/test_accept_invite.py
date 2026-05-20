"""POST /api/v1/invites/{token}/accept — invitee joins the workspace.

Regression for the "Accept Invitation button does nothing" prod bug:
freshly-signed-up users have an auth.users row but no public.users row
(migration 030 added a trigger for new signups; this code path is the
belt-and-suspenders if the trigger is missing or races). business_members
.user_id is a NOT NULL FK to public.users(id), so the upsert would 500
with an FK violation and the FE caught it as a silent no-op.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "owner-1"
INVITEE = "new-user-1"
BIZ = "biz-1"
TOKEN = "tok-abc"


@pytest.fixture
def sb():
    s = FakeSupabase({
        "businesses": [
            {"id": BIZ, "name": "Acme", "type": "building", "owner_id": OWNER},
        ],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
        ],
        # Owner is in public.users; the invitee deliberately is not — that's
        # the bug shape.
        "users": [
            {"id": OWNER, "name": "Owner", "email": "owner@x.dev"},
        ],
        "workspace_invites": [
            {
                "id": "invite-1",
                "token": TOKEN,
                "business_id": BIZ,
                "invited_email": "newbie@x.dev",
                "invited_by": OWNER,
                "role": "member",
                "status": "pending",
            },
        ],
    })
    app.dependency_overrides[get_current_user] = lambda: {
        "id": INVITEE,
        "email": "newbie@x.dev",
        "user_metadata": {"name": "Newbie Person"},
    }
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_accept_creates_public_user_when_missing(sb):
    r = client.post(f"/api/v1/invites/{TOKEN}/accept")
    assert r.status_code == 200, r.text
    # public.users row was auto-created from user_metadata.name
    users_by_id = {u["id"]: u for u in sb.store["users"]}
    assert INVITEE in users_by_id
    assert users_by_id[INVITEE]["name"] == "Newbie Person"
    assert users_by_id[INVITEE]["email"] == "newbie@x.dev"


def test_accept_adds_business_membership(sb):
    client.post(f"/api/v1/invites/{TOKEN}/accept")
    members = sb.store["business_members"]
    invitee_mem = next(m for m in members if m["user_id"] == INVITEE)
    assert invitee_mem["business_id"] == BIZ
    assert invitee_mem["role"] == "member"


def test_accept_marks_invite_accepted(sb):
    client.post(f"/api/v1/invites/{TOKEN}/accept")
    invite = next(i for i in sb.store["workspace_invites"] if i["token"] == TOKEN)
    assert invite["status"] == "accepted"


def test_accept_does_not_overwrite_existing_user_name(sb):
    # Invitee already has a profile name — accept must NOT clobber it
    # with the auth metadata's name.
    sb.store["users"].append(
        {"id": INVITEE, "name": "Pre-existing Display Name",
         "email": "newbie@x.dev"})
    r = client.post(f"/api/v1/invites/{TOKEN}/accept")
    assert r.status_code == 200
    invitee_row = next(u for u in sb.store["users"] if u["id"] == INVITEE)
    assert invitee_row["name"] == "Pre-existing Display Name"


def test_accept_already_accepted_returns_409(sb):
    sb.store["workspace_invites"][0]["status"] = "accepted"
    r = client.post(f"/api/v1/invites/{TOKEN}/accept")
    assert r.status_code == 409


def test_accept_falls_back_to_email_local_part_when_no_metadata(sb):
    # Caller has no user_metadata.name — should derive name from the
    # email's local-part so public.users.name (NOT NULL) is satisfied.
    app.dependency_overrides[get_current_user] = lambda: {
        "id": INVITEE,
        "email": "newbie@x.dev",
        "user_metadata": {},
    }
    r = client.post(f"/api/v1/invites/{TOKEN}/accept")
    assert r.status_code == 200
    invitee_row = next(u for u in sb.store["users"] if u["id"] == INVITEE)
    assert invitee_row["name"] == "newbie"
