"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Session expired.");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.status === 204 ? null : res.json();
}

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN")}`;

// ── types ────────────────────────────────────────────────────────────────
const STAGES = ["lead", "demo", "trial", "negotiation", "won", "lost"] as const;
type Stage = typeof STAGES[number];
const STAGE_COLORS: Record<Stage, string> = {
  lead: "bg-blue-100 text-blue-700", demo: "bg-purple-100 text-purple-700",
  trial: "bg-amber-100 text-amber-700", negotiation: "bg-orange-100 text-orange-700",
  won: "bg-green-100 text-green-700", lost: "bg-gray-100 text-gray-500",
};
type Lead = { id: string; company_name: string; contact_name?: string; contact_email?: string; stage: Stage; mrr: number; notes?: string };
type Tenant = { id: string; name: string; owner_email: string; member_count: number; plan: string; status: string; trial_end?: string; created_at: string };
type Accounts = { total_users: number; total_accounts: number; paying_accounts: number; trialing_accounts: number; past_due_accounts: number; paid_seats: number; avg_seats_per_paying_account: number; users_per_paying_account: number; mrr: number; arr: number };
type Revenue = { mrr: number; arr: number; active_subscriptions: number; plan_breakdown: Record<string, number> };
type ActionItem = { id: string; label: string; sub?: string; amount_inr?: number };
type ActionGroup = { key: string; severity: "critical" | "high" | "medium" | "low"; icon: string; title: string; count: number; amount_inr: number; items: ActionItem[]; cta_label?: string; cta_tab?: string };
type Queue = { groups: ActionGroup[]; total_actions: number };

type Section = "overview" | "accounts" | "revenue" | "pipeline";

const SEV: Record<ActionGroup["severity"], { bar: string; chip: string; ring: string }> = {
  critical: { bar: "bg-red-500", chip: "bg-red-100 text-red-700", ring: "border-red-200" },
  high: { bar: "bg-orange-500", chip: "bg-orange-100 text-orange-700", ring: "border-orange-200" },
  medium: { bar: "bg-amber-400", chip: "bg-amber-100 text-amber-800", ring: "border-amber-200" },
  low: { bar: "bg-blue-400", chip: "bg-blue-100 text-blue-700", ring: "border-blue-200" },
};

