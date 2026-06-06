"""AI pass — in-document assistance for Workspace Docs (the "✨" actions).

Granola's magic is that you jot sparse notes and AI enriches them from the
meeting transcript. Our equivalent enriches from the initiative's LIVE data
(task counts, overdue load, the program's key results) — so "draft a status"
and "enhance my notes" are grounded in real project signals, not guesses.

Reuses the D4 provider-agnostic plumbing (resolve_config + the same Anthropic/
OpenAI dispatch). AI drafts; the human inserts/edits. Pure on-demand from the
request path; the gather step is read-only so a future job could reuse it.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional

from supabase import Client

from ai.program_summary import DEFAULT_MODELS, doc_text

ACTIONS = {"enhance", "summarize", "draft_status", "extract_actions"}

# Per-action system prompts. Each grounds the model in the doc + live data and
# forbids invention. Kept terse — these are utility transforms, not essays.
_SYSTEMS = {
    "enhance": (
        "You are an editor inside Taskora's initiative work document. Rewrite the "
        "user's rough working notes into a clear, well-structured writeup: tighten "
        "wording, group related points, fix grammar. PRESERVE every fact and number "
        "— never invent or drop information. Return clean text using only short "
        "paragraphs and `-` bullets. No preamble, no headings unless the notes imply "
        "sections, no sign-off."
    ),
    "summarize": (
        "Summarize this initiative work document into 3–6 tight bullets capturing the "
        "decisions, status, and open items. Ground every bullet in the text — don't "
        "invent. Return only `-` bullets, no preamble."
    ),
    "draft_status": (
        "Draft a short status update for this initiative for its program lead. Use the "
        "document text AND the live data JSON (task counts, overdue load, key results). "
        "Format: first line is one of 'GREEN', 'AMBER', or 'RED' plus a one-sentence "
        "headline; then 2–4 `-` bullets (progress, risks, next step). Ground every claim "
        "in the data — cite real numbers. Under 90 words. No preamble, no sign-off."
    ),
    "extract_actions": (
        "Extract the concrete, actionable to-dos implied by this work document. Return "
        "ONLY a JSON array of short imperative task titles (each ≤ 100 characters, no "
        "numbering). If there are none, return []. No prose, no code fences — just the "
        "JSON array."
    ),
}


def gather_doc_context(sb: Client, initiative: dict, today: date) -> dict:
    """Light live-data context for an initiative's doc AI — task tallies + the
    program's key results. Pure reads; degrades to bare fields on any failure."""
    init_id = initiative["id"]
    total = open_ = overdue = done = 0
    try:
        tasks = (
            sb.table("tasks").select("status, due_date")
            .eq("initiative_id", init_id).execute().data
        )
        for t in tasks:
            st = t.get("status")
            if st in ("done", "archived", "cancelled"):
                if st == "done":
                    done += 1
                continue
            total += 1
            open_ += 1
            due = t.get("due_date")
            if due and str(due) < today.isoformat():
                overdue += 1
    except Exception:
        pass

    krs: list = []
    try:
        if initiative.get("program_id"):
            krs = (
                sb.table("program_key_results")
                .select("title, unit, baseline, target, current, direction")
                .eq("program_id", initiative["program_id"]).execute().data
            )
    except Exception:
        pass

    return {
        "initiative": {"name": initiative.get("name"), "status": initiative.get("status")},
        "tasks": {"open": open_, "overdue": overdue, "done": done, "active_total": total},
        "key_results": krs,
    }


def _complete(system: str, user: str, config: dict, max_tokens: int = 1200) -> str:
    """Provider-agnostic single-shot completion (mirrors program_summary)."""
    provider = config.get("provider") or "anthropic"
    if provider == "openai":
        from openai import OpenAI

        client = OpenAI(api_key=config["api_key"])
        resp = client.chat.completions.create(
            model=config.get("model") or DEFAULT_MODELS["openai"],
            max_tokens=max_tokens,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
        )
        return (resp.choices[0].message.content or "").strip()

    from anthropic import Anthropic

    client = Anthropic(api_key=config["api_key"])
    resp = client.messages.create(
        model=config.get("model") or DEFAULT_MODELS["anthropic"],
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        extra_body={"thinking": {"type": "adaptive"}, "output_config": {"effort": "low"}},
    )
    parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return "".join(parts).strip()


def _parse_actions(raw: str) -> list[str]:
    """Best-effort parse of the extract_actions output → list of titles."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").split("\n", 1)[-1] if "\n" in raw else raw.strip("`")
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip()[:100] for x in data if str(x).strip()][:25]
    except Exception:
        pass
    # Fallback: lines that look like list items.
    out: list[str] = []
    for ln in raw.splitlines():
        ln = ln.strip().lstrip("-*0123456789. ").strip()
        if ln:
            out.append(ln[:100])
    return out[:25]


def run_doc_assist(action: str, content: str, context: dict, config: Optional[dict]) -> Optional[dict]:
    """Run one ✨ action. Returns {kind, text|actions} or None when no key is
    configured (the endpoint then reports 'not configured')."""
    if not config or not config.get("api_key"):
        return None
    system = _SYSTEMS[action]
    user = (
        f"Work document text:\n\n{content or '(empty)'}\n\n"
        f"Live initiative data (JSON):\n{json.dumps(context, default=str, ensure_ascii=False)}"
    )
    raw = _complete(system, user, config)
    if action == "extract_actions":
        return {"kind": "actions", "actions": _parse_actions(raw)}
    return {"kind": "text", "text": raw}


# Re-export so callers can flatten a doc body without reaching into program_summary.
flatten_doc = doc_text
