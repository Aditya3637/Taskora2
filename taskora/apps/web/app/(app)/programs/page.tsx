"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";

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
  return res.json();
}

type Program = {
  id: string;
  name: string;
  description?: string;
  status: string;
  color?: string;
  lead_user?: { id: string; full_name?: string; email?: string };
  initiative_count?: number;
};

type Initiative = {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  completion_pct?: number;
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-blue-100 text-blue-700 border-blue-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
};

const PRESET_COLORS = ["#E53E3E", "#3182CE", "#38A169", "#D69E2E", "#805AD5", "#DD6B20"];

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_BADGE[status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProgramCard({
  program,
  onExpand,
  expanded,
  initiatives,
  loadingInits,
}: {
  program: Program;
  onExpand: (id: string) => void;
  expanded: boolean;
  initiatives: Initiative[];
  loadingInits: boolean;
}) {
  const color = program.color ?? "#E53E3E";
  return (
    <div className="bg-white rounded-xl border border-pebble shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-4 p-5 cursor-pointer hover:bg-mist/40 transition-colors"
        onClick={() => onExpand(program.id)}
      >
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-semibold text-midnight text-sm">{program.name}</h3>
            <StatusBadge status={program.status} />
          </div>
          {program.description && (
            <p className="text-xs text-steel mt-1 line-clamp-1">{program.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-steel">
            {program.lead_user && (
              <span>Lead: <span className="text-midnight font-medium">{program.lead_user.full_name ?? program.lead_user.email}</span></span>
            )}
            {program.initiative_count !== undefined && (
              <span>{program.initiative_count} initiative{program.initiative_count !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
        <div className="text-steel flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-pebble bg-mist/30 px-5 py-4">
          {loadingInits ? (
            <div className="flex items-center gap-2 text-sm text-steel">
              <div className="w-4 h-4 border-2 border-pebble border-t-taskora-red rounded-full animate-spin" />
              Loading initiatives…
            </div>
          ) : initiatives.length === 0 ? (
            <p className="text-sm text-steel italic">No initiatives yet.</p>
          ) : (
            <ul className="space-y-2">
              {initiatives.map((init) => (
                <li key={init.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-2.5 border border-pebble text-sm">
                  <div className="flex-1">
                    <span className="font-medium text-midnight">{init.name ?? init.title}</span>
                    {init.status && (
                      <span className="ml-2 text-xs text-steel">· {init.status}</span>
                    )}
                  </div>
                  {init.completion_pct !== undefined && (
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-pebble rounded-full overflow-hidden">
                        <div className="h-full bg-taskora-red rounded-full" style={{ width: `${init.completion_pct}%` }} />
                      </div>
                      <span className="text-xs text-steel font-mono">{Math.round(init.completion_pct)}%</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NewProgramModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: () => void }) {
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
        body: JSON.stringify({ name: name.trim(), description: description.trim(), color, business_id: businessId }),
      });
      onCreated();
      onClose();
    } catch {
      setError("Failed to create program. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-midnight">New Program</h2>
          <button onClick={onClose} className="text-steel hover:text-midnight transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Name *</label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm text-midnight focus:outline-none focus:ring-2 focus:ring-taskora-red/30 focus:border-taskora-red"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product Launch Q3"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Description</label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm text-midnight focus:outline-none focus:ring-2 focus:ring-taskora-red/30 focus:border-taskora-red resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this program about?"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">Color</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? "border-midnight scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-pebble text-sm font-medium text-steel hover:bg-mist transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create Program"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [initiativesMap, setInitiativesMap] = useState<Record<string, Initiative[]>>({});
  const [loadingInitsFor, setLoadingInitsFor] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const businesses = await apiFetch("/api/v1/businesses/my");
      const biz = Array.isArray(businesses) ? businesses[0] : businesses;
      if (!biz?.id) throw new Error("No business found");
      setBusinessId(biz.id);
      const data = await apiFetch(`/api/v1/programs/?business_id=${biz.id}`);
      setPrograms(Array.isArray(data) ? data : data.results ?? []);
    } catch {
      setError("Failed to load programs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!initiativesMap[id]) {
      setLoadingInitsFor(id);
      try {
        const data = await apiFetch(`/api/v1/programs/${id}/initiatives`);
        setInitiativesMap((prev) => ({ ...prev, [id]: Array.isArray(data) ? data : data.results ?? [] }));
      } catch {
        setInitiativesMap((prev) => ({ ...prev, [id]: [] }));
      } finally {
        setLoadingInitsFor(null);
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-red-600">
        {error} <button onClick={load} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Programs</h1>
          <p className="text-steel text-sm mt-1">Organize your work into programs and initiatives</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Program
        </button>
      </div>

      {programs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-pebble">
          <p className="text-steel mb-4">No programs yet. Create your first program to get started.</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            New Program
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              onExpand={handleExpand}
              expanded={expandedId === p.id}
              initiatives={initiativesMap[p.id] ?? []}
              loadingInits={loadingInitsFor === p.id}
            />
          ))}
        </div>
      )}

      {showModal && businessId && (
        <NewProgramModal
          businessId={businessId}
          onClose={() => setShowModal(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
