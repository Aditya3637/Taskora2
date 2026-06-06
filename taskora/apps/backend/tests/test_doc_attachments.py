"""D6 (§8) — workspace-doc uploads & attachments.

Runs the real workspace_docs attachment endpoints against FakeSupabase (whose
fake Storage proxy records sign/download/remove calls). Mirrors the doc WRITE /
READ gates, so the matrix follows test_promote_task / test_workspace_docs:

  - write set (owner / admin / program-lead / contributor) can sign, record, delete;
  - followers (read-only), unaligned members, and outsiders cannot write;
  - reads (list, signed-download) follow doc visibility — every download
    re-checks it, so a cross-tenant user can't fetch an attachment by id;
  - forged paths, oversized files, and disallowed MIME types are rejected.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER, ADMIN, LEAD = "u-owner", "u-admin", "u-lead"
CONTRIB, FOLLOWER, STRANGER, OUTSIDER = "u-contrib", "u-follower", "u-stranger", "u-out"
OTHER = "u-other"               # member of a DIFFERENT business (cross-tenant)
BIZ, BIZ2 = "biz-1", "biz-2"
PROG, INIT = "prog-1", "init-1"
D1 = "doc-1"
_CUR = {"u": OWNER}

_PNG = {"filename": "diagram.png", "mime_type": "image/png", "size_bytes": 2048}
_PDF = {"filename": "sow.pdf", "mime_type": "application/pdf", "size_bytes": 4096}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": u, "name": u} for u in
                  (OWNER, ADMIN, LEAD, CONTRIB, FOLLOWER, STRANGER, OUTSIDER, OTHER)],
        "businesses": [{"id": BIZ, "name": "Acme"}, {"id": BIZ2, "name": "Globex"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": CONTRIB, "role": "member"},
            {"business_id": BIZ, "user_id": FOLLOWER, "role": "member"},
            {"business_id": BIZ, "user_id": STRANGER, "role": "member"},
            {"business_id": BIZ2, "user_id": OTHER, "role": "owner"},
        ],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "P", "lead_user_id": LEAD}],
        "initiatives": [{"id": INIT, "business_id": BIZ, "program_id": PROG, "name": "I1",
                         "primary_stakeholder_id": OWNER, "status": "active"}],
        "tasks": [{"id": "t1", "initiative_id": INIT, "created_by": OWNER}],
        "task_stakeholders": [{"task_id": "t1", "user_id": CONTRIB, "role": "secondary"}],
        "initiative_followers": [{"initiative_id": INIT, "user_id": FOLLOWER}],
        "program_followers": [], "subtasks": [], "item_watchers": [],
        "workspace_docs": [{"id": D1, "business_id": BIZ, "parent_type": "initiative",
                            "parent_id": INIT, "title": "Work doc", "body": {},
                            "created_by": OWNER}],
        "doc_attachments": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _sign(doc=D1, **over):
    payload = {**_PNG, **over}
    return client.post(f"/api/v1/docs/{doc}/attachments/sign", json=payload)


def _record(doc=D1, **over):
    payload = {**_PNG, **over}
    return client.post(f"/api/v1/docs/{doc}/attachments", json=payload)


def _upload(doc=D1, meta=_PNG):
    """Full happy-path: sign → record. Returns the recorded attachment json."""
    path = _sign(doc, **meta).json()["path"]
    return _record(doc, storage_path=path, **meta).json()


# ── happy path ──────────────────────────────────────────────────────────────

def test_owner_full_upload_lifecycle(sb):
    # sign
    r = _sign()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"].startswith(f"{BIZ}/{D1}/")        # server-generated, tenant-prefixed
    assert body["token"] and body["signed_url"]
    assert ("sign_upload", "workspace-docs", body["path"]) in sb.storage_calls

    # record
    rec = _record(storage_path=body["path"])
    assert rec.status_code == 201, rec.text
    att = rec.json()
    assert att["doc_id"] == D1 and att["is_image"] is True
    assert any(a["id"] == att["id"] for a in sb.store["doc_attachments"])

    # list
    lst = client.get(f"/api/v1/docs/{D1}/attachments")
    assert lst.status_code == 200 and len(lst.json()) == 1

    # signed download
    url = client.get(f"/api/v1/attachments/{att['id']}/url")
    assert url.status_code == 200, url.text
    assert url.json()["url"].startswith("https://fake.storage/object/sign/")
    assert url.json()["is_image"] is True and url.json()["expires_in"] == 3600

    # delete — row gone + Storage object removed
    d = client.delete(f"/api/v1/attachments/{att['id']}")
    assert d.status_code == 204
    assert not sb.store["doc_attachments"]
    assert ("remove", "workspace-docs", (body["path"],)) in sb.storage_calls


def test_non_image_reports_is_image_false(sb):
    att = _upload(meta=_PDF)
    assert att["is_image"] is False
    url = client.get(f"/api/v1/attachments/{att['id']}/url").json()
    assert url["is_image"] is False and url["mime_type"] == "application/pdf"


# ── write gate ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD, CONTRIB])
def test_write_set_can_sign(sb, u):
    _as(u)
    assert _sign().status_code == 200


def test_follower_is_read_only(sb):
    att = _upload()                       # seeded by owner
    _as(FOLLOWER)
    assert _sign().status_code == 403
    assert _record(storage_path=f"{BIZ}/{D1}/x.png").status_code == 403
    assert client.delete(f"/api/v1/attachments/{att['id']}").status_code == 403
    # but the follower CAN read + fetch a signed download
    assert client.get(f"/api/v1/docs/{D1}/attachments").status_code == 200
    assert client.get(f"/api/v1/attachments/{att['id']}/url").status_code == 200


def test_unaligned_member_cannot_see_or_write(sb):
    att = _upload()
    _as(STRANGER)
    assert _sign().status_code == 403                                  # write → 403
    assert client.get(f"/api/v1/docs/{D1}/attachments").status_code == 404   # read → 404 (no existence leak)
    assert client.get(f"/api/v1/attachments/{att['id']}/url").status_code == 404


def test_outsider_403(sb):
    att = _upload()
    _as(OUTSIDER)
    assert _sign().status_code == 403
    assert client.get(f"/api/v1/docs/{D1}/attachments").status_code == 403
    assert client.get(f"/api/v1/attachments/{att['id']}/url").status_code == 403


# ── tenant isolation ────────────────────────────────────────────────────────

def test_cross_tenant_cannot_fetch_attachment_by_id(sb):
    att = _upload()                       # business A (BIZ) attachment
    _as(OTHER)                            # member of business B only
    assert client.get(f"/api/v1/attachments/{att['id']}/url").status_code == 403
    assert _record(storage_path=f"{BIZ}/{D1}/x.png").status_code == 403


def test_forged_path_rejected(sb):
    # path under another business / another doc, or with traversal → 400
    assert _record(storage_path=f"{BIZ2}/{D1}/evil.png").status_code == 400
    assert _record(storage_path=f"{BIZ}/other-doc/evil.png").status_code == 400
    assert _record(storage_path=f"{BIZ}/{D1}/../../{BIZ2}/x.png").status_code == 400


# ── input validation ────────────────────────────────────────────────────────

def test_oversized_rejected(sb):
    assert _sign(size_bytes=26_214_401).status_code == 413
    assert _record(storage_path=f"{BIZ}/{D1}/x.png", size_bytes=99_000_000).status_code == 413


def test_disallowed_mime_rejected(sb):
    assert _sign(mime_type="application/x-msdownload").status_code == 415
    assert _sign(mime_type="application/x-sh").status_code == 415


def test_bad_size_and_blank_filename_422(sb):
    assert _sign(size_bytes=0).status_code == 422
    assert _sign(filename="   ").status_code == 422


def test_missing_doc_404(sb):
    assert client.post("/api/v1/docs/nope/attachments/sign", json=_PNG).status_code == 404
    assert client.get("/api/v1/attachments/nope/url").status_code == 404
