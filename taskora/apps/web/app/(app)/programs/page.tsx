"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  User,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated — please sign in again.");
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
  } catch (e: any) {
    throw new Error(`Network error: ${e?.message}`);
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: any) => d.detail ?? d.message ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Program = {
  id: string;
  name: string;
  status: string;
  color: string;
  description: string | null;
  initiative_count: number;
};

type Initiative = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  impact?: string | null;
  impact_category?: string | null;
  target_end_date?: string | null;
  primary_stakeholder_id?: string | null;
  primary_stakeholder_name?: string;
};

type ProgramDetail = {
  id: string;
  name: string;
  color: string;
  status: string;
  initiatives: Initiative[];
};

type Member = { user_id: string; name: string; email: string; role: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  archived: "bg-gray-100 text-gray-500",
  planning: "bg-purple-100 text-purple-700",
  on_hold: "bg-orange-100 text-orange-600",
  cancelled: "bg-red-100 text-red-600",
};

const CATEGORY_META: Record<
  string,
  { label: string; color: string }
> = {
  cost: {
    label: "Cost",
    color: "bg-green-100 text-green-700 border-green-200",
  },
  customer_experience: {
    label: "Customer Exp.",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  process_efficiency: {
    label: "Process",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
  other: {
    label: "Other",
    color: "bg-gray-100 text-gray-600 border-gray-200",
  },
  others: {
    label: "Other",
    color: "bg-gray-100 text-gray-600 border-gray-200",
  },
};

const PRESET_COLORS = [
  "#E53E3E",
  "#3182CE",
  "#38A169",
  "#D69E2E",
  "#805AD5",
  "#DD6B20",
  "#6366F1",
  "#EC4899",
];

const IMPACT_CATEGORIES = [
  { value: "cost", label: "Cost", color: "bg-green-100 text-green-700 border-green-200" },
  { value: "customer_experience", label: "Customer Experience", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "process_efficiency", label: "Process Efficiency", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "other", label: "Others", color: "bg-gray-100 text-gray-600 border-gray-200" },
] as const;

type ImpactCatValue = (typeof IMPACT_CATEGORIES)[number]["value"];

// ── New Program Modal ─────────────────────────────────────────────────────────

function NewProgramModal({
  businessId,
  onClose,
  onCreated,
}: {
  businessId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/v1/programs/", {
        method: "POST",
        body: JSON.stringify({
          business_id: businessId,
          name: name.trim(),
          description: description.trim() || null,
          color,
        }),
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create program.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-midnight">New Program</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
              Program Name *
            </label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operations, HR, Accounts"
              required
              autoFocus
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">
              Colour
            </label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select colour ${c}`}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c
                      ? "border-midnight scale-110"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-pebble text-sm text-steel hover:bg-mist"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create Program"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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

// ── Program Row (Accordion) ───────────────────────────────────────────────────

function ProgramRow({
  program,
  businessId,
  canEdit,
}: {
  program: Program;
  businessId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showAddInit, setShowAddInit] = useState(false);
  const [hoveredInitId, setHoveredInitId] = useState<string | null>(null);

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      setLoadingDetail(true);
      try {
        const data = await apiFetch(`/api/v1/programs/${program.id}`);
        setDetail(data);
      } catch {
        /* silent */
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  function handleInitiativeCreated() {
    // Reload detail
    setDetail(null);
    apiFetch(`/api/v1/programs/${program.id}`)
      .then((data) => setDetail(data))
      .catch(() => {});
  }

  const count = program.initiative_count ?? 0;
  const initiatives = detail?.initiatives ?? [];

  return (
    <div className="border border-pebble rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Program Header Row */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-mist/40 transition-colors text-left group"
        onClick={handleExpand}
        aria-expanded={expanded}
      >
        {/* Colored dot */}
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: program.color }}
        />

        {/* Chevron */}
        <span className="flex-shrink-0 text-steel/50 group-hover:text-steel transition-colors">
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>

        {/* Name */}
        <span className="flex-1 font-semibold text-midnight text-sm">
          {program.name}
        </span>

        {/* Status badge */}
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
            STATUS_BADGE[program.status] ?? "bg-gray-100 text-gray-500"
          }`}
        >
          {program.status}
        </span>

        {/* Initiative count */}
        <span className="text-xs text-steel/60 flex-shrink-0 ml-1">
          {count} initiative{count !== 1 ? "s" : ""}
        </span>
      </button>

      {/* Expanded Panel */}
      {expanded && (
        <div className="border-t border-pebble/60 bg-mist/20">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-pebble border-t-taskora-red rounded-full animate-spin" />
            </div>
          ) : initiatives.length === 0 ? (
            <div className="px-6 py-6 text-center">
              <p className="text-sm text-steel/70 italic mb-3">
                No initiatives yet in this program.
              </p>
              {canEdit && (
                <button
                  onClick={() => setShowAddInit(true)}
                  className="text-xs text-taskora-red hover:underline font-semibold flex items-center gap-1 mx-auto"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Initiative
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-pebble/40">
              {initiatives.map((init) => {
                const catMeta =
                  CATEGORY_META[init.impact_category ?? "other"] ??
                  CATEGORY_META["other"];
                const isHovered = hoveredInitId === init.id;

                return (
                  <button
                    key={init.id}
                    className="w-full flex items-center gap-3 px-6 py-3.5 hover:bg-white/80 transition-colors text-left group/init"
                    onClick={() =>
                      router.push(`/tasks?initiative=${init.id}`)
                    }
                    onMouseEnter={() => setHoveredInitId(init.id)}
                    onMouseLeave={() => setHoveredInitId(null)}
                  >
                    {/* Colored dot (same as program) */}
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 opacity-70"
                      style={{ backgroundColor: program.color }}
                    />

                    {/* Initiative name */}
                    <span className="flex-1 text-sm font-medium text-midnight truncate">
                      {init.name}
                    </span>

                    {/* Status badge */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        STATUS_BADGE[init.status] ?? "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {init.status}
                    </span>

                    {/* Category badge */}
                    {init.impact_category && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border flex-shrink-0 ${catMeta.color}`}
                      >
                        {catMeta.label}
                      </span>
                    )}

                    {/* Primary stakeholder */}
                    {init.primary_stakeholder_name && (
                      <span className="flex items-center gap-1 text-xs text-steel/60 flex-shrink-0">
                        <User className="w-3 h-3" />
                        <span className="hidden sm:inline max-w-[100px] truncate">
                          {init.primary_stakeholder_name}
                        </span>
                      </span>
                    )}

                    {/* Target date */}
                    {init.target_end_date && (
                      <span className="text-xs text-steel/60 flex-shrink-0 hidden md:inline">
                        📅 {init.target_end_date}
                      </span>
                    )}

                    {/* Arrow on hover */}
                    <ArrowRight
                      className={`w-4 h-4 flex-shrink-0 transition-all duration-150 ${
                        isHovered
                          ? "text-ocean translate-x-0 opacity-100"
                          : "text-transparent -translate-x-1 opacity-0"
                      }`}
                    />
                  </button>
                );
              })}

              {/* + Add Initiative */}
              {canEdit && (
                <div className="px-6 py-3">
                  <button
                    onClick={() => setShowAddInit(true)}
                    className="text-xs text-taskora-red hover:underline font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Initiative
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Initiative Modal */}
      {showAddInit && (
        <AddInitiativeModal
          programId={program.id}
          businessId={businessId}
          onClose={() => setShowAddInit(false)}
          onCreated={() => {
            setShowAddInit(false);
            handleInitiativeCreated();
          }}
        />
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
      if (!bizId) {
        const biz = await apiFetch("/api/v1/businesses/my");
        if (!biz?.id) throw new Error("No business found for your account.");
        bizId = biz.id;
        localStorage.setItem("business_id", bizId);
      }
      setBusinessId(bizId);

      const data = await apiFetch(`/api/v1/programs?business_id=${bizId}`);
      setPrograms(Array.isArray(data) ? data : []);

      const roleData = await apiFetch(`/api/v1/businesses/${bizId}/my-role`).catch(() => null);
      if (roleData?.role === "owner" || roleData?.role === "admin") setCanEdit(true);
    } catch (err: any) {
      const msg = err?.message ?? err?.toString?.() ?? "Unknown error";
      if (msg.toLowerCase().includes("not authenticated")) {
        router.replace("/login?next=/programs");
        return;
      }
      setError(msg || "Unexpected error — check console.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="h-8 bg-gray-200 rounded w-40 mb-2 animate-pulse" />
            <div className="h-4 bg-gray-200 rounded w-64 animate-pulse" />
          </div>
          <div className="h-9 bg-gray-200 rounded-lg w-32 animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-pebble p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-gray-200" />
                <div className="h-4 bg-gray-200 rounded" style={{ width: `${180 + i * 30}px` }} />
                <div className="ml-auto h-5 bg-gray-200 rounded-full w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-600 mb-3">{error}</p>
        <button
          onClick={load}
          className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Programs</h1>
          <p className="text-steel text-sm mt-1">
            Organise initiatives into strategic programs.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            New Program
          </button>
        )}
      </div>

      {/* Programs accordion list */}
      {programs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-pebble">
          <p className="text-steel font-medium mb-1">No programs yet.</p>
          <p className="text-sm text-steel/70 mb-4">
            Create a program like HR, Operations, or Accounts to get started.
          </p>
          {canEdit && (
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90"
            >
              Create First Program
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {programs.map((p) => (
            <ProgramRow
              key={p.id}
              program={p}
              businessId={businessId ?? ""}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {showNew && businessId && (
        <NewProgramModal
          businessId={businessId}
          onClose={() => setShowNew(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
