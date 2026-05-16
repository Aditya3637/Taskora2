"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import OnboardingBanner from "@/components/OnboardingBanner";
import { ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Link = {
  type: "task" | "subtask" | "initiative" | "program";
  task_id?: string | null; subtask_id?: string | null;
  initiative_id?: string | null; program_id?: string | null;
};
type Comment = { snippet: string; kind?: string; at?: string; author_name?: string };
type Task = {
  id: string; title: string; status: string; priority: string;
  due_date?: string; description?: string; blocker_reason?: string;
  initiative_name?: string; program_name?: string; days_overdue?: number;
  primary_stakeholder_name?: string; approval_state?: string;
  open_subtasks?: number; done_subtasks?: number; total_subtasks?: number;
  pending_approvers?: string[]; last_comment?: Comment | null; link?: Link;
  task_entities?: { entity_id: string; entity_name?: string }[];
};
type InitProgress = {
  id: string; title?: string; name?: string; completion_pct: number;
  total_tasks?: number; done_tasks?: number; blocked?: number;
  overdue?: number; awaiting_approval?: number; program_name?: string; link?: Link;
};
type Group = {
  id: string; name?: string; group_by: string; open: number; overdue: number;
  blocked: number; pending_decision: number; awaiting_approval: number; link?: Link;
};
type QuickStats = {
  open_tasks: number; completion_rate_this_week: number; stale_count: number;
  awaiting_approval_count?: number; tat_breach_count?: number;
};
type Brief = {
  greeting?: { summary_line: string };
  pending_decisions: Task[]; overdue_tasks: Task[]; stale_tasks: Task[];
  due_this_week: Task[]; blocked_tasks: Task[];
  awaiting_approval?: Task[]; tat_breaches?: Task[];
  initiative_progress: InitProgress[]; groups?: Group[]; quick_stats?: QuickStats;
};

function priorityBorder(p: string) {
  if (p === "urgent" || p === "critical") return "border-l-4 border-l-red-500";
  if (p === "high") return "border-l-4 border-l-amber-400";
  return "border-l-4 border-l-ocean";
}

function linkHref(link?: Link): string | null {
  if (!link) return null;
  if (link.type === "program" && link.program_id) return `/programs?program=${link.program_id}`;
  if (link.type === "initiative" && link.initiative_id) return `/tasks?initiative=${link.initiative_id}`;
  if ((link.type === "task" || link.type === "subtask") && link.task_id) {
    const q = new URLSearchParams({ task: link.task_id });
    if (link.subtask_id) q.set("subtask", link.subtask_id);
    return `/tasks?${q.toString()}`;
  }
  return null;
}

function ago(at?: string): string {
  if (!at) return "";
  const s = Math.floor((Date.now() - new Date(at).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function DecisionCard({ task, onActed }: { task: Task; onActed: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = linkHref(task.link);
  const ents = task.task_entities ?? [];

  async function act(action: string) {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Reason for rejecting / sending back?");
      if (!reason) return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          ...(reason ? { reason } : {}),
          ...(action === "snooze" ? { snooze_hours: 24 } : {}),
        }),
      });
      onActed();
    } catch { /* surfaced by list reload */ } finally { setBusy(false); }
  }

  async function comment() {
    const c = window.prompt("Add a comment");
    if (!c?.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/comments`, {
        method: "POST", body: JSON.stringify({ content: c.trim() }),
      });
      onActed();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm ${priorityBorder(task.priority)} mb-2`}>
      <div className="flex items-start gap-2 p-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-steel/50 hover:text-midnight flex-shrink-0"
          title={open ? "Collapse" : "Expand"}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <button onClick={() => setOpen((v) => !v)} className="flex-1 text-left min-w-0">
          {(task.program_name || task.initiative_name) && (
            <p className="text-[11px] text-steel/70 mb-0.5 truncate">
              {task.program_name && <span>{task.program_name}</span>}
              {task.program_name && task.initiative_name && <span> › </span>}
              {task.initiative_name && <span>{task.initiative_name}</span>}
            </p>
          )}
          <p className="font-medium text-midnight text-sm">{task.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
            <span className="px-1.5 py-0.5 rounded bg-mist text-steel">{task.status.replace("_", " ")}</span>
            <span className="px-1.5 py-0.5 rounded bg-mist text-steel">{task.priority}</span>
            {!!task.days_overdue && task.days_overdue > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-semibold">
                {task.days_overdue}d overdue
              </span>
            )}
            {task.approval_state === "pending" && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">awaiting approval</span>
            )}
            {!!task.total_subtasks && (
              <span className="px-1.5 py-0.5 rounded bg-mist text-steel">
                {task.done_subtasks}/{task.total_subtasks} subtasks
              </span>
            )}
            {task.due_date && <span className="text-steel">Due {task.due_date}</span>}
            {ents.map((e) => (
              <span key={e.entity_id} className="px-1.5 py-0.5 rounded bg-mist text-steel">{e.entity_name ?? e.entity_id}</span>
            ))}
          </div>
        </button>

        {href && (
          <button
            onClick={() => router.push(href)}
            className="flex-shrink-0 p-1.5 rounded-lg text-steel hover:text-ocean hover:bg-mist"
            title="Open full task"
          >
            <ArrowUpRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-pebble px-4 py-3 space-y-2 text-sm">
          {task.description && <p className="text-steel">{task.description}</p>}
          {task.blocker_reason && (
            <p className="text-red-700"><span className="font-semibold">Blocked:</span> {task.blocker_reason}</p>
          )}
          {task.last_comment && (
            <p className="text-steel bg-mist/60 rounded p-2">
              <span className="font-semibold text-midnight">{task.last_comment.author_name || "Someone"}</span>
              {" "}<span className="text-steel/60">{ago(task.last_comment.at)}</span><br />
              {task.last_comment.snippet}
            </p>
          )}
          {!!task.pending_approvers?.length && (
            <p className="text-steel"><span className="font-semibold">Approvers:</span> {task.pending_approvers.join(", ")}</p>
          )}
          <p className="text-steel/80 text-xs">
            Owner: {task.primary_stakeholder_name || "—"}
            {task.open_subtasks ? ` · ${task.open_subtasks} open subtask${task.open_subtasks > 1 ? "s" : ""}` : ""}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={busy} onClick={() => act("approve")} className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">Approve</button>
            <button disabled={busy} onClick={() => act("reject")} className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50">Reject</button>
            <button disabled={busy} onClick={() => act("snooze")} className="px-3 py-1 bg-pebble text-steel text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50">Snooze 24h</button>
            <button disabled={busy} onClick={comment} className="px-3 py-1 border border-pebble text-steel text-xs font-semibold rounded-lg hover:bg-mist disabled:opacity-50">Comment</button>
            {href && <button onClick={() => router.push(href)} className="px-3 py-1 border border-pebble text-ocean text-xs font-semibold rounded-lg hover:bg-mist">Open ↗</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-midnight">{title}</h2>
        {count > 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${color}`}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function DailyBriefInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const scope = sp.get("scope") === "team" ? "team" : "mine";
  const groupBy = sp.get("group_by") ?? "none";
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const q = new URLSearchParams({ scope });
      if (groupBy !== "none") q.set("group_by", groupBy);
      setBrief(await apiFetch(`/api/v1/daily-brief?${q.toString()}`));
    } catch { setError("Failed to load daily brief."); }
    finally { setLoading(false); }
  }, [scope, groupBy]);

  useEffect(() => { load(); }, [load]);

  function setParam(k: string, v: string) {
    const q = new URLSearchParams(sp.toString());
    if (v === "mine" || v === "none") q.delete(k); else q.set(k, v);
    router.push(`/daily-brief${q.toString() ? `?${q}` : ""}`);
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/></div>;
  if (error) return <div className="p-8 text-red-600">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>;
  if (!brief) return null;

  const empty = <p className="text-sm text-steel italic bg-white rounded-lg p-3 border border-pebble">All clear ✓</p>;
  const rows = (list?: Task[]) => (!list || list.length === 0 ? empty : list.map((t) => <DecisionCard key={t.id} task={t} onActed={load} />));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <OnboardingBanner />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight">
          {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"} 👋
        </h1>
        {brief.greeting?.summary_line && <p className="text-steel mt-1">{brief.greeting.summary_line}</p>}
      </div>

      <div className="flex flex-wrap gap-2 mb-6 text-xs">
        {(["mine", "team"] as const).map((s) => (
          <button key={s} onClick={() => setParam("scope", s)}
            className={`px-3 py-1 rounded-full border ${scope === s ? "border-taskora-red text-taskora-red bg-red-50" : "border-pebble text-steel hover:border-steel"}`}>
            {s === "mine" ? "My work" : "Team / portfolio"}
          </button>
        ))}
        <span className="w-px bg-pebble mx-1" />
        {(["none", "initiative", "program"] as const).map((g) => (
          <button key={g} onClick={() => setParam("group_by", g)}
            className={`px-3 py-1 rounded-full border ${groupBy === g ? "border-ocean text-ocean bg-ocean/5" : "border-pebble text-steel hover:border-steel"}`}>
            {g === "none" ? "No grouping" : `By ${g}`}
          </button>
        ))}
      </div>

      {brief.quick_stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Open", value: brief.quick_stats.open_tasks, warn: false },
            { label: "Done/wk", value: `${brief.quick_stats.completion_rate_this_week}%`, warn: false },
            { label: "Awaiting Appr.", value: brief.quick_stats.awaiting_approval_count ?? 0, warn: (brief.quick_stats.awaiting_approval_count ?? 0) > 0 },
            { label: "TAT breaches", value: brief.quick_stats.tat_breach_count ?? 0, warn: (brief.quick_stats.tat_breach_count ?? 0) > 0 },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-3 ${s.warn ? "bg-amber-50 border-amber-200" : "bg-white border-pebble"}`}>
              <p className="text-[10px] text-steel uppercase tracking-wider font-semibold mb-1">{s.label}</p>
              <p className={`text-2xl font-extrabold ${s.warn ? "text-amber-700" : "text-midnight"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {!!brief.groups?.length && (
        <Section title="📊 Rollup" count={brief.groups.length} color="bg-ocean">
          <div className="space-y-2">
            {brief.groups.map((g) => {
              const href = linkHref(g.link);
              return (
                <button key={g.id} onClick={() => href && router.push(href)}
                  className="w-full text-left bg-white border border-pebble rounded-xl p-4 hover:border-ocean transition-colors">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-midnight text-sm">{g.name ?? g.id}</span>
                    <span className="text-xs text-steel">
                      {g.open} open · {g.overdue} overdue · {g.blocked} blocked · {g.awaiting_approval} awaiting
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="🟠 Awaiting Approval" count={brief.awaiting_approval?.length ?? 0} color="bg-amber-500">{rows(brief.awaiting_approval)}</Section>
      <Section title="⛔ TAT Breaches" count={brief.tat_breaches?.length ?? 0} color="bg-red-600">{rows(brief.tat_breaches)}</Section>
      <Section title="🔴 Decisions Pending" count={brief.pending_decisions.length} color="bg-red-500">{rows(brief.pending_decisions)}</Section>
      <Section title="⏰ Overdue" count={brief.overdue_tasks.length} color="bg-red-500">{rows(brief.overdue_tasks)}</Section>
      <Section title="🕰 Stale — Needs Update" count={brief.stale_tasks.length} color="bg-amber-500">{rows(brief.stale_tasks)}</Section>
      <Section title="📅 Due This Week" count={brief.due_this_week.length} color="bg-blue-500">{rows(brief.due_this_week)}</Section>
      <Section title="🚫 Blocked" count={brief.blocked_tasks.length} color="bg-red-500">{rows(brief.blocked_tasks)}</Section>

      {brief.initiative_progress.length > 0 && (
        <Section title="🚀 Initiative Progress" count={brief.initiative_progress.length} color="bg-midnight">
          <div className="space-y-3">
            {brief.initiative_progress.map((p) => {
              const pct = Math.round(p.completion_pct ?? 0);
              const href = linkHref(p.link);
              return (
                <button key={p.id} onClick={() => href && router.push(href)}
                  className="w-full text-left bg-white border border-pebble rounded-xl p-4 hover:border-ocean transition-colors">
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-midnight text-sm">
                      {p.program_name && <span className="text-steel/70">{p.program_name} › </span>}
                      {p.title ?? p.name}
                    </span>
                    <span className="text-sm font-mono text-steel">{pct}%</span>
                  </div>
                  <div className="h-2 bg-pebble rounded-full overflow-hidden">
                    <div className="h-full bg-taskora-red rounded-full transition-all" style={{ width: `${pct}%` }}/>
                  </div>
                  {((p.blocked ?? 0) + (p.overdue ?? 0) + (p.awaiting_approval ?? 0)) > 0 && (
                    <p className="text-[11px] text-steel mt-1">
                      {p.overdue ?? 0} overdue · {p.blocked ?? 0} blocked · {p.awaiting_approval ?? 0} awaiting approval
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function DailyBriefPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/></div>}>
      <DailyBriefInner />
    </Suspense>
  );
}
