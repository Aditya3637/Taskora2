"use client";
import { useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * D4 — AI program summary. The program level has no manual work doc; this is its
 * generated synthesis (rolled up from initiative work docs + live rollup/risk
 * numbers). Read is member-wide; "Regenerate" is owner/admin/lead-gated on the
 * server (we show the button when `canEdit`). The model drafts; a human reads.
 */
type Summary = {
  body: string;
  model?: string | null;
  health?: string | null;
  generated_at?: string | null;
  generated_by_name?: string | null;
};

const RAG: Record<string, string> = {
  green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500",
  not_started: "bg-gray-300",
};

function ago(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Inline-bold a single line: split on **…** and bold the odd segments. */
function inline(text: string, key: string) {
  return text.split("**").map((seg, i) =>
    i % 2 === 1 ? <strong key={`${key}-${i}`} className="font-semibold text-midnight">{seg}</strong> : seg,
  );
}

/** Minimal markdown → JSX for the model's `## headings`, `- bullets`, `**bold**`. */
function renderMd(md: string) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 my-1.5">
          {bullets.map((b, i) => <li key={i} className="text-sm text-steel">{inline(b, `li-${out.length}-${i}`)}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flush();
      out.push(<h4 key={`h-${out.length}`} className="text-xs font-bold uppercase tracking-wider text-steel mt-3 first:mt-0">{line.replace(/^#{1,3}\s/, "")}</h4>);
    } else if (/^[-*]\s/.test(line)) {
      bullets.push(line.replace(/^[-*]\s/, ""));
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(<p key={`p-${out.length}`} className="text-sm text-steel my-1.5">{inline(line, `p-${out.length}`)}</p>);
    }
  }
  flush();
  return out;
}

export function ProgramAiSummary({ programId, canEdit }: { programId: string; canEdit: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/ai-summary`);
      setSummary(r?.summary ?? null);
      setConfigured(r?.configured ?? false);
    } catch {
      /* table may not exist pre-migration — leave the section hidden */
    } finally {
      setLoading(false);
    }
  }, [programId]);
  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/ai-summary`, { method: "POST" });
      setSummary(r?.summary ?? null);
      setConfigured(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(/503/.test(msg) ? "AI summaries aren't configured yet." : "Couldn't generate a summary. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  // Pre-migration / hard error and nothing to show → render nothing.
  if (!summary && !configured && !canEdit) return null;

  return (
    <section className="rounded-xl border border-pebble bg-white p-4 mb-8">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-midnight">
          <Sparkles className="w-4 h-4 text-taskora-red" /> AI summary
          {summary?.health && <span className={`w-2 h-2 rounded-full ${RAG[summary.health] ?? "bg-gray-300"}`} />}
        </h2>
        {canEdit && configured && (
          <button
            onClick={regenerate}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold text-ocean hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Generating…" : summary ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      {summary ? (
        <>
          <div className="prose-none">{renderMd(summary.body)}</div>
          <p className="text-[11px] text-steel/60 mt-3 pt-2 border-t border-pebble">
            Generated {ago(summary.generated_at)}
            {summary.generated_by_name ? ` by ${summary.generated_by_name}` : ""}
            {" · AI-drafted from live program data — verify before sharing."}
          </p>
        </>
      ) : !configured ? (
        <p className="text-xs text-steel/60 italic">
          AI summaries aren&apos;t connected yet{canEdit ? " — add an Anthropic or OpenAI key in Workspace settings → Profile." : "."}
        </p>
      ) : (
        <p className="text-xs text-steel/60 italic">
          No summary yet.{canEdit ? " Generate one to roll up this program's initiatives + signals into a brief." : ""}
        </p>
      )}
    </section>
  );
}
