"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired.");
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
  return res.status === 204 ? null : res.json();
}

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN")}`;

type Accounts = {
  total_users: number; total_accounts: number; paying_accounts: number;
  trialing_accounts: number; past_due_accounts: number; paid_seats: number;
  avg_seats_per_paying_account: number; users_per_paying_account: number;
  mrr: number; arr: number;
};
type Overview = {
  messages_30d: { by_status: Record<string, number>; by_template: Record<string, Record<string, number>>; total: number };
  revenue_at_risk_inr: number; past_due_accounts: number; trials_ending_7d: number;
  job_health: Record<string, number>;
};
type Campaign = { campaign: string; enabled: boolean };
type AtRisk = { business_id: string; name: string; plan: string; mrr_inr: number; seats: number; days_past_due: number | null; last_dunning: string | null };
type Message = { id: string; ts: string; template: string; channel: string; status: string; campaign?: string; business_id?: string };

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-taskora-red/40 bg-red-50" : "border-pebble bg-white"}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-steel">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${accent ? "text-taskora-red" : "text-midnight"}`}>{value}</p>
      {sub && <p className="text-[11px] text-steel/70 mt-0.5">{sub}</p>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  suppressed: "bg-gray-100 text-gray-500",
  skipped: "bg-amber-100 text-amber-700",
};

export default function LifecyclePage() {
  const [forbidden, setForbidden] = useState(false);
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [atRisk, setAtRisk] = useState<AtRisk[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    // Independent fetches: the accounts band needs only existing tables, so
    // it renders even before the automation migration (045) is applied —
    // the lifecycle tables simply stay empty until then.
    const get = async <T,>(path: string, set: (v: T) => void) => {
      try { set(await apiFetch(path)); }
      catch (e: any) { if (e.message === "403") setForbidden(true); }
    };
    await Promise.allSettled([
      get<Accounts>("/api/v1/admin/metrics/accounts", setAcc),
      get<Overview>("/api/v1/admin/lifecycle/overview", setOv),
      get<Campaign[]>("/api/v1/admin/lifecycle/campaigns", setCamps),
      get<AtRisk[]>("/api/v1/admin/lifecycle/at-risk", setAtRisk),
      get<Message[]>("/api/v1/admin/lifecycle/messages?limit=50", setMsgs),
    ]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (campaign: string, enabled: boolean) => {
    setCamps((prev) => prev.map((c) => c.campaign === campaign ? { ...c, enabled } : c));
    await apiFetch(`/api/v1/admin/lifecycle/campaigns/${campaign}`, {
      method: "POST", body: JSON.stringify({ enabled }),
    }).catch(() => void load());
  };

  const runNow = async () => {
    setRunning(true);
    try { await apiFetch("/api/v1/admin/lifecycle/run", { method: "POST" }); await load(); }
    finally { setRunning(false); }
  };

  if (forbidden) {
    return <div className="p-10 text-center text-steel">Admin access required.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <a href="/admin" className="text-xs text-steel hover:text-midnight">← Admin</a>
          <h1 className="text-xl font-bold text-midnight mt-1">Lifecycle &amp; Growth</h1>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="px-3 py-1.5 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
        >
          {running ? "Running…" : "Run automation now"}
        </button>
      </div>

      {/* Accounts vs users — the "100 users ≠ 100 sales" truth */}
      <section>
        <h2 className="text-sm font-bold text-midnight mb-1">Accounts, seats &amp; sales</h2>
        <p className="text-xs text-steel/70 mb-3">
          The billing unit is the <b>workspace</b>. A company is one account with many seats — one sale, not one per employee.
        </p>
        {acc && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Users (headcount)" value={acc.total_users} sub="people — not sales" />
            <Stat label="Accounts" value={acc.total_accounts} sub="workspaces" />
            <Stat label="Paying accounts" value={acc.paying_accounts} sub="← actual sales / logos" accent />
            <Stat label="Paid seats" value={acc.paid_seats} sub={`${acc.avg_seats_per_paying_account} avg/account`} />
            <Stat label="MRR" value={inr(acc.mrr)} sub={`${inr(acc.arr)} ARR`} />
            <Stat label="Users / sale" value={acc.users_per_paying_account} sub="headcount ÷ paying accounts" />
          </div>
        )}
      </section>

      {/* Automation overview */}
      <section>
        <h2 className="text-sm font-bold text-midnight mb-3">Automation health</h2>
        {ov && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Messages (30d)" value={ov.messages_30d.total} sub={`${ov.messages_30d.by_status.sent ?? 0} sent · ${ov.messages_30d.by_status.failed ?? 0} failed`} />
            <Stat label="Revenue at risk" value={inr(ov.revenue_at_risk_inr)} sub={`${ov.past_due_accounts} past-due accounts`} accent={ov.revenue_at_risk_inr > 0} />
            <Stat label="Trials ending (7d)" value={ov.trials_ending_7d} sub="reminder window" />
            <Stat label="Jobs" value={`${ov.job_health.pending ?? 0} / ${ov.job_health.failed ?? 0}`} sub="pending / failed" accent={(ov.job_health.failed ?? 0) > 0} />
          </div>
        )}
      </section>

      {/* Campaign switches */}
      <section>
        <h2 className="text-sm font-bold text-midnight mb-3">Campaigns</h2>
        <div className="space-y-2">
          {camps.map((c) => (
            <div key={c.campaign} className="flex items-center justify-between bg-white border border-pebble rounded-lg px-4 py-2.5">
              <div>
                <span className="text-sm font-medium text-midnight capitalize">{c.campaign}</span>
                <span className="text-xs text-steel/70 ml-2">
                  {c.campaign === "trial" && "Trial-end reminders (T-7 / T-3 / T-1 / expired)"}
                  {c.campaign === "dunning" && "Failed-payment recovery (day 0 / 3 / 7)"}
                  {c.campaign === "activation" && "New-account nudges (first initiative / invite team)"}
                </span>
              </div>
              <button
                onClick={() => toggle(c.campaign, !c.enabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${c.enabled ? "bg-green-500" : "bg-gray-300"}`}
                aria-pressed={c.enabled}
                aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.campaign}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full transition-all ${c.enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* At-risk money board */}
      <section>
        <h2 className="text-sm font-bold text-midnight mb-3">Revenue at risk (past-due accounts)</h2>
        {atRisk.length === 0 ? (
          <p className="text-sm text-steel/60 italic">No past-due accounts. 🎉</p>
        ) : (
          <div className="overflow-x-auto border border-pebble rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-pebble/40 text-steel text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-left px-3 py-2">Plan</th>
                  <th className="text-right px-3 py-2">Seats</th>
                  <th className="text-right px-3 py-2">MRR</th>
                  <th className="text-right px-3 py-2">Days past due</th>
                  <th className="text-left px-3 py-2">Last dunning</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr key={r.business_id} className="border-t border-pebble">
                    <td className="px-3 py-2 text-midnight">{r.name || "—"}</td>
                    <td className="px-3 py-2 capitalize">{r.plan}</td>
                    <td className="px-3 py-2 text-right">{r.seats}</td>
                    <td className="px-3 py-2 text-right font-semibold">{inr(r.mrr_inr)}</td>
                    <td className="px-3 py-2 text-right">{r.days_past_due ?? "—"}</td>
                    <td className="px-3 py-2 text-steel/70">{r.last_dunning ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent messages */}
      <section>
        <h2 className="text-sm font-bold text-midnight mb-3">Recent messages</h2>
        {msgs.length === 0 ? (
          <p className="text-sm text-steel/60 italic">No messages yet — run the automation or wait for the cron tick.</p>
        ) : (
          <div className="overflow-x-auto border border-pebble rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead className="bg-pebble/40 text-steel text-xs">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Template</th>
                  <th className="text-left px-3 py-2">Channel</th>
                  <th className="text-left px-3 py-2">Campaign</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {msgs.map((m) => (
                  <tr key={m.id} className="border-t border-pebble">
                    <td className="px-3 py-2 text-steel/70 whitespace-nowrap">{m.ts ? new Date(m.ts).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-midnight">{m.template}</td>
                    <td className="px-3 py-2">{m.channel}</td>
                    <td className="px-3 py-2 text-steel/70">{m.campaign ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_COLOR[m.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
