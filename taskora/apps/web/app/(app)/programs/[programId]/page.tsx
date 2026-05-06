"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, User, X, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Member = { user_id: string; name: string; email: string; role: string };
type Initiative = {
  id: string; name: string; status: string; description?: string;
  impact?: string; impact_metric?: string; impact_category?: string;
  target_end_date?: string;
  primary_stakeholder_id?: string; primary_stakeholder_name?: string;
};
type Theme = { id: string; name: string; initiatives: Initiative[] };
type Program = {
  id: string; name: string; status: string; color: string; description?: string;
  themes: Theme[];
  unthemed_initiatives: Initiative[];
};

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  paused:    "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  planning:  "bg-purple-100 text-purple-700",
  on_hold:   "bg-orange-100 text-orange-600",
  cancelled: "bg-red-100 text-red-600",
};

const IMPACT_CATEGORY_OPTS = [
  { value: "cost",                label: "Cost" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "process_efficiency",  label: "Process Efficiency" },
  { value: "other",               label: "Others" },
];

const IMPACT_CATEGORY_COLOR: Record<string, string> = {
  cost:                 "bg-green-100 text-green-700 border-green-200",
  customer_experience:  "bg-blue-100 text-blue-700 border-blue-200",
  process_efficiency:   "bg-purple-100 text-purple-700 border-purple-200",
  other:                "bg-gray-100 text-gray-600 border-gray-200",
};
const IMPACT_CATEGORY_LABEL: Record<string, string> = {
  cost: "Cost",
  customer_experience: "Customer Exp.",
  process_efficiency:  "Process Efficiency",
  other:               "Others",
};