function Kpi({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-taskora-red/40 bg-red-50" : "border-pebble bg-white"}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${accent ? "text-taskora-red" : "text-midnight"}`}>{value}</p>
      {sub && <p className="text-[11px] text-steel/70 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [forbidden, setForbidden] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [rev, setRev] = useState<Revenue | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLead, setNewLead] = useState({ company_name: "", contact_name: "", contact_email: "", stage: "lead" as Stage, mrr: 0, notes: "" });

  const reload = useCallback(async () => {
    const get = async <T,>(p: string, set: (v: T) => void) => {
      try { set(await apiFetch(p)); } catch (e: any) { if (e.message === "403") setForbidden(true); }
    };
    await Promise.allSettled([
      get<Accounts>("/api/v1/admin/metrics/accounts", setAcc),
      get<Revenue>("/api/v1/admin/metrics/revenue", setRev),
      get<Queue>("/api/v1/admin/action-queue", setQueue),
      get<Tenant[]>("/api/v1/admin/tenants", setTenants),
      get<Lead[]>("/api/v1/admin/sales-leads", setLeads),
    ]);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // lead ops
  const updateLeadStage = async (id: string, stage: Stage) => {
    await apiFetch(`/api/v1/admin/sales-leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    setLeads((p) => p.map((l) => (l.id === id ? { ...l, stage } : l)));
    void reload();
  };
  const createLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await apiFetch("/api/v1/admin/sales-leads", { method: "POST", body: JSON.stringify(newLead) });
    setLeads((p) => [created, ...p]); setShowAddLead(false);
    setNewLead({ company_name: "", contact_name: "", contact_email: "", stage: "lead", mrr: 0, notes: "" });
  };
  const deleteLead = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    await apiFetch(`/api/v1/admin/sales-leads/${id}`, { method: "DELETE" });
    setLeads((p) => p.filter((l) => l.id !== id));
  };
  const extendTrial = async (id: string, days: number) => {
    await apiFetch(`/api/v1/admin/accounts/${id}/extend-trial`, { method: "POST", body: JSON.stringify({ days }) });
    await reload();
  };

  const openItem = (group: ActionGroup, item: ActionItem) => {
    if (group.key === "stale_leads") setSection("pipeline");
    else { setSelected(item.id); setSection("accounts"); }
  };

  if (forbidden) {
    return (
      <div className="max-w-lg mx-auto px-4 py-24 text-center">
        <p className="text-6xl mb-4">🔒</p>
        <h2 className="text-xl font-bold text-midnight mb-2">Access Denied</h2>
        <p className="text-steel text-sm">Admin access required</p>
      </div>
    );
  }

  const NAV: { key: Section; label: string; icon: string }[] = [
    { key: "overview", label: "Overview", icon: "🏠" },
    { key: "accounts", label: "Accounts", icon: "🏢" },
    { key: "revenue", label: "Revenue", icon: "💰" },
    { key: "pipeline", label: "Pipeline", icon: "💼" },
  ];

  const selectedTenant = tenants.find((t) => t.id === selected) || null;
  const filteredTenants = tenants.filter((t) =>
    (t.name + t.owner_email).toLowerCase().includes(search.toLowerCase()) &&
    (!statusFilter || t.status === statusFilter));
  const atRisk = queue?.groups.find((g) => g.key === "payments_failed");

  return (
    <div className="flex min-h-[calc(100vh-1rem)] bg-bg">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 border-r border-pebble bg-white p-3 flex flex-col">
        <div className="px-2 py-2 mb-2">
          <p className="text-sm font-bold text-midnight">🛡 Platform Admin</p>
          {acc && <p className="text-[11px] text-steel mt-0.5">{inr(acc.mrr)} MRR · {acc.paying_accounts} paying</p>}
        </div>
        {NAV.map((n) => (
          <button key={n.key} onClick={() => setSection(n.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium mb-0.5 flex items-center gap-2 transition-colors ${section === n.key ? "bg-midnight text-white" : "text-steel hover:bg-pebble/50 hover:text-midnight"}`}>
            <span>{n.icon}</span>{n.label}
            {n.key === "overview" && queue && queue.total_actions > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-taskora-red text-white rounded-full px-1.5 py-0.5">{queue.total_actions}</span>
            )}
          </button>
        ))}
        <div className="border-t border-pebble my-2" />
        <a href="/admin/lifecycle" className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-steel hover:bg-pebble/50 hover:text-midnight flex items-center gap-2">
          ⚡ Lifecycle <span className="ml-auto text-steel/40">↗</span>
        </a>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 p-6 overflow-x-hidden">
        {/* OVERVIEW */}
        {section === "overview" && (
          <div className="space-y-6">
            <h1 className="text-xl font-bold text-midnight">Overview</h1>
            {acc && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="MRR" value={inr(acc.mrr)} sub={`${inr(acc.arr)} ARR`} />
                <Kpi label="Paying accounts" value={acc.paying_accounts} sub="← sales / logos" accent />
                <Kpi label="Trialing" value={acc.trialing_accounts} sub="in trial" />
                <Kpi label="Past due" value={acc.past_due_accounts} sub={atRisk ? `${inr(atRisk.amount_inr)} at risk` : "—"} accent={acc.past_due_accounts > 0} />
                <Kpi label="Paid seats" value={acc.paid_seats} sub={`${acc.avg_seats_per_paying_account} avg/acct`} />
                <Kpi label="Users" value={acc.total_users} sub="headcount, not sales" />
              </div>
            )}

            {/* Action Center */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-bold text-midnight">Action center</h2>
                {queue && <span className="text-xs text-steel">{queue.total_actions} item{queue.total_actions === 1 ? "" : "s"} need you</span>}
                <button onClick={() => reload()} className="ml-auto text-xs text-steel hover:text-midnight">↻ Refresh</button>
              </div>
              {queue && queue.groups.length === 0 ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center text-green-700 text-sm font-medium">✓ All clear — nothing needs you right now.</div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {queue?.groups.map((g) => {
                    const s = SEV[g.severity];
                    return (
                      <div key={g.key} className={`rounded-xl border ${s.ring} bg-white overflow-hidden flex`}>
                        <div className={`w-1.5 ${s.bar}`} />
                        <div className="flex-1 p-4 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">{g.icon}</span>
                            <span className="font-semibold text-midnight text-sm">{g.title}</span>
                            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${s.chip}`}>{g.count}</span>
                            {g.amount_inr > 0 && <span className="text-xs font-bold text-taskora-red ml-auto">{inr(g.amount_inr)}</span>}
                          </div>
                          <ul className="space-y-1 mb-2">
                            {g.items.map((it) => (
                              <li key={it.id}>
                                <button onClick={() => openItem(g, it)} className="w-full text-left flex items-baseline gap-2 px-2 py-1 rounded hover:bg-pebble/40">
                                  <span className="text-sm text-midnight truncate">{it.label}</span>
                                  {it.sub && <span className="text-[11px] text-steel/70 truncate ml-auto flex-shrink-0">{it.sub}</span>}
                                </button>
                              </li>
                            ))}
                            {g.count > g.items.length && <li className="text-[11px] text-steel/60 px-2">+ {g.count - g.items.length} more</li>}
                          </ul>
                          {g.cta_label && g.cta_tab && (
                            <button onClick={() => setSection(g.cta_tab as Section)} className="text-xs font-semibold text-ocean hover:underline">{g.cta_label} →</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ACCOUNTS */}
        {section === "accounts" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-midnight">Accounts</h1>
            <div className="flex gap-2 flex-wrap">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or owner…"
                className="h-9 px-3 border border-pebble rounded-lg text-sm w-64 focus:outline-none focus:border-ocean" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 border border-pebble rounded-lg text-sm bg-white">
                <option value="">All statuses</option>
                {["trialing", "active", "past_due", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-xs text-steel self-center ml-auto">{filteredTenants.length} of {tenants.length}</span>
            </div>
            <div className="bg-white rounded-xl border border-pebble overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-mist">
                  <tr>{["Company", "Owner", "Seats", "Plan", "Status", "Trial ends", "Created"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold text-steel uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-pebble">
                  {filteredTenants.map((t) => (
                    <tr key={t.id} onClick={() => setSelected(t.id)} className="hover:bg-mist/60 cursor-pointer">
                      <td className="px-4 py-2.5 font-medium text-midnight">{t.name || "—"}</td>
                      <td className="px-4 py-2.5 text-steel truncate max-w-[180px]">{t.owner_email}</td>
                      <td className="px-4 py-2.5 text-center">{t.member_count}</td>
                      <td className="px-4 py-2.5"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs capitalize">{t.plan}</span></td>
                      <td className="px-4 py-2.5"><StatusChip s={t.status} /></td>
                      <td className="px-4 py-2.5 text-steel text-xs">{t.trial_end?.slice(0, 10) ?? "—"}</td>
                      <td className="px-4 py-2.5 text-steel text-xs">{t.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* REVENUE */}
        {section === "revenue" && (
          <div className="space-y-6">
            <h1 className="text-xl font-bold text-midnight">Revenue</h1>
            {rev && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi label="MRR" value={inr(rev.mrr)} />
                <Kpi label="ARR" value={inr(rev.arr)} />
                <Kpi label="Active subs" value={rev.active_subscriptions} />
                <Kpi label="At risk" value={atRisk ? inr(atRisk.amount_inr) : inr(0)} sub={`${acc?.past_due_accounts ?? 0} accounts`} accent={(atRisk?.amount_inr ?? 0) > 0} />
              </div>
            )}
            {rev && (
              <section>
                <h2 className="text-sm font-bold text-midnight mb-2">Plan mix</h2>
                <div className="flex gap-3">
                  {Object.entries(rev.plan_breakdown).map(([p, n]) => (
                    <div key={p} className="rounded-lg border border-pebble bg-white px-4 py-2">
                      <span className="text-xs text-steel capitalize">{p}</span>
                      <span className="ml-2 font-bold text-midnight">{n}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="text-sm font-bold text-midnight mb-2">Past-due accounts (recover)</h2>
              {!atRisk || atRisk.items.length === 0 ? (
                <p className="text-sm text-steel/60 italic">No past-due accounts. 🎉</p>
              ) : (
                <div className="bg-white rounded-xl border border-pebble divide-y divide-pebble">
                  {atRisk.items.map((it) => (
                    <button key={it.id} onClick={() => { setSelected(it.id); setSection("accounts"); }} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-mist/60">
                      <span className="font-medium text-midnight text-sm flex-1 truncate">{it.label}</span>
                      <span className="text-xs text-steel">{it.sub}</span>
                      <span className="text-sm font-bold text-taskora-red">{inr(it.amount_inr ?? 0)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* PIPELINE */}
        {section === "pipeline" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-midnight">Pipeline</h1>
              <button onClick={() => setShowAddLead(true)} className="h-9 px-4 bg-midnight text-white text-sm font-medium rounded-lg hover:opacity-90">+ Add lead</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {STAGES.map((stage) => {
                const stageLeads = leads.filter((l) => l.stage === stage);
                return (
                  <div key={stage} className="min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${STAGE_COLORS[stage]}`}>{stage}</span>
                      <span className="text-xs text-steel">{stageLeads.length}</span>
                    </div>
                    <div className="space-y-2">
                      {stageLeads.map((lead) => (
                        <div key={lead.id} className="bg-white border border-pebble rounded-lg p-3 shadow-sm group">
                          <p className="font-medium text-midnight text-sm leading-tight">{lead.company_name}</p>
                          {lead.contact_name && <p className="text-xs text-steel mt-0.5">{lead.contact_name}</p>}
                          {lead.mrr > 0 && <p className="text-xs font-bold text-green-600 mt-1">{inr(lead.mrr)}/mo</p>}
                          {lead.notes && <p className="text-xs text-steel mt-1 italic line-clamp-2">{lead.notes}</p>}
                          <div className="flex flex-wrap items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {STAGES.filter((s) => s !== stage).map((s) => (
                              <button key={s} onClick={() => updateLeadStage(lead.id, s)} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STAGE_COLORS[s]}`}>{s}</button>
                            ))}
                            <button onClick={() => deleteLead(lead.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium ml-auto">✕</button>
                          </div>
                        </div>
                      ))}
                      {stageLeads.length === 0 && <div className="border-2 border-dashed border-pebble rounded-lg p-3 text-center text-xs text-steel/50">Empty</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Account drawer */}
      {selectedTenant && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-midnight">{selectedTenant.name || "Untitled"}</h3>
                <p className="text-xs text-steel">{selectedTenant.owner_email}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-steel/60 hover:text-midnight">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <Kpi label="Plan" value={selectedTenant.plan} />
              <Kpi label="Status" value={selectedTenant.status} accent={selectedTenant.status === "past_due"} />
              <Kpi label="Seats" value={selectedTenant.member_count} />
              <Kpi label="Trial ends" value={selectedTenant.trial_end?.slice(0, 10) ?? "—"} />
            </div>
            <div className="border-t border-pebble pt-4">
              <p className="text-xs font-bold text-steel uppercase tracking-wide mb-2">Actions</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => extendTrial(selectedTenant.id, 14)} className="px-3 py-1.5 border border-pebble rounded-lg text-sm text-steel hover:text-midnight hover:bg-mist">Extend trial +14d</button>
                <button onClick={() => extendTrial(selectedTenant.id, 30)} className="px-3 py-1.5 border border-pebble rounded-lg text-sm text-steel hover:text-midnight hover:bg-mist">Extend trial +30d</button>
              </div>
              <p className="text-[11px] text-steel/60 mt-3">Created {selectedTenant.created_at?.slice(0, 10)}.</p>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead modal */}
      {showAddLead && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddLead(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-midnight mb-4">Add sales lead</h3>
            <form onSubmit={createLead} className="space-y-3">
              {([["company_name", "Company name", "text", true], ["contact_name", "Contact name", "text", false], ["contact_email", "Contact email", "email", false]] as const).map(([k, label, type, req]) => (
                <div key={k}>
                  <label className="text-xs text-steel font-medium mb-1 block">{label}</label>
                  <input type={type} required={req} value={(newLead as any)[k]} onChange={(e) => setNewLead((p) => ({ ...p, [k]: e.target.value }))}
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none" />
                </div>
              ))}
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Stage</label>
                <select value={newLead.stage} onChange={(e) => setNewLead((p) => ({ ...p, stage: e.target.value as Stage }))} className="w-full h-10 px-3 border border-pebble rounded-lg text-sm">
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">MRR (₹)</label>
                <input type="number" min={0} value={newLead.mrr} onChange={(e) => setNewLead((p) => ({ ...p, mrr: Number(e.target.value) }))} className="w-full h-10 px-3 border border-pebble rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Notes</label>
                <textarea value={newLead.notes} onChange={(e) => setNewLead((p) => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-pebble rounded-lg text-sm resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddLead(false)} className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel">Cancel</button>
                <button type="submit" className="flex-1 h-10 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">Add lead</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ s }: { s: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700", trialing: "bg-blue-100 text-blue-700",
    past_due: "bg-red-100 text-red-700", cancelled: "bg-gray-100 text-gray-500",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${map[s] ?? "bg-gray-100 text-gray-500"}`}>{s?.replace("_", " ")}</span>;
}
