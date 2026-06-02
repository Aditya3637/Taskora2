"""Message templates. One entry per template key; each renders to a
subject + html + text (email), and push/in-app derive title/body from those.

Templates take a context dict (`ctx`) — always use ctx.get(...) so a missing
field degrades gracefully instead of raising mid-send.

Tone: concise, India-SaaS, owner-addressed (the billing contact for the
workspace). CTAs link to the app.
"""
from typing import Callable


def _wrap(title: str, body_html: str, cta_label: str, cta_url: str) -> str:
    return (
        f'<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a2233">'
        f'<h2 style="color:#0f1729;margin:0 0 12px">{title}</h2>'
        f'<div style="font-size:15px;line-height:1.55;color:#334">{body_html}</div>'
        f'<p style="margin:20px 0"><a href="{cta_url}" '
        f'style="background:#e5484d;color:#fff;text-decoration:none;padding:10px 18px;'
        f'border-radius:8px;font-weight:600;display:inline-block">{cta_label}</a></p>'
        f'<p style="font-size:12px;color:#8893a5;margin-top:24px">Taskora — operational initiative tracking</p>'
        f"</div>"
    )


# Each template: subject(ctx)->str, html(ctx)->str, text(ctx)->str.
# `name` and `workspace` and `app_url` and `plan_price` are the common ctx keys.
Template = dict[str, Callable[[dict], str]]

TEMPLATES: dict[str, Template] = {
    "welcome": {
        "subject": lambda c: "Welcome to Taskora 👋",
        "html": lambda c: _wrap(
            f"Welcome, {c.get('name','there')}",
            f"You created <b>{c.get('workspace','your workspace')}</b>. "
            "Start by adding your first initiative — that's the unit everything else hangs off.",
            "Create your first initiative", f"{c.get('app_url','')}/programs"),
        "text": lambda c: f"Welcome to Taskora. Create your first initiative: {c.get('app_url','')}/programs",
    },
    "activation_no_initiative": {
        "subject": lambda c: "Set up your first initiative in Taskora",
        "html": lambda c: _wrap(
            "One step to get value",
            f"Hi {c.get('name','there')} — <b>{c.get('workspace','your workspace')}</b> doesn't have an "
            "initiative yet. Initiatives are how Taskora tracks the work that matters. It takes a minute.",
            "Create an initiative", f"{c.get('app_url','')}/programs"),
        "text": lambda c: f"Create your first initiative: {c.get('app_url','')}/programs",
    },
    "activation_invite_team": {
        "subject": lambda c: "Taskora works better with your team",
        "html": lambda c: _wrap(
            "Bring your team in",
            f"You're the only member of <b>{c.get('workspace','your workspace')}</b>. Invite the people who "
            "own the work — they get their own daily brief and accountability rolls up to you.",
            "Invite your team", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Invite your team: {c.get('app_url','')}/workspace/settings",
    },
    "trial_ending_7": {
        "subject": lambda c: "Your Taskora trial ends in a week",
        "html": lambda c: _wrap(
            "7 days left in your trial",
            f"<b>{c.get('workspace','Your workspace')}</b>'s trial ends on {c.get('trial_end_date','soon')}. "
            f"Keep your {c.get('seats','team')} on track — pick a plan to stay set up.",
            "Choose a plan", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Your trial ends {c.get('trial_end_date','soon')}. Choose a plan: {c.get('app_url','')}/workspace/settings",
    },
    "trial_ending_3": {
        "subject": lambda c: "3 days left in your Taskora trial",
        "html": lambda c: _wrap(
            "3 days left",
            f"<b>{c.get('workspace','Your workspace')}</b>'s trial ends {c.get('trial_end_date','soon')}. "
            "Add a plan now so nothing pauses for your team.",
            "Add a plan", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"3 days left in your trial. Add a plan: {c.get('app_url','')}/workspace/settings",
    },
    "trial_ending_1": {
        "subject": lambda c: "Your Taskora trial ends tomorrow",
        "html": lambda c: _wrap(
            "Last day of your trial",
            f"<b>{c.get('workspace','Your workspace')}</b>'s trial ends tomorrow. Add a plan to keep your "
            "initiatives, tasks and daily brief live.",
            "Keep my workspace", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Trial ends tomorrow. Keep your workspace: {c.get('app_url','')}/workspace/settings",
    },
    "trial_expired": {
        "subject": lambda c: "Your trial ended — your data is safe",
        "html": lambda c: _wrap(
            "Trial ended",
            f"<b>{c.get('workspace','Your workspace')}</b> is now read-only. Everything is exactly as you left "
            "it — add a plan any time to pick back up.",
            "Reactivate", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Your trial ended; data is safe. Reactivate: {c.get('app_url','')}/workspace/settings",
    },
    "payment_failed_1": {
        "subject": lambda c: "We couldn't process your Taskora payment",
        "html": lambda c: _wrap(
            "Payment didn't go through",
            f"The renewal for <b>{c.get('workspace','your workspace')}</b> failed. We'll retry automatically, "
            "but you can fix it now to avoid any interruption.",
            "Update payment", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Payment failed for {c.get('workspace','your workspace')}. Update: {c.get('app_url','')}/workspace/settings",
    },
    "payment_failed_3": {
        "subject": lambda c: "Action needed: Taskora payment still failing",
        "html": lambda c: _wrap(
            "Still couldn't charge your card",
            f"We've retried the renewal for <b>{c.get('workspace','your workspace')}</b> without success. "
            "Please update your payment method to keep your team's access.",
            "Update payment", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Payment still failing for {c.get('workspace','your workspace')}. Update: {c.get('app_url','')}/workspace/settings",
    },
    "payment_failed_final": {
        "subject": lambda c: "Final notice: Taskora access will pause",
        "html": lambda c: _wrap(
            "Access will pause",
            f"We couldn't collect payment for <b>{c.get('workspace','your workspace')}</b> after several tries. "
            "Access will pause shortly. Update your payment to restore it immediately — your data stays safe.",
            "Restore access", f"{c.get('app_url','')}/workspace/settings"),
        "text": lambda c: f"Final notice for {c.get('workspace','your workspace')}. Restore: {c.get('app_url','')}/workspace/settings",
    },
}


def render(template: str, ctx: dict) -> dict:
    """Render a template to {subject, html, text}. Falls back to a generic
    shape if the key is unknown (so a typo logs a message rather than 500s)."""
    t = TEMPLATES.get(template)
    if not t:
        subject = template.replace("_", " ").title()
        return {"subject": subject, "html": f"<p>{subject}</p>", "text": subject}
    return {
        "subject": t["subject"](ctx),
        "html": t["html"](ctx),
        "text": t["text"](ctx),
    }
