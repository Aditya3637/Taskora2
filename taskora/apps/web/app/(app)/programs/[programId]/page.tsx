"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, User, X, ChevronDown, ChevronRight, GanttChartSquare, Pencil, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useWorkspaceFormat } from "@/lib/use-workspace-format";
import { GanttModal } from "../../gantt/GanttChart";
import { EditInitiativeModal } from "../EditInitiativeModal";
import { WorkDocPanel } from "../_components/WorkDocPanel";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const token = session.access_token;

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
    });
  } catch (networkErr: any) {
    throw new Error(`Network error: ${networkErr?.message ?? String(networkErr)}`);
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail ?? d.message ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Member = { user_id: string; name: string; email: string; role: string };

type Initiative = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  impact?: string | null;
  impact_metric?: string | null;
  impact_category?: string | null;
  start_date?: string | null;
  target_end_date?: string | null;
  primary_stakeholder_id?: string | null;
  primary_stakeholder_name?: string;
  owner_id?: string | null;
};

type Program = {
  id: string;
  name: string;
  status: string;
  color: string;
  description?: string | null;
  initiatives: Initiative[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  planning: "bg-purple-100 text-purple-700",
  on_hold: "bg-orange-100 text-orange-600",
  cancelled: "bg-red-100 text-red-600",
};

const IMPACT_CATEGORIES = [
  {
    value: "cost",
    label: "Cost",
    color: "bg-green-100 text-green-700 border-green-200",
  },
  {
    value: "customer_experience",
    label: "Customer Experience",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  {
    value: "process_efficiency",
    label: "Process Efficiency",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
  {
    value: "other",
    label: "Others",
    color: "bg-gray-100 text-gray-600 border-gray-200",
  },
] as const;

type ImpactCatValue = (typeof IMPACT_CATEGORIES)[number]["value"];

function getCategoryMeta(value: string | null | undefined) {
  return IMPACT_CATEGORIES.find((c) => c.value === value) ?? IMPACT_CATEGORIES[3];
}

// ── Add Initiative Modal ──────────────────────────────────────────────────────

function AddInitiativeModal({
  programId,
  businessId,
  onClose,
  onCreated,
}: {
  programId: string;
  businessId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [primaryStakeholderId, setPrimaryStakeholderId] = useState("");
  const [impactCategory, setImpactCategory] = useState<ImpactCatValue>("other");
  const [impact, setImpact] = useState("");
  const [impactMetric, setImpactMetric] = useState("");
  const { currencySymbol: sym } = useWorkspaceFormat();
  const [targetDate, setTargetDate] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch(`/api/v1/businesses/${businessId}/members`)
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [businessId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/v1/programs/${programId}/initiatives`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          primary_stakeholder_id: primaryStakeholderId || null,
          impact_category: impactCategory,
          impact: impact.trim() || null,
          impact_metric: impactMetric.trim() || null,
          target_end_date: targetDate || null,
        }),
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create initiative.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-midnight">Add Initiative</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mist"
          >
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Initiative Name *
            </label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Cost Reduction Drive"
              required
              autoFocus
              maxLength={150}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Primary Stakeholder
            </label>
            <select
              value={primaryStakeholderId}
              onChange={(e) => setPrimaryStakeholderId(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
            >
              <option value="">Select a member…</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email} — {m.role}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">
              Category of Impact
            </label>
            <div className="grid grid-cols-2 gap-2">
              {IMPACT_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setImpactCategory(cat.value)}
                  className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
                    impactCategory === cat.value
                      ? `${cat.color} ring-2 ring-offset-1 ring-current`
                      : "border-pebble text-steel hover:border-ocean/40 hover:bg-mist/30"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Expected Impact
            </label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2}
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="e.g. Reduce operational costs by 15% in Q3"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Impact Metric
            </label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
              value={impactMetric}
              onChange={(e) => setImpactMetric(e.target.value)}
              placeholder={`e.g. 15% cost reduction, ${sym}200K savings`}
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Target End Date
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-pebble text-sm text-steel hover:bg-mist font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add Initiative"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ── Initiative Card ───────────────────────────────────────────────────────────

function InitiativeCard({ init, canEdit, onEdit, onOpenDoc }: { init: Initiative; canEdit: boolean; onEdit: () => void; onOpenDoc: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showGantt, setShowGantt] = useState(false);
  const cat = getCategoryMeta(init.impact_category);
  const hasDetails = !!(init.description || init.impact_metric);

  return (
    <div className="bg-white rounded-xl border border-pebble shadow-sm hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
              STATUS_BADGE[init.status] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {init.status}
          </span>
          {init.impact_category && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${cat.color}`}
            >
              {cat.label}
            </span>
          )}
          {init.target_end_date && (
            <span className="text-[11px] text-steel ml-auto whitespace-nowrap">
              📅 {init.target_end_date}
            </span>
          )}
          <button
            onClick={() => setShowGantt(true)}
            title="Open Gantt chart"
            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border border-pebble text-steel hover:border-ocean hover:text-ocean transition-colors whitespace-nowrap ${
              init.target_end_date ? "" : "ml-auto"
            }`}
          >
            <GanttChartSquare className="w-3.5 h-3.5" /> Gantt
          </button>
          <button
            onClick={onOpenDoc}
            title="Open work document"
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border border-pebble text-steel hover:border-ocean hover:text-ocean transition-colors whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" /> Work doc
          </button>
          {canEdit && (
            <button
              onClick={onEdit}
              title="Edit initiative"
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border border-pebble text-steel hover:border-taskora-red hover:text-taskora-red transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
        </div>

        <h3 className="font-semibold text-midnight text-base mb-2">{init.name}</h3>

        {init.primary_stakeholder_name && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-5 h-5 rounded-full bg-ocean/10 flex items-center justify-center flex-shrink-0">
              <User className="w-3 h-3 text-ocean" />
            </div>
            <span className="text-xs text-steel font-medium">
              {init.primary_stakeholder_name}
            </span>
            <span className="text.xs text-steel/50">· Stakeholder</span>
          </div>
        )}

        {init.impact && (
          <p className="text-xs text-steel line-clamp-2 mb-2 leading-relaxed">
            {init.impact}
          </p>
        )}

        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-ocean hover:underline font-medium mt-1"
          >
            {expanded ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" /> Hide details
              </>
            ) : (
              <>
                <ChevronRight className="w-3.5 h-3.5" /> More details
              </>
            )}
          </button>
        )}

        {expanded && (
          <div className="mt-3 pt-3 border-t border-pebble/50 space-y-2">
            {init.description && (
              <div>
                <p className="text-[11px] font-semibold text-steel uppercase tracking-wider mb-0.5">
                  Description
                </p>
                <p className="text-xs text-midnight leading-relaxed">
                  {init.description}
                </p>
              </div>
            )}
            {init.impact_metric && (
              <div>
                <p className="text-[11px] font-semibold text-steel uppercase tracking-wider mb-0.5">
                  Impact Metric
                </p>
                <p className="text-xs text-midnight">{init.impact_metric}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showGantt && (
        <GanttModal
          initiativeId={init.id}
          initiativeName={init.name}
          onClose={() => setShowGantt(false)}
        />
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

// ── P1 + P2: Outcomes (key results), status updates, and the trend ────────────

type Rollup = {
  health: string; progress_pct: number; outcome_pct: number | null;
  initiative_count: { total: number; done: number; active: number; at_risk: number; overdue: number };
  overdue_task_count: number;
};
type KR = { id: string; title: string; unit?: string | null; baseline?: number | null; target?: number | null; current?: number | null; direction: string; progress_pct: number | null };
type Upd = { id: string; status: "green" | "amber" | "red"; summary: string; author_name?: string; created_at: string };
type Snap = { snapshot_date: string; progress_pct: number | null; outcome_pct: number | null; health: string };

const RAG_DOT: Record<string, string> = { green: "bg-green-500", amber: "bg-amber-400", red: "bg-red-500", not_started: "bg-gray-300" };
const RAG_TEXT: Record<string, string> = { green: "On track", amber: "At risk", red: "Off track", not_started: "Not started" };

function Trend({ snaps }: { snaps: Snap[] }) {
  if (snaps.length < 2) {
    return <p className="text-xs text-steel/60 italic">Trend builds daily — check back as snapshots accumulate.</p>;
  }
  const W = 260, H = 56, n = snaps.length;
  const pts = (key: "progress_pct" | "outcome_pct") =>
    snaps.map((s, i) => {
      const v = s[key] ?? 0;
      return `${(i / (n - 1)) * W},${H - (v / 100) * H}`;
    }).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
        <polyline points={pts("progress_pct")} fill="none" stroke="#0E7AB8" strokeWidth="2" />
        <polyline points={pts("outcome_pct")} fill="none" stroke="#E5484D" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
      <div className="flex gap-3 text-[11px] text-steel mt-1">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-ocean inline-block" /> Tasks done</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-taskora-red inline-block" /> Outcome</span>
        <span className="ml-auto text-steel/50">last {snaps.length}d</span>
      </div>
    </div>
  );
}

function ProgramOutcomes({ programId, canEdit }: { programId: string; canEdit: boolean }) {
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [krs, setKrs] = useState<KR[]>([]);
  const [updates, setUpdates] = useState<Upd[]>([]);
  const [trend, setTrend] = useState<Snap[]>([]);
  const [adding, setAdding] = useState(false);
  const [nk, setNk] = useState({ title: "", unit: "", baseline: "", target: "", current: "", direction: "increase" });
  const [rag, setRag] = useState<"green" | "amber" | "red">("green");
  const [summary, setSummary] = useState("");

  const load = useCallback(async () => {
    const get = async <T,>(p: string, set: (v: T) => void) => { try { set(await apiFetch(p)); } catch { /* table may not exist pre-migration */ } };
    await Promise.allSettled([
      get<Rollup>(`/api/v1/programs/${programId}/rollup`, setRollup),
      get<KR[]>(`/api/v1/programs/${programId}/key-results`, setKrs),
      get<Upd[]>(`/api/v1/programs/${programId}/updates`, setUpdates),
      get<Snap[]>(`/api/v1/programs/${programId}/trend?days=60`, setTrend),
    ]);
  }, [programId]);
  useEffect(() => { load(); }, [load]);

  const addKr = async () => {
    if (!nk.title.trim()) return;
    await apiFetch(`/api/v1/programs/${programId}/key-results`, {
      method: "POST",
      body: JSON.stringify({
        title: nk.title.trim(), unit: nk.unit || null, direction: nk.direction,
        baseline: nk.baseline === "" ? null : Number(nk.baseline),
        target: nk.target === "" ? null : Number(nk.target),
        current: nk.current === "" ? null : Number(nk.current),
      }),
    });
    setAdding(false); setNk({ title: "", unit: "", baseline: "", target: "", current: "", direction: "increase" });
    await load();
  };
  const saveCurrent = async (kr: KR, raw: string) => {
    const v = raw === "" ? null : Number(raw);
    if (v === (kr.current ?? null)) return;
    await apiFetch(`/api/v1/programs/${programId}/key-results/${kr.id}`, { method: "PATCH", body: JSON.stringify({ current: v }) });
    await load();
  };
  const delKr = async (id: string) => {
    if (!confirm("Delete this key result?")) return;
    await apiFetch(`/api/v1/programs/${programId}/key-results/${id}`, { method: "DELETE" });
    await load();
  };
  const postUpdate = async () => {
    if (!summary.trim()) return;
    await apiFetch(`/api/v1/programs/${programId}/updates`, { method: "POST", body: JSON.stringify({ status: rag, summary: summary.trim() }) });
    setSummary(""); await load();
  };

  return (
    <div className="space-y-4 mb-8">
      {/* Summary band */}
      {rollup && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-pebble bg-white p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">Health</p>
            <p className="flex items-center gap-1.5 mt-1 font-bold text-midnight">
              <span className={`w-2.5 h-2.5 rounded-full ${RAG_DOT[rollup.health] ?? "bg-gray-300"}`} />{RAG_TEXT[rollup.health] ?? rollup.health}
            </p>
          </div>
          <div className="rounded-xl border border-pebble bg-white p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">Outcome</p>
            <p className="text-2xl font-extrabold text-taskora-red mt-0.5">{rollup.outcome_pct == null ? "—" : `${rollup.outcome_pct}%`}</p>
          </div>
          <div className="rounded-xl border border-pebble bg-white p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">Tasks done</p>
            <p className="text-2xl font-extrabold text-midnight mt-0.5">{rollup.progress_pct}%</p>
          </div>
          <div className="rounded-xl border border-pebble bg-white p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">Overdue tasks</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${rollup.overdue_task_count > 0 ? "text-amber-600" : "text-midnight"}`}>{rollup.overdue_task_count}</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Key results */}
        <section className="rounded-xl border border-pebble bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-midnight">Key results</h2>
            {canEdit && !adding && <button onClick={() => setAdding(true)} className="text-xs text-ocean font-semibold hover:underline">+ Add</button>}
          </div>
          {krs.length === 0 && !adding && <p className="text-xs text-steel/60 italic">No measurable outcomes yet. Add one to track real progress, not just task counts.</p>}
          <div className="space-y-3">
            {krs.map((kr) => (
              <div key={kr.id} className="group">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-midnight font-medium truncate">{kr.title}</span>
                  <span className="text-xs font-bold text-midnight flex-shrink-0">{kr.progress_pct == null ? "—" : `${kr.progress_pct}%`}</span>
                </div>
                <div className="h-2 bg-pebble rounded-full overflow-hidden my-1">
                  <div className="h-full bg-taskora-red rounded-full" style={{ width: `${kr.progress_pct ?? 0}%` }} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-steel">
                  <span>{kr.baseline ?? 0}{kr.unit ? ` ${kr.unit}` : ""}</span>
                  <span className="text-steel/40">→</span>
                  {canEdit ? (
                    <input type="number" defaultValue={kr.current ?? ""} onBlur={(e) => saveCurrent(kr, e.target.value)}
                      className="w-16 px-1 py-0.5 border border-pebble rounded text-[11px] focus:outline-none focus:border-taskora-red" title="Current value — edit to update" />
                  ) : <span className="font-semibold text-midnight">{kr.current ?? "—"}</span>}
                  <span className="text-steel/40">/ {kr.target ?? "—"} target</span>
                  {canEdit && <button onClick={() => delKr(kr.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-steel/50 hover:text-red-500">✕</button>}
                </div>
              </div>
            ))}
          </div>
          {adding && (
            <div className="mt-3 space-y-2 border-t border-pebble pt-3">
              <input placeholder="Outcome (e.g. Bacnet live across top 5 sites)" value={nk.title} onChange={(e) => setNk({ ...nk, title: e.target.value })} className="w-full text-sm px-2 py-1.5 border border-pebble rounded focus:outline-none focus:border-taskora-red" />
              <div className="grid grid-cols-4 gap-2">
                <input placeholder="Baseline" value={nk.baseline} onChange={(e) => setNk({ ...nk, baseline: e.target.value })} className="text-xs px-2 py-1.5 border border-pebble rounded" />
                <input placeholder="Current" value={nk.current} onChange={(e) => setNk({ ...nk, current: e.target.value })} className="text-xs px-2 py-1.5 border border-pebble rounded" />
                <input placeholder="Target" value={nk.target} onChange={(e) => setNk({ ...nk, target: e.target.value })} className="text-xs px-2 py-1.5 border border-pebble rounded" />
                <input placeholder="Unit" value={nk.unit} onChange={(e) => setNk({ ...nk, unit: e.target.value })} className="text-xs px-2 py-1.5 border border-pebble rounded" />
              </div>
              <div className="flex items-center gap-2">
                <select value={nk.direction} onChange={(e) => setNk({ ...nk, direction: e.target.value })} className="text-xs px-2 py-1.5 border border-pebble rounded bg-white">
                  <option value="increase">Increase to target</option>
                  <option value="decrease">Decrease to target</option>
                </select>
                <button onClick={addKr} className="ml-auto text-xs px-3 py-1.5 bg-midnight text-white rounded font-semibold">Add</button>
                <button onClick={() => setAdding(false)} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel">Cancel</button>
              </div>
            </div>
          )}
        </section>

        {/* Status updates + trend */}
        <section className="rounded-xl border border-pebble bg-white p-4">
          <h2 className="text-sm font-bold text-midnight mb-2">Status &amp; trend</h2>
          <Trend snaps={trend} />
          {canEdit && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-1.5">
                {(["green", "amber", "red"] as const).map((c) => (
                  <button key={c} onClick={() => setRag(c)} className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${rag === c ? "border-midnight" : "border-pebble"}`}>
                    <span className={`w-2 h-2 rounded-full ${RAG_DOT[c]}`} />{RAG_TEXT[c]}
                  </button>
                ))}
              </div>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="What changed? Risks, blockers, next step…" className="w-full text-sm px-2 py-1.5 border border-pebble rounded focus:outline-none focus:border-taskora-red resize-none" />
              <button onClick={postUpdate} disabled={!summary.trim()} className="text-xs px-3 py-1.5 bg-taskora-red text-white rounded font-semibold disabled:opacity-40">Post update</button>
            </div>
          )}
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {updates.length === 0 && <p className="text-xs text-steel/60 italic">No status updates yet.</p>}
            {updates.map((u) => (
              <div key={u.id} className="flex gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${RAG_DOT[u.status]}`} />
                <div className="min-w-0">
                  <p className="text-midnight">{u.summary}</p>
                  <p className="text-[11px] text-steel/60">{u.author_name || "Someone"} · {u.created_at?.slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ProgramDetailPage() {
  const { programId } = useParams<{ programId: string }>();
  const router = useRouter();

  const [program, setProgram] = useState<Program | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editInit, setEditInit] = useState<Initiative | null>(null);
  const [docInit, setDocInit] = useState<Initiative | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const userId = currentSession?.user?.id ?? null;

      const biz = await apiFetch("/api/v1/businesses/my");
      if (!biz?.id) throw new Error("No business found.");
      setBusinessId(biz.id);

      const data = await apiFetch(`/api/v1/programs/${programId}`);
      if (!data?.id) throw new Error("Program not found.");
      setProgram(data);

      if (biz.owner_id === userId) {
        setCanEdit(true);
      } else {
        apiFetch(`/api/v1/businesses/${biz.id}/members`)
          .then((members: any[]) => {
            const me = members.find((m) => m.user_id === userId);
            if (me?.role === "owner" || me?.role === "admin") setCanEdit(true);
          })
          .catch(() => {});
      }
    } catch (err: any) {
      const msg = err?.message ?? err?.toString?.() ?? "Unknown error";
      if (msg.toLowerCase().includes("not authenticated")) {
        router.replace("/login");
        return;
      }
      setError(msg || "Unexpected error loading program.");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !program) {
    return (
      <div className="p-8">
        <p className="text-red-600 mb-3">{error || "Program not found."}</p>
        <button
          onClick={() => router.push("/programs")}
          className="text-sm text-steel underline"
        >
          ← Back to Programs
        </button>
      </div>
    );
  }

  const initiatives = program.initiatives ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <button
        onClick={() => router.push("/programs")}
        className="flex items-center gap-1.5 text-sm text-steel hover:text-midnight mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> All Programs
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div className="flex items-start gap-3">
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 mt-1"
            style={{ backgroundColor: program.color }}
          />
          <div>
            <h1 className="text-2xl font-bold text-midnight">{program.name}</h1>
            {program.description && (
              <p className="text-steel text-sm mt-0.5 max-w-xl">
                {program.description}
              </p>
            )}
            <p className="text-xs text-steel/60 mt-1">
              {initiatives.length} initiative
              {initiatives.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90 flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Initiative
          </button>
        )}
      </div>

      {/* P1 + P2: measurable outcomes, status updates, trend */}
      <ProgramOutcomes programId={programId} canEdit={canEdit} />

      {initiatives.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-pebble">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mx-auto mb-3">
            <Plus className="w-6 h-6 text-steel/50" />
          </div>
          <p className="text-steel font-medium mb-1">No initiatives yet</p>
          <p className="text-sm text-steel/60 mb-5">
            Add an initiative to start breaking down this program into actionable
            goals.
          </p>
          {canEdit && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90"
            >
              Add First Initiative
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {initiatives.map((init) => (
            <InitiativeCard key={init.id} init={init} canEdit={canEdit} onEdit={() => setEditInit(init)} onOpenDoc={() => setDocInit(init)} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddInitiativeModal
          programId={programId}
          businessId={businessId}
          onClose={() => setShowAdd(false)}
          onCreated={load}
        />
      )}

      {editInit && (
        <EditInitiativeModal
          initiative={editInit}
          businessId={businessId}
          onClose={() => setEditInit(null)}
          onSaved={load}
        />
      )}

      {docInit && (
        <WorkDocPanel
          initiativeId={docInit.id}
          initiativeName={docInit.name}
          onClose={() => setDocInit(null)}
        />
      )}
    </div>
  );
}
