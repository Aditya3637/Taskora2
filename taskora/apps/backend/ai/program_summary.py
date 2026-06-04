"""D4 — AI program summary.

Rolls a program's live signals (composite health, ranked initiative risk + the
specific reasons, key results, recent human status updates) plus a short excerpt
of each initiative's Work Document into a crisp executive narrative, via Claude.

The program level has NO manual doc (047 constrains workspace_docs to
initiatives) — this generated summary IS the program-level synthesis, flowing UP
from the initiative work docs and the rollup/risk numbers. AI drafts; a human
reads/approves. Generation is on-demand (the "Regenerate" button, gated to
owner/admin/lead). The gather/generate split is deliberate: a future automation
job (needs migration 045) can reuse `gather_program_context` + `generate_summary`
on a weekly cron without touching the request path.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional

from supabase import Client

from config import get_settings


def is_configured() -> bool:
    """True when an Anthropic API key is present. When False the endpoints report
    a 'not configured' state instead of failing (mirrors resend_api_key)."""
    return bool(get_settings().anthropic_api_key)


def doc_text(body) -> str:
    """Flatten a TipTap/ProseMirror doc to plain text — text nodes joined,
    block nodes newline-separated. Tolerant of any shape; '' for empty/unknown."""
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            t = node.get("type")
            if t == "text" and isinstance(node.get("text"), str):
                out.append(node["text"])
            for child in node.get("content") or []:
                walk(child)
            if t in ("paragraph", "heading", "listItem", "blockquote", "codeBlock"):
                out.append("\n")
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(body)
    lines = [ln.strip() for ln in "".join(out).splitlines()]
    return "\n".join(ln for ln in lines if ln).strip()


def gather_program_context(sb: Client, program: dict, today: date) -> dict:
    """Collect the live signals the summary is grounded in. Pure reads — safe to
    call from the request path or a background job."""
    # Imported lazily to avoid an import cycle (programs.py imports this module).
    from routers.programs import program_risk, program_outcome_pct

    program_id = program["id"]
    risk = program_risk(sb, program, today)

    initiatives = (
        sb.table("initiatives")
        .select("id, name, status")
        .eq("program_id", program_id).neq("status", "cancelled")
        .execute().data
    )
    init_ids = [i["id"] for i in initiatives]
    names = {i["id"]: (i.get("name") or "") for i in initiatives}

    krs = (
        sb.table("program_key_results")
        .select("title, unit, baseline, target, current, direction")
        .eq("program_id", program_id).execute().data
    )
    updates = (
        sb.table("program_updates")
        .select("status, summary, created_at")
        .eq("program_id", program_id).order("created_at", desc=True).limit(3)
        .execute().data
    )

    # Initiative work-doc excerpts (047). Best-effort: degrade if the table is
    # absent or empty so the summary still works on the rollup numbers alone.
    doc_excerpts: list = []
    try:
        if init_ids:
            docs = (
                sb.table("workspace_docs")
                .select("parent_id, title, body, archived_at")
                .eq("parent_type", "initiative").in_("parent_id", init_ids)
                .execute().data
            )
            for d in docs:
                if d.get("archived_at"):
                    continue
                txt = doc_text(d.get("body"))
                if txt:
                    doc_excerpts.append({
                        "initiative": names.get(d.get("parent_id"), ""),
                        "excerpt": txt[:1200],
                    })
    except Exception:
        pass

    return {
        "program": {
            "name": program.get("name"),
            "objective": program.get("objective"),
            "description": program.get("description"),
        },
        "health": {
            "composite": risk["composite_health"],
            "composite_score": risk["composite_score"],
            "components": risk["components"],
            "outcome_pct": program_outcome_pct(sb, program_id),
        },
        "initiative_count": len(initiatives),
        "ranked_initiatives": [
            {k: r.get(k) for k in (
                "name", "health", "risk_score", "overdue_tasks",
                "blocked_tasks", "days_stale", "reasons",
            )}
            for r in risk["ranked_initiatives"][:8]
        ],
        "key_results": krs,
        "recent_updates": updates,
        "work_doc_excerpts": doc_excerpts,
    }


# Stable instruction prefix — same bytes on every call, so it sits before the
# cache_control breakpoint (the per-program data goes in the volatile user turn).
# The breakpoint is correct placement; it only writes a cache entry once this
# prefix exceeds the model's minimum cacheable size, but the architecture
# (frozen system / volatile user) is what keeps caching effective at scale.
_SYSTEM = """You are the program analyst for Taskora, a work-execution platform where a Program contains Initiatives, which contain Tasks.

You will receive a JSON snapshot of ONE program: its composite health (a 0–1 risk score blended from schedule, outcome, throughput, blockers, and staleness, mapped to a green/amber/red band), its initiatives ranked worst-first with the specific reasons each is at risk, its measurable key results, the latest human status updates, and short excerpts from each initiative's working document.

Write a tight executive summary for the program's leadership.

Ground every statement in the data provided — cite the actual initiative names, numbers, and reasons. Never invent facts, dates, or names. If a signal is missing (e.g. no measurable key results, no work-doc excerpts), say so plainly rather than guessing.

Use exactly these four sections, in this order, as level-2 markdown headings:

## Where things stand
2–3 sentences: the overall health and the main driver behind it.

## What needs attention
Bullet the highest-risk initiatives, each with its specific reason (past target date, N overdue tasks, no activity in N days, etc.). If nothing is at risk, say so.

## Outcomes
Progress against the key results. If none are defined, state that measurable outcomes aren't set up yet and that progress below is task-completion only.

## Suggested focus
1–3 concrete, actionable next steps the lead could take this week.

Rules: under ~250 words total. Plain, direct, specific — no corporate filler, no preamble, no sign-off. Markdown limited to `##` headings, `-` bullets, and `**bold**` for emphasis."""


def generate_summary(context: dict) -> Optional[str]:
    """Draft the narrative with Claude. Returns markdown, or None when the AI
    integration isn't configured (ANTHROPIC_API_KEY unset) — callers surface a
    'not configured' state rather than 500-ing."""
    s = get_settings()
    if not s.anthropic_api_key:
        return None

    # Lazy import keeps the anthropic package optional at module-import time
    # (tests monkeypatch this function; CI doesn't need the dependency).
    from anthropic import Anthropic

    client = Anthropic(api_key=s.anthropic_api_key)
    user_payload = (
        "Summarize this program for its leadership. Here is the data as JSON:\n\n"
        + json.dumps(context, default=str, ensure_ascii=False)
    )
    resp = client.messages.create(
        model=s.anthropic_model,
        max_tokens=1500,
        system=[{
            "type": "text", "text": _SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_payload}],
        # Adaptive thinking + medium effort: a routine summarization, so the
        # balanced setting. Passed via extra_body so the request body is correct
        # regardless of the installed SDK's typed-parameter coverage.
        extra_body={
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "medium"},
        },
    )
    parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return "".join(parts).strip() or None