// ── New Initiative Modal ──────────────────────────────────────────────────────
function NewInitiativeModal({
  businessId, programId, onClose, onCreated,
}: { businessId: string; programId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [primaryStakeholderId, setPrimaryStakeholderId] = useState("");
  const [impactCategory, setImpactCategory] = useState("other");
  const [impact, setImpact] = useState("");
  const [impactMetric, setImpactMetric] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch(`/api/v1/businesses/${businessId}/members`)
      .then(d => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [businessId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      await apiFetch("/api/v1/initiatives/", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          business_id: businessId,
          program_id: programId,
          primary_stakeholder_id: primaryStakeholderId || null,
          impact_category: impactCategory,
          impact: impact.trim() || null,
          impact_metric: impactMetric.trim() || null,
          ...(targetDate && { target_end_date: targetDate }),
        }),
      });
      onCreated(); onClose();
    } catch { setError("Failed to create initiative."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-midnight">Add Initiative</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mist">
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Initiative Name *</label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red focus:ring-1 focus:ring-taskora-red/20"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Q3 Cost Reduction Drive" required autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Description</label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this initiative"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">
              Primary Stakeholder
            </label>
            <select
              value={primaryStakeholderId} onChange={e => setPrimaryStakeholderId(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
            >
              <option value="">Select a member…</option>
              {members.map(m => (
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
              {IMPACT_CATEGORY_OPTS.map(opt => (
                <button
                  key={opt.value} type="button"
                  onClick={() => setImpactCategory(opt.value)}
                  className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
                    impactCategory === opt.value
                      ? `${IMPACT_CATEGORY_COLOR[opt.value]} ring-2 ring-offset-1 ring-current`
                      : "border-pebble text-steel hover:border-ocean/40 hover:bg-mist/30"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Expected Impact</label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2} value={impact} onChange={e => setImpact(e.target.value)}
              placeholder="e.g. Reduce operational costs by 15% in Q3"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Impact Metric</label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
              value={impactMetric} onChange={e => setImpactMetric(e.target.value)}
              placeholder="e.g. 15% cost reduction, ₹2L savings"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Target End Date</label>
            <input
              type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-pebble text-sm text-steel hover:bg-mist font-medium">
              Cancel
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
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
  const cat = init.impact_category ?? "others";
  const hasMore = !!(init.description || init.impact_metric);

  return (
    <div className="bg-white rounded-xl border border-pebble shadow-sm hover:shadow-md transition-shadow">
      <div className="p-5">
        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[init.status] ?? "bg-gray-100 text-gray-500"}`}>
            {init.status}
          </span>
          {init.impact_category && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${IMPACT_CATEGORY_COLOR[cat]}`}>
              {IMPACT_CATEGORY_LABEL[cat] ?? cat}
            </span>
          )}
          {init.target_end_date && (
            <span className="text-[11px] text-steel ml-auto whitespace-nowrap">📅 {init.target_end_date}</span>
          )}
        </div>

        {/* Name */}
        <h3 className="font-semibold text-midnight text-base mb-2">{init.name}</h3>

        {/* Primary Stakeholder */}
        {init.primary_stakeholder_name && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-5 h-5 rounded-full bg-ocean/10 flex items-center justify-center flex-shrink-0">
              <User className="w-3 h-3 text-ocean" />
            </div>
            <span className="text-xs text-steel font-medium">{init.primary_stakeholder_name}</span>
            <span className="text-xs text-steel/50">· Primary Stakeholder</span>
          </div>
        )}

        {/* Expected impact preview */}
        {init.impact && (
          <p className="text-xs text-steel line-clamp-2 mb-2 leading-relaxed">{init.impact}</p>
        )}

        {/* More details toggle */}
        {hasMore && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-ocean hover:underline font-medium mt-1"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? "Hide details" : "More details"}
          </button>
        )}

        {expanded && (
          <div className="mt-3 pt-3 border-t border-pebble/50 space-y-2">
            {init.description && (
              <div>
                <p className="text-[11px] font-semibold text-steel uppercase tracking-wider mb-0.5">Description</p>
                <p className="text-xs text-midnight leading-relaxed">{init.description}</p>
              </div>
            )}
            {init.impact_metric && (
              <div>
                <p className="text-[11px] font-semibold text-steel uppercase tracking-wider mb-0.5">Impact Metric</p>
                <p className="text-xs text-midnight">{init.impact_metric}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Initiative Group (for themed or unthemed) ─────────────────────────────────
function InitiativeGroup({ label, initiatives }: { label?: string; initiatives: Initiative[] }) {
  if (initiatives.length === 0) return null;
  return (
    <div>
      {label && (
        <h3 className="text-xs font-semibold text-steel uppercase tracking-wider mb-3 flex items-center gap-2">
          <span className="w-4 h-px bg-pebble inline-block" />
          {label}
          <span className="w-4 h-px bg-pebble inline-block" />
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {initiatives.map(init => <InitiativeCard key={init.id} init={init} />)}
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
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [biz, { data: { user } }] = await Promise.all([
        apiFetch("/api/v1/businesses/my"),
        supabase.auth.getUser(),
      ]);
      if (!biz?.id) throw new Error("No business");
      setBusinessId(biz.id);

      const [tree, members] = await Promise.all([
        apiFetch(`/api/v1/programs/full-tree?business_id=${biz.id}`),
        apiFetch(`/api/v1/businesses/${biz.id}/members`),
      ]);

      const found = (Array.isArray(tree) ? tree : []).find((p: Program) => p.id === programId);
      if (!found) { setError("Program not found."); return; }
      setProgram(found);

      const myMember = (members as any[]).find((m: any) => m.user_id === user?.id);
      setCanEdit(myMember?.role === "owner" || myMember?.role === "admin" || biz.owner_id === user?.id);
    } catch { setError("Failed to load program."); }
    finally { setLoading(false); }
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  const totalInitiatives = program
    ? program.themes.reduce((a, t) => a + t.initiatives.length, 0) + program.unthemed_initiatives.length
    : 0;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
    </div>
  );
  if (error || !program) return (
    <div className="p-8 text-red-600">
      {error || "Program not found."}
      <button onClick={() => router.push("/programs")} className="ml-3 underline text-steel">← Back to Programs</button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <button
        onClick={() => router.push("/programs")}
        className="flex items-center gap-1.5 text-sm text-steel hover:text-midnight mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> All Programs
      </button>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-start gap-3">
          <div className="w-5 h-5 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: program.color }} />
          <div>
            <h1 className="text-2xl font-bold text-midnight">{program.name}</h1>
            {program.description && (
              <p className="text-steel text-sm mt-0.5 max-w-xl">{program.description}</p>
            )}
            <p className="text-xs text-steel/60 mt-1">
              {totalInitiatives} initiative{totalInitiatives !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90 flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Initiative
          </button>
        )}
      </div>

      {/* Initiatives */}
      {totalInitiatives === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-pebble">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mx-auto mb-3">
            <Plus className="w-6 h-6 text-steel/50" />
          </div>
          <p className="text-steel font-medium mb-1">No initiatives yet</p>
          <p className="text-sm text-steel/60 mb-5">
            Add an initiative to start breaking down this program into actionable goals.
          </p>
          {canEdit && (
            <button onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90">
              Add First Initiative
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Themed groups */}
          {program.themes.map(theme => (
            <InitiativeGroup key={theme.id} label={theme.name} initiatives={theme.initiatives} />
          ))}
          {/* Unthemed */}
          <InitiativeGroup
            label={program.themes.length > 0 ? "Other Initiatives" : undefined}
            initiatives={program.unthemed_initiatives}
          />
        </div>
      )}

      {showNew && (
        <NewInitiativeModal
          businessId={businessId}
          programId={programId}
          onClose={() => setShowNew(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
