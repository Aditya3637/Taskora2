"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { PageHeader, EmptyState, Spinner, Badge } from "@/components/ui";
import { Gauge, Sparkles, ArrowUpRight, Send } from "lucide-react";

// ── shapes (mirror routers/portfolio.py) ─────────────────────────────────────
type Health = "red" | "amber" | "green" | "not_started";
type Components = {
  schedule: number | null; outcome: number | null; throughput: number | null;
  blockers: number | null; staleness: number | null;
};
type ProgramCard = {
  id: string; name: string; color?: string; status: string;
  composite_health: Health; composite_score: number | null;
  outcome_pct: number | null; components: Components;
  lead_user_id?: string | null; lead_name?: string;
  initiative_total: number; at_risk_count: number;
};
type Need = {
  program_id: string; program_name: string;
  initiative_id: string; initiative_name: string;
  risk_score: number | null; health: Health; reasons: string[];
  nudge_user_id?: string | null; nudge_user_name?: string;
};
type Portfolio = {
  business_id: string; generated_at: string;
  programs: ProgramCard[]; needs_attention: Need[];
  counts: { programs_total: number; red: number; amber: number; green: number; needs_attention: number };
};

const HEALTH_DOT: Record<Health, string> = {
  red: "bg-danger-500", amber: "bg-warn-500", green: "bg-success-500",
  not_started: "bg-fg-subtle",
};
const HEALTH_TONE: Record<Health, "danger" | "warn" | "success" | "neutral"> = {
  red: "danger", amber: "warn", green: "success", not_started: "neutral",
};

export default function PortfolioPage() {
  const router = useRouter();
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
    if (!bid) { setError("No active workspace selected."); setLoading(false); return; }
    try {
      setData(await apiFetch(`/api/v1/portfolio?business_id=${bid}`));
    } catch (e: any) {
      setError(e?.detail || `Failed to load portfolio${e?.status ? ` (HTTP ${e.status})` : ""}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function nudge(n: Need) {
    if (!n.nudge_user_id) return;
    const bid = localStorage.getItem("business_id");
    setNudging(n.initiative_id);
    try {
      await apiFetch(`/api/v1/portfolio/nudge?business_id=${bid}`, {
        method: "POST",
        body: JSON.stringify({
          recipient_id: n.nudge_user_id,
          program_id: n.program_id,
          initiative_id: n.initiative_id,
          note: `Re: ${n.initiative_name} (${n.program_name}) — ${n.reasons.join("; ")}. Can you take a look?`,
        }),
      });
      setNudged((s) => new Set(s).add(n.initiative_id));
    } catch (e: any) {
      setError(e?.detail || "Failed to send nudge.");
    } finally {
      setNudging(null);
    }
  }

  if (loading) {
    return <div className="h-[60vh] flex items-center justify-center"><Spinner /></div>;
  }
  if (error && !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-sm text-danger-600">{error}</p>
        <button onClick={load} className="mt-3 px-3 py-1 border border-pebble text-ocean text-xs font-semibold rounded-lg hover:bg-mist">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-fade-up">
      <PageHeader
        eyebrow={todayLabel}
        title={<span className="inline-flex items-center gap-2"><Gauge className="w-6 h-6 text-ocean" /> Portfolio</span>}
        description="Every program you can see, ranked by risk — and the few things that need you. Read, then nudge."
        meta={
          data.counts.programs_total > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {data.counts.red > 0 && <Badge tone="danger">{data.counts.red} red</Badge>}
              {data.counts.amber > 0 && <Badge tone="warn">{data.counts.amber} amber</Badge>}
              {data.counts.green > 0 && <Badge tone="success">{data.counts.green} green</Badge>}
            </div>
          ) : null
        }
      />

      {data.counts.programs_total === 0 ? (
        <div className="py-12">
          <EmptyState icon={<Gauge className="w-7 h-7" />} title="No programs yet."
            description="Once programs exist in this workspace, they'll show here ranked by composite health." />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {/* What needs you */}
          {data.needs_attention.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-fg">What needs you</h2>
                <span className="text-xs text-fg-subtle">{data.needs_attention.length}</span>
              </div>
              <div className="rounded-xl border border-pebble divide-y divide-pebble overflow-hidden">
                {data.needs_attention.map((n) => (
                  <div key={n.initiative_id} className="px-4 py-3 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${HEALTH_DOT[n.health]}`} />
                    <button
                      onClick={() => router.push(`/tasks?initiative=${n.initiative_id}`)}
                      className="min-w-0 flex-1 text-left group"
                    >
                      <div className="text-sm text-fg truncate">
                        {n.initiative_name}
                        <span className="text-fg-subtle"> · {n.program_name}</span>
                      </div>
                      <div className="text-xs text-fg-muted truncate">{n.reasons.join(" · ")}</div>
                    </button>
                    {n.nudge_user_id ? (
                      nudged.has(n.initiative_id) ? (
                        <span className="text-xs text-success-600 font-medium shrink-0">Nudged ✓</span>
                      ) : (
                        <button
                          onClick={() => nudge(n)}
                          disabled={nudging === n.initiative_id}
                          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 border border-pebble text-ocean text-xs font-semibold rounded-lg hover:bg-mist disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          {nudging === n.initiative_id ? "…" : `Nudge ${n.nudge_user_name || "lead"}`}
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-fg-subtle shrink-0">no lead</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Programs ranked by risk */}
          <section>
            <div className="flex items-center gap-2 mb-2 px-1">
              <h2 className="text-sm font-semibold text-fg">Programs</h2>
              <span className="text-xs text-fg-subtle">{data.programs.length} · worst first</span>
            </div>
            <div className="space-y-2">
              {data.programs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/programs/${p.id}`)}
                  className="w-full text-left rounded-xl border border-pebble px-4 py-3 hover:bg-mist transition-colors group flex items-center gap-3"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[p.composite_health]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg truncate">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted mt-0.5">
                      {p.outcome_pct !== null && <span>outcome {p.outcome_pct}%</span>}
                      <span>{p.initiative_total} initiative{p.initiative_total === 1 ? "" : "s"}</span>
                      {p.at_risk_count > 0 && (
                        <span className="text-danger-600">{p.at_risk_count} at risk</span>
                      )}
                      {p.lead_name && <span className="text-fg-subtle">lead {p.lead_name}</span>}
                    </div>
                  </div>
                  <Badge tone={HEALTH_TONE[p.composite_health]}>{p.composite_health.replace("_", " ")}</Badge>
                  <ArrowUpRight className="w-3.5 h-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
