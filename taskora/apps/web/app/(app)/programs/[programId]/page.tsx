"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, User, X, ChevronDown, ChevronRight, GanttChartSquare } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
  target_end_date?: string | null;
  primary_stakeholder_id?: string | null;
  primary_stakeholder_name?: string;
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
              placeholder="e.g. 15% cost reduction, ₹2L savings"
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

function InitiativeCard({ init }: { init: Initiative }) {
  const [expanded, setExpanded] = useState(false);
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
          <Link
            href={`/gantt?initiative=${init.id}`}
            title="Open Gantt chart"
            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border border-pebble text-steel hover:border-ocean hover:text-ocean transition-colors whitespace-nowrap ${
              init.target_end_date ? "" : "ml-auto"
            }`}
          >
            <GanttChartSquare className="w-3.5 h-3.5" /> Gantt
          </Link>
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
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProgramDetailPage() {
  const { programId } = useParams<{ programId: string }>();
  const router = useRouter();

  const [program, setProgram] = useState<Program | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

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
            <InitiativeCard key={init.id} init={init} />
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
    </div>
  );
}
