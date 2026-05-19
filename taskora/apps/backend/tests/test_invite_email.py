"""Regression: invite emails must HTML-escape user-controlled fields.

inviter_name and business_name come straight from user input. Before the
fix they were f-string-interpolated raw into the HTML body, letting a user
inject markup (a fake "Accept" button -> phishing) into an email Taskora
sends on their behalf.
"""
import email_send
from routers.invites import _send_invite_email


def test_invite_email_escapes_html(monkeypatch):
    captured = {}

    def fake_send(to, subject, html, text=None):
        captured.update(to=to, subject=subject, html=html, text=text)
        return True

    monkeypatch.setattr(email_send, "send_email", fake_send)

    payload = '<script>alert(1)</script><a href="https://evil.test">x</a>'
    _send_invite_email(
        to="victim@example.com",
        inviter_name=payload,
        business_name=f'Acme {payload}',
        role="member",
        invite_url="https://app.test/invite/tok123",
    )

    html = captured["html"]
    # The raw injection must not survive into the HTML body...
    assert "<script>" not in html
    assert '<a href="https://evil.test">' not in html
    # ...it should be present only in escaped form.
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    # The legitimate, server-generated CTA + link are still intact
    # (button href + paste-link href + paste-link visible text).
    assert html.count("https://app.test/invite/tok123") == 3
    assert ">Accept invitation</a>" in html
