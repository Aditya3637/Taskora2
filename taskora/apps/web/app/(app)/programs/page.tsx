"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronRight } from "lucide-react";
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

type Program = {
  id: string; name: string; status: string; color: string; description?: string;
  themes: { id: string; initiatives: { id: string }[] }[];
  unthemed_initiatives: { id: string }[];
};

const STATUS_COLOR: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  paused:    "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  archived:  "bg-gray-100 text-gray-500",
};

const PRESET_COLORS = ["#E53E3E","#3182CE","#38A169","#D69E2E","#805AD5","#DD6B20","#6366F1","#EC4899"];

function initiativeCount(p: Program) {
  return p.themes.reduce((acc, t) => acc + t.initiatives.length, 0) + p.unthemed_initiatives.length;
}

// ── New Program Modal ────────────────────────────────────────────────────────
function NewProgramModal({ businessId, onClose, onCreated }: {
  businessId: string; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      await apiFetch("/api/v1/programs/", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, color, business_id: businessId }),
      });
      onCreated(); onClose();
    } catch { setError("Failed to create program."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-midnight">New Program</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-steel" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Program Name *</label>
            <input
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Operations, HR, Accounts" required autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Description</label>
            <textarea
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2} value={description} onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? "border-midnight scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-pebble text-sm text-steel hover:bg-mist">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? "Creating…" : "Create Program"}
            </button>
          </div>
        </form>
      </div>
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
      setPrograms(Array.isArray(tree) ? tree : []);
      const myMember = (members as any[]).find((m: any) => m.user_id === user?.id);
      setCanEdit(myMember?.role === "owner" || myMember?.role === "admin" || biz.owner_id === user?.id);
    } catch { setError("Failed to load programs."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
    </div>
  );
  if (error) return (
    <div className="p-8 text-red-600">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Programs</h1>
          <p className="text-steel text-sm mt-1">Click a program to view and manage its initiatives.</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90">
            <Plus className="w-4 h-4" /> New Program
          </button>
        )}
      </div>

      {programs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-pebble">
          <p className="text-steel mb-2 font-medium">No programs yet.</p>
          <p className="text-sm text-steel/70 mb-4">Create a program like HR, Operations, or Accounts to get started.</p>
          {canEdit && (
            <button onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-taskora-red text-white rounded-lg text-sm font-semibold hover:opacity-90">
              Create First Program
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {programs.map(p => {
            const count = initiativeCount(p);
            return (
              <button
                key={p.id}
                onClick={() => router.push(`/programs/${p.id}`)}
                className="text-left bg-white rounded-xl border border-pebble shadow-sm hover:shadow-md hover:border-ocean/30 transition-all p-5 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                    <h3 className="font-bold text-midnight group-hover:text-ocean transition-colors">{p.name}</h3>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[p.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {p.status}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-steel line-clamp-2 mb-3">{p.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-steel/70 font-medium">
                    {count} initiative{count !== 1 ? "s" : ""}
                  </span>
                  <ChevronRight className="w-4 h-4 text-steel/40 group-hover:text-ocean transition-colors" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showNew && businessId && (
        <NewProgramModal businessId={businessId} onClose={() => setShowNew(false)} onCreated={load} />
      )}
    </div>
  );
}
