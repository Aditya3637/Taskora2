"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || (session.expires_at ?? 0) < Math.floor(Date.now() / 1000) + 30) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const STAGES = ["lead", "demo", "trial", "negotiation", "won", "lost"] as const;
type Stage = typeof STAGES[number];

const STAGE_COLORS: Record<Stage, string> = {
  lead: "bg-blue-100 text-blue-700",
  demo: "bg-purple-100 text-purple-700",
  trial: "bg-amber-100 text-amber-700",
  negotiation: "bg-orange-100 text-orange-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-gray-100 text-gray-500",
};

type Lead = { id: string; company_name: string; contact_name?: string; contact_email?: string; stage: Stage; mrr: number; notes?: string };
type Tenant = { id: string; name: string; owner_email: string; member_count: number; plan: string; status: string; created_at: string };
type Metrics = { mrr: number; arr: number; active_subscriptions: number };

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function AdminPage() {
  const [tab, setTab] = useState<"tenants" | "pipeline" | "metrics">("tenants");
  const [forbidden, setForbidden] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [search, setSearch] = useState("");
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLead, setNewLead] = useState({ company_name: "", contact_name: "", contact_email: "", stage: "lead" as Stage, mrr: 0, notes: "" });

  useEffect(() => {
    apiFetch("/api/v1/admin/metrics/revenue")
      .then(d => setMetrics(d))
      .catch(e => { if (e.message === "403") setForbidden(true); });
    apiFetch("/api/v1/admin/tenants").then(setTenants).catch(() => {});
    apiFetch("/api/v1/admin/sales-leads").then(setLeads).catch(() => {});
  }, []);

  if (forbidden) {
    return (
      <div className="max-w-lg mx-auto px-4 py-24 text-center">
        <p className="text-6xl mb-4">🔒</p>
        <h2 className="text-xl font-bold text-midnight mb-2">Access Denied</h2>
        <p className="text-steel text-sm">Admin access required</p>
      </div>
    );
  }

  async function updateLeadStage(id: string, stage: Stage) {
    await apiFetch(`/api/v1/admin/sales-leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l));
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault();
    const created = await apiFetch("/api/v1/admin/sales-leads", { method: "POST", body: JSON.stringify(newLead) });
    setLeads(prev => [created, ...prev]);
    setShowAddLead(false);
    setNewLead({ company_name: "", contact_name: "", contact_email: "", stage: "lead", mrr: 0, notes: "" });
  }

  async function deleteLead(id: string) {
    if (!confirm("Delete this lead?")) return;
    await apiFetch(`/api/v1/admin/sales-leads/${id}`, { method: "DELETE" });
    setLeads(prev => prev.filter(l => l.id !== id));
  }

  const totalPipeline = leads.filter(l => l.stage !== "lost").reduce((s, l) => s + l.mrr, 0);
  const filteredTenants = tenants.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.owner_email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-midnight">🛡️ Platform Admin</h1>
        {metrics && (
          <div className="flex gap-4 text-sm">
            <div className="bg-green-50 border border-green-200 px-4 py-2 rounded-lg">
              <span className="text-green-700 font-bold">{fmtInr(metrics.mrr)}</span>
              <span className="text-green-600 ml-1">MRR</span>
            </div>
            <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg">
              <span className="text-blue-700 font-bold">{metrics.active_subscriptions}</span>
              <span className="text-blue-600 ml-1">Active</span>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {([["tenants", "🏢 Tenants"], ["pipeline", "💼 Sales Pipeline"], ["metrics", "📊 Metrics"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-midnight text-white" : "bg-white border border-pebble text-steel hover:text-midnight"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tenants */}
      {tab === "tenants" && (
        <div>
          <div className="mb-4">
            <input type="text" placeholder="Search by company or email…" value={search} onChange={e => setSearch(e.target.value)}
              className="h-10 px-4 border border-pebble rounded-lg text-sm w-full max-w-sm focus:outline-none focus:border-ocean" />
          </div>
          <div className="bg-white rounded-xl border border-pebble overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-mist">
                <tr>{["Company", "Owner", "Members", "Plan", "Status", "Joined"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-steel uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-pebble">
                {filteredTenants.map(t => (
                  <tr key={t.id} className="hover:bg-mist/50">
                    <td className="px-4 py-3 font-medium text-midnight">{t.name}</td>
                    <td className="px-4 py-3 text-steel">{t.owner_email}</td>
                    <td className="px-4 py-3 text-steel text-center">{t.member_count}</td>
                    <td className="px-4 py-3">
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium capitalize">{t.plan}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${t.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-steel text-xs">{t.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales Pipeline Kanban */}
      {tab === "pipeline" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-steel">Pipeline value: <span className="font-bold text-midnight">{fmtInr(totalPipeline)}</span></div>
            <button onClick={() => setShowAddLead(true)}
              className="h-9 px-4 bg-midnight text-white text-sm font-medium rounded-lg hover:opacity-90">
              + Add Lead
            </button>
          </div>
          <div className="grid grid-cols-6 gap-3 overflow-x-auto">
            {STAGES.map(stage => {
              const stageLeads = leads.filter(l => l.stage === stage);
              return (
                <div key={stage} className="min-w-[160px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STAGE_COLORS[stage]}`}>{stage}</span>
                    <span className="text-xs text-steel">{stageLeads.length}</span>
                  </div>
                  <div className="space-y-2">
                    {stageLeads.map(lead => (
                      <div key={lead.id} className="bg-white border border-pebble rounded-lg p-3 shadow-sm group">
                        <p className="font-medium text-midnight text-sm leading-tight">{lead.company_name}</p>
                        {lead.contact_name && <p className="text-xs text-steel mt-0.5">{lead.contact_name}</p>}
                        {lead.mrr > 0 && <p className="text-xs font-bold text-green-600 mt-1">{fmtInr(lead.mrr)}/mo</p>}
                        {lead.notes && <p className="text-xs text-steel mt-1 italic line-clamp-2">{lead.notes}</p>}
                        <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {STAGES.filter(s => s !== stage).map(s => (
                            <button key={s} onClick={() => updateLeadStage(lead.id, s)}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STAGE_COLORS[s]}`}>{s}</button>
                          ))}
                          <button onClick={() => deleteLead(lead.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium ml-auto">✕</button>
                        </div>
                      </div>
                    ))}
                    {stageLeads.length === 0 && (
                      <div className="border-2 border-dashed border-pebble rounded-lg p-3 text-center text-xs text-steel/50">Empty</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metrics */}
      {tab === "metrics" && metrics && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "MRR", value: fmtInr(metrics.mrr), color: "text-green-600" },
            { label: "ARR", value: fmtInr(metrics.arr), color: "text-blue-600" },
            { label: "Active Subscriptions", value: String(metrics.active_subscriptions), color: "text-midnight" },
          ].map(m => (
            <div key={m.label} className="bg-white border border-pebble rounded-xl p-6 text-center">
              <p className={`text-3xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-xs text-steel mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddLead(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-midnight mb-4">Add Sales Lead</h3>
            <form onSubmit={createLead} className="space-y-3">
              {[["company_name", "Company Name", "text", true], ["contact_name", "Contact Name", "text", false], ["contact_email", "Contact Email", "email", false]].map(([k, label, type, req]) => (
                <div key={k as string}>
                  <label className="text-xs text-steel font-medium mb-1 block">{label as string}</label>
                  <input type={type as string} required={req as boolean}
                    value={(newLead as any)[k as string]}
                    onChange={e => setNewLead(prev => ({ ...prev, [k as string]: e.target.value }))}
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Stage</label>
                <select value={newLead.stage} onChange={e => setNewLead(prev => ({ ...prev, stage: e.target.value as Stage }))}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                  {STAGES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">MRR (₹)</label>
                <input type="number" value={newLead.mrr} min={0}
                  onChange={e => setNewLead(prev => ({ ...prev, mrr: Number(e.target.value) }))}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Notes</label>
                <textarea value={newLead.notes} onChange={e => setNewLead(prev => ({ ...prev, notes: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border border-pebble rounded-lg text-sm focus:outline-none resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddLead(false)}
                  className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel">Cancel</button>
                <button type="submit"
                  className="flex-1 h-10 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">Add Lead</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
