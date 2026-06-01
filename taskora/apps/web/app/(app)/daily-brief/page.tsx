"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import OnboardingBanner from "@/components/OnboardingBanner";
import { ChevronDown, ChevronRight, ArrowUpRight, Check, X } from "lucide-react";

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
  pending_approvers?: string[];
  // user_ids form so the FE can render inline Approve/Reject without an
  // extra /watchers fetch.
  pending_approver_ids?: string[];
  last_comment?: Comment | null; link?: Link;
  task_entities?: { entity_id: string; entity_name?: string }[];
  is_tat_breach?: boolean; is_stale?: boolean;
  initiative_target_end_date?: string | null;
};
type TopPick = {
  reason: "decision" | "approval" | "overdue" | "blocked";
  task_id: string; title?: string; priority?: string; status?: string;
  days_overdue?: number; initiative_name?: string; program_name?: string;
  primary_stakeholder_name?: string; approval_state?: string; link?: Link;
} | null;
type PersonRollup = {
  user_id: string; name?: string;
  open: number; overdue: number; awaiting_approval: number; blocked: number;
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
  done_this_week_count?: number;
};
type Brief = {
  greeting?: { summary_line: string };
  pending_decisions: Task[]; overdue_tasks: Task[]; stale_tasks: Task[];
  due_this_week: Task[]; blocked_tasks: Task[];
  awaiting_approval?: Task[]; tat_breaches?: Task[];
  initiative_progress: InitProgress[]; groups?: Group[]; quick_stats?: QuickStats;
  top_pick?: TopPick;
  people_rollup?: PersonRollup[];
  // Workspace-wide options for filter dropdowns — every program / member,
  // not just those that appear in the current visible buckets.
  workspace_programs?: { id: string; name: string }[];
  workspace_members?: { user_id: string; name: string }[];
  // Active initiatives with zero tasks OR no activity in 14 days — the
  // gaps the rest of the brief hides.
  dormant_initiatives?: {
    id: string; name: string; program_id?: string | null;
    program_name?: string | null;
    reason: "no_tasks" | "stale"; last_update?: string | null;
    link?: Link;
  }[];
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

function DecisionCard({
  task,
  onActed,
  currentUserId,
}: {
  task: Task;
  onActed: () => void;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = linkHref(task.link);
  const ents = task.task_entities ?? [];
  // Inline Approve / Reject on the collapsed card whenever the current user
  // is one of the pending approvers — saves the expand click for the
  // highest-frequency action.
  const isApprover =
    task.approval_state === "pending" &&
    !!task.pending_approver_ids?.includes(currentUserId);

  async function approveInline(action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Reason for rejecting?");
      if (!reason) return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          scope_type: "task",
          action,
          ...(reason ? { reason } : {}),
        }),
      });
      onActed();
    } catch {
      /* refetch will surface */
    } finally {
      setBusy(false);
    }
  }

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
            {!!task.days_overdue && task.days_overdue > 0 && (() => {
              // Grade the chip by age so "1d" and "30d" don't look identical.
              const d = task.days_overdue;
              const cls =
                d > 14
                  ? "bg-red-100 text-red-800 ring-1 ring-red-300"
                  : d > 7
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-800";
              return (
                <span className={`px-1.5 py-0.5 rounded font-semibold ${cls}`}>
                  {d}d overdue{d > 14 ? " ⚠" : ""}
                </span>
              );
            })()}
            {task.approval_state === "pending" && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">awaiting approval</span>
            )}
            {task.status === "blocked" && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold">blocked</span>
            )}
            {task.is_tat_breach && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold ring-1 ring-red-300">TAT breach ⚠</span>
            )}
            {task.is_stale && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">stale</span>
            )}
            {!!task.total_subtasks && (
              <span className="px-1.5 py-0.5 rounded bg-mist text-steel">
                {task.done_subtasks}/{task.total_subtasks} subtasks
              </span>
            )}
            {task.due_date && (() => {
              // #6: amber + ⚠ when the task's due date falls beyond the
              // initiative's own target end (ISO dates → string compare).
              const beyond = !!task.initiative_target_end_date
                && task.due_date > task.initiative_target_end_date!;
              return (
                <span
                  className={beyond ? "text-amber-700 font-semibold" : "text-steel"}
                  title={beyond
                    ? `Beyond initiative due date (target end ${task.initiative_target_end_date})`
                    : undefined}
                >
                  Due {task.due_date}{beyond ? " ⚠" : ""}
                </span>
              );
            })()}
            {ents.map((e) => (
              <span key={e.entity_id} className="px-1.5 py-0.5 rounded bg-mist text-steel">{e.entity_name ?? e.entity_id}</span>
            ))}
          </div>
        </button>

        {isApprover && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              disabled={busy}
              onClick={() => approveInline("approve")}
              className="p-1.5 rounded-lg text-green-700 hover:bg-green-50 border border-green-200 disabled:opacity-50"
              title="Approve"
              aria-label="Approve"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              disabled={busy}
              onClick={() => approveInline("reject")}
              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-50"
              title="Reject"
              aria-label="Reject"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
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

// localStorage prefix for the section-collapsed flags. Keyed by title so
// each section persists its own state.
const _SECTION_COLLAPSED_PREFIX = "taskora_db_collapsed:";

function Section({
  title,
  count,
  color,
  children,
  hideWhenEmpty,
  helpText,
  defaultCollapsed,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
  // When true, an empty section renders as a single compact title line with
  // a ✓ badge instead of taking up vertical space with an empty-state card.
  hideWhenEmpty?: boolean;
  // Optional tooltip text explaining the rule that populates this section.
  // Renders as a small ⓘ next to the title.
  helpText?: string;
  // First-render preference if no localStorage value exists.
  defaultCollapsed?: boolean;
}) {
  // Persist collapsed state per-section in localStorage so the user's
  // preference survives reloads. Read on mount only — SSR-safe default.
  const storageKey = _SECTION_COLLAPSED_PREFIX + title;
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v != null) setCollapsed(v === "1");
    } catch { /* localStorage blocked — keep default */ }
  }, [storageKey]);
  function toggle() {
    setCollapsed((cur) => {
      const next = !cur;
      try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // Whole title hovers for the description (not just the ⓘ glyph) so the
  // affordance is discoverable. The ⓘ is kept as a visual cue that there
  // *is* a description.
  if (count === 0 && hideWhenEmpty) {
    // Empty + hide-when-empty stays a single line — no toggle needed since
    // there's nothing to hide.
    return (
      <div className="mb-3">
        <div
          className="flex items-center gap-2 text-sm text-steel/70"
          title={helpText}
        >
          <h2 className="font-medium">{title}</h2>
          {helpText && (
            <span className="text-[11px] text-steel/50" aria-hidden>ⓘ</span>
          )}
          <span className="text-[10px] text-green-700 font-semibold inline-flex items-center gap-0.5">
            ✓ All clear
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3" title={helpText}>
        <h2 className="font-semibold text-midnight">{title}</h2>
        {helpText && (
          <span className="text-[11px] text-steel/50" aria-hidden>ⓘ</span>
        )}
        {count > 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${color}`}>{count}</span>}
        {/* Spacer pushes the toggle to the right edge of the title row. */}
        <span className="flex-1" />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          title={collapsed ? "Expand" : "Collapse"}
          className="text-steel/60 hover:text-midnight p-1 rounded hover:bg-mist transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>
      {!collapsed && children}
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
  // Filters live in the URL so reloads + saved tabs keep their context.
  // Stored as `prog` and `user` to keep the URL short and easy to share.
  const programFilter = sp.get("prog") ?? "";
  const userFilter = sp.get("user") ?? "";
  const [currentUserId, setCurrentUserId] = useState("");
  // Dormant initiatives are surfaced as a stat card that expands inline
  // when clicked — by default collapsed so the page stays calm.
  const [dormantOpen, setDormantOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setCurrentUserId(session.user.id);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    // Filtering by a person shows their portfolio, which only the team
    // scope resolves (mine scope is just the caller's own tasks).
    const effScope = userFilter ? "team" : scope;
    const q = new URLSearchParams({ scope: effScope });
    if (groupBy !== "none") q.set("group_by", groupBy);
    // Server applies the owner/program filters (complete-view: a person's
    // primary + secondary/tertiary + initiative-owned work, plus scoped
    // Initiative Progress + Dormant). The client no longer re-filters.
    if (userFilter) q.set("owner", userFilter);
    if (programFilter) q.set("program", programFilter);
    // Scope to the active workspace so multi-workspace members don't see
    // pooled data from every workspace they belong to.
    if (typeof window !== "undefined") {
      const bid = localStorage.getItem("business_id");
      if (bid) q.set("business_id", bid);
    }
    const url = `/api/v1/daily-brief?${q.toString()}`;
    // One transparent retry on transient 5xx — the daily-brief and other
    // heavy endpoints occasionally cold-start race with Supabase. A second
    // attempt 600ms later masks the blip without making the user click.
    try {
      setBrief(await apiFetch(url));
    } catch (e: any) {
      if (e?.status && e.status >= 500 && e.status < 600) {
        await new Promise((r) => setTimeout(r, 600));
        try {
          setBrief(await apiFetch(url));
        } catch (e2: any) {
          setError(
            e2?.detail || `Failed to load daily brief (HTTP ${e2?.status ?? "?"}).`,
          );
        }
      } else {
        setError(
          e?.detail || `Failed to load daily brief${e?.status ? ` (HTTP ${e.status})` : ""}.`,
        );
      }
    } finally {
      setLoading(false);
    }
  }, [scope, groupBy, userFilter, programFilter]);

  useEffect(() => { load(); }, [load]);

  function setParam(k: string, v: string) {
    const q = new URLSearchParams(sp.toString());
    // Empty + the per-key "default" values delete the param so URLs stay tidy.
    const isDefault =
      (k === "scope" && v === "mine") ||
      (k === "group_by" && v === "none") ||
      v === "";
    if (isDefault) q.delete(k);
    else q.set(k, v);
    router.push(`/daily-brief${q.toString() ? `?${q}` : ""}`);
  }

  // Auto-refresh on tab focus so a brief left open for hours doesn't go
  // stale. Debounced to avoid double-fetch when focus events fire fast
  // (e.g. devtools open/close).
  useEffect(() => {
    let timer: number | undefined;
    function onFocus() {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => load(), 200);
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearTimeout(timer);
    };
  }, [load]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/></div>;
  if (error) return <div className="p-8 text-red-600">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>;
  if (!brief) return null;

  const allTasks: Task[] = [
    ...brief.pending_decisions, ...brief.overdue_tasks, ...brief.stale_tasks,
    ...brief.due_this_week, ...brief.blocked_tasks,
    ...(brief.awaiting_approval ?? []), ...(brief.tat_breaches ?? []),
  ];
  const uniqSorted = (xs: (string | undefined)[]) =>
    Array.from(new Set(xs.filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b));
  // Prefer the workspace-wide lists so programs/people without any visible
  // task still appear in the filters. Fall back to bucket-derived sets when
  // the workspace fields aren't present (older API).
  const programOptions: { id: string; name: string }[] = brief.workspace_programs?.length
    ? brief.workspace_programs.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
    : uniqSorted(allTasks.map((t) => t.program_name)).map((n) => ({ id: n, name: n }));
  const userOptions: { id: string; name: string }[] = brief.workspace_members?.length
    ? brief.workspace_members.map((m) => ({ id: m.user_id, name: m.name })).filter((o) => o.name).sort((a, b) => a.name.localeCompare(b.name))
    : uniqSorted(allTasks.map((t) => t.primary_stakeholder_name)).map((n) => ({ id: n, name: n }));
  const filtersActive = !!programFilter || !!userFilter;
  // Server already applied the owner + program filters (complete-view), so
  // the bucket lists arrive pre-filtered — no client-side re-filtering
  // (the old primary-only name match hid initiative-owned work).
  const matches = (_t: Task) => true;

  const empty = (
    <p className="text-sm text-steel italic bg-white rounded-lg p-3 border border-pebble">
      {filtersActive ? "No matching items" : "All clear ✓"}
    </p>
  );
  const rows = (list?: Task[]) => {
    const f = (list ?? []).filter(matches);
    return f.length === 0 ? empty : f.map((t) => (
      <DecisionCard key={t.id} task={t} onActed={load} currentUserId={currentUserId} />
    ));
  };
  // Server scopes Initiative Progress to the active filters now (owner /
  // program / initiative), so render it as-is.
  const initProgress = brief.initiative_progress;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-fade-up">
      <OnboardingBanner />
      <div className="mb-7">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 className="font-display text-display-md text-fg tracking-tightest leading-[1.05]">
          {new Date().getHours() < 12 ? "Good morning." : new Date().getHours() < 17 ? "Good afternoon." : "Good evening."}
        </h1>
        {brief.greeting?.summary_line && (
          <p className="text-[15px] text-fg-muted mt-2 leading-relaxed max-w-2xl">
            {brief.greeting.summary_line}
          </p>
        )}
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
        <span className="w-px bg-pebble mx-1" />
        <select
          value={programFilter}
          onChange={(e) => setParam("prog", e.target.value)}
          className={`px-3 py-1 rounded-full border bg-white ${programFilter ? "border-taskora-red text-taskora-red" : "border-pebble text-steel hover:border-steel"}`}
          aria-label="Filter by program"
        >
          <option value="">All programs</option>
          {programOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={userFilter}
          onChange={(e) => setParam("user", e.target.value)}
          className={`px-3 py-1 rounded-full border bg-white ${userFilter ? "border-taskora-red text-taskora-red" : "border-pebble text-steel hover:border-steel"}`}
          aria-label="Filter by primary user"
        >
          <option value="">All users</option>
          {userOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {filtersActive && (
          <button
            onClick={() => {
              const q = new URLSearchParams(sp.toString());
              q.delete("prog");
              q.delete("user");
              router.push(`/daily-brief${q.toString() ? `?${q}` : ""}`);
            }}
            className="px-3 py-1 rounded-full border border-pebble text-steel hover:border-steel">
            Clear ✕
          </button>
        )}
      </div>

      {/* Hero "pick one" — single most-actionable item. Recomputed against
          the current filters so it reflects what the user is actually
          looking at (the server's top_pick was the global head; once the
          user picks a program or person it can drift). Each bucket is
          already severity-sorted server-side, so the filtered head is the
          right candidate. */}
      {(() => {
        type Reason = "decision" | "approval" | "overdue" | "blocked";
        const priority: { reason: Reason; src: Task[] }[] = [
          { reason: "decision", src: brief.pending_decisions },
          { reason: "approval", src: brief.awaiting_approval ?? [] },
          { reason: "overdue", src: brief.overdue_tasks },
          { reason: "blocked", src: brief.blocked_tasks },
        ];
        let liveTop: { reason: Reason; t: Task } | null = null;
        for (const { reason, src } of priority) {
          const head = src.find(matches);
          if (head) { liveTop = { reason, t: head }; break; }
        }
        if (!liveTop) return null;
        const { reason, t } = liveTop;
        const reasonLabel: Record<Reason, { tag: string; cls: string }> = {
          decision: { tag: "Decision needed", cls: "bg-red-50 text-red-700 border-red-200" },
          approval: { tag: "Awaiting your approval", cls: "bg-amber-50 text-amber-800 border-amber-200" },
          overdue: { tag: `Overdue${t.days_overdue ? ` ${t.days_overdue}d` : ""}`, cls: "bg-red-50 text-red-700 border-red-200" },
          blocked: { tag: "Blocked", cls: "bg-red-50 text-red-700 border-red-200" },
        };
        // Mirror the shape the original block read off `tp` so the existing
        // JSX below stays unchanged.
        const tp = {
          reason,
          title: t.title,
          priority: t.priority,
          program_name: t.program_name,
          initiative_name: t.initiative_name,
          primary_stakeholder_name: t.primary_stakeholder_name,
          days_overdue: t.days_overdue,
          link: t.link,
        } as TopPick & { reason: Reason };
        const meta = reasonLabel[reason];
        const href = linkHref(tp.link);
        return (
          <div className="mb-6 rounded-2xl border border-taskora-red/30 bg-gradient-to-br from-red-50 to-white p-4">
            <p className="text-[10px] uppercase tracking-widest font-bold text-taskora-red mb-1">
              Start here
            </p>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {(tp.program_name || tp.initiative_name) && (
                  <p className="text-[11px] text-steel/70 mb-0.5 truncate">
                    {tp.program_name}
                    {tp.program_name && tp.initiative_name && " › "}
                    {tp.initiative_name}
                  </p>
                )}
                <p className="font-semibold text-midnight text-base truncate">
                  {tp.title}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>
                    {meta.tag}
                  </span>
                  {tp.priority && (
                    <span className="px-2 py-0.5 rounded-full bg-mist text-steel font-medium">
                      {tp.priority}
                    </span>
                  )}
                  {tp.primary_stakeholder_name && (
                    <span className="text-steel">Owner: {tp.primary_stakeholder_name}</span>
                  )}
                </div>
              </div>
              {href && (
                <button
                  onClick={() => router.push(href)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-taskora-red text-white text-xs font-semibold hover:bg-taskora-red/90 inline-flex items-center gap-1"
                >
                  Open <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {brief.quick_stats && (() => {
        // Compute the "Done this wk" date range so the tooltip can name the
        // window. Backend defines stale_threshold = today − 7 days; that's
        // also the floor for done_this_week.
        const now = new Date();
        const since = new Date(now.getTime() - 7 * 86400 * 1000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        // Server scopes Dormant to the active filters now.
        const filteredDormant = brief.dormant_initiatives ?? [];
        const stats = [
          {
            key: "open",
            label: "Open",
            value: brief.quick_stats!.open_tasks,
            warn: false,
            help: "Every task currently in scope (after scope + filters) that isn't done, archived, or cancelled.",
          },
          {
            key: "done_wk",
            label: "Done this wk",
            value: `${brief.quick_stats!.done_this_week_count ?? 0}`,
            warn: false,
            help: `Tasks marked done between ${fmt(since)} and ${fmt(now)}. Window = last 7 days.`,
          },
          {
            key: "awaiting",
            label: "Awaiting Appr.",
            value: brief.quick_stats!.awaiting_approval_count ?? 0,
            warn: (brief.quick_stats!.awaiting_approval_count ?? 0) > 0,
            help: "Tasks marked done where an approver still needs to approve or reject the closure.",
          },
          {
            key: "tat",
            label: "TAT breaches",
            value: brief.quick_stats!.tat_breach_count ?? 0,
            warn: (brief.quick_stats!.tat_breach_count ?? 0) > 0,
            help: "Tasks that slipped past a clear bar: more than 7 days overdue, OR blocked with no update in 7+ days, OR awaiting approval more than 3 days after closure.",
          },
          {
            key: "dormant",
            label: "Dormant",
            value: filteredDormant.length,
            warn: filteredDormant.length > 0,
            help: "Active initiatives with no tasks yet, OR no task updated in the last 14 days. Click to expand.",
            clickable: true,
          },
        ];
        return (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            {stats.map((s) => {
              const isDormantOpen = s.key === "dormant" && dormantOpen;
              const base = `rounded-xl border p-3 text-left w-full ${s.warn ? "bg-amber-50 border-amber-200" : "bg-white border-pebble"}`;
              const clickableCls = (s as any).clickable
                ? ` cursor-pointer hover:border-taskora-red transition-colors${isDormantOpen ? " ring-2 ring-taskora-red/40" : ""}`
                : "";
              const inner = (
                <>
                  <p className="text-[10px] text-steel uppercase tracking-wider font-semibold mb-1">
                    {s.label}
                  </p>
                  <p
                    className={`text-2xl font-extrabold ${s.warn ? "text-amber-700" : "text-midnight"}`}
                  >
                    {s.value}
                  </p>
                </>
              );
              return (s as any).clickable ? (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setDormantOpen((v) => !v)}
                  title={s.help}
                  aria-label={s.help}
                  className={base + clickableCls}
                >
                  {inner}
                </button>
              ) : (
                <div key={s.key} title={s.help} aria-label={s.help} className={base}>
                  {inner}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Dormant initiatives — opens only when the user clicks the stat
          card above. Lives right under the stats grid so context is local. */}
      {dormantOpen && !!brief.dormant_initiatives?.length && (() => {
        const items = brief.dormant_initiatives;
        if (!items.length) return (
          <div className="mb-8 text-xs text-steel italic">
            No dormant initiatives in the current filter.
          </div>
        );
        return (
          <div className="mb-8 space-y-2">
            {items.map((d) => {
              const href = linkHref(d.link);
              return (
                <button
                  key={d.id}
                  onClick={() => href && router.push(href)}
                  className="w-full text-left bg-white border border-amber-200 rounded-xl p-3 hover:border-amber-400 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {d.program_name && (
                        <p className="text-[11px] text-steel/70 mb-0.5 truncate">
                          {d.program_name}
                        </p>
                      )}
                      <p className="font-medium text-midnight text-sm truncate">
                        {d.name}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      {d.reason === "no_tasks"
                        ? "No tasks yet"
                        : `No activity since ${d.last_update ?? "—"}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* People rollup — only meaningful in the team-scope view, where you
          want "who's loaded with what" before the bucket lists. */}
      {scope === "team" && !!brief.people_rollup?.length && (
        <Section
          title="👥 By person"
          count={brief.people_rollup.length}
          color="bg-ocean"
          helpText="Per-primary-stakeholder counts across all tasks in scope. Click a row to filter the brief to that person."
        >
          <div className="space-y-2">
            {brief.people_rollup.map((p) => {
              const isMe = p.user_id === currentUserId;
              const hot = p.overdue > 0 || p.awaiting_approval > 0;
              return (
                <button
                  key={p.user_id}
                  onClick={() => setParam("user", p.name || "")}
                  className={`w-full text-left bg-white border rounded-xl p-3 transition-colors ${
                    hot ? "border-red-200 hover:border-red-400" : "border-pebble hover:border-ocean"
                  }`}
                  title={`Filter by ${p.name || "this user"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-midnight text-sm truncate">
                      {p.name || "Unknown"}
                      {isMe && (
                        <span className="ml-1.5 text-[10px] uppercase font-bold text-taskora-red">
                          you
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-steel flex items-center gap-2 flex-shrink-0">
                      {p.overdue > 0 && (
                        <span className="text-red-700 font-semibold">
                          {p.overdue} overdue
                        </span>
                      )}
                      {p.awaiting_approval > 0 && (
                        <span className="text-amber-700 font-semibold">
                          {p.awaiting_approval} awaiting
                        </span>
                      )}
                      {p.blocked > 0 && (
                        <span className="text-red-700">{p.blocked} blocked</span>
                      )}
                      <span className="text-steel/70">{p.open} open</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {!!brief.groups?.length && (
        <Section
          title="📊 Rollup"
          count={brief.groups.length}
          color="bg-ocean"
          helpText="Same in-scope tasks summed by initiative or program (whichever grouping is active). Click a row to drill in."
        >
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

      {(() => {
        // Empty sections compress to compact title-only rows so the page
        // doesn't show three "All clear ✓" cards in a stack. Count reflects
        // what's visible after the current filters, not the raw bucket.
        const fApproval = (brief.awaiting_approval ?? []).filter(matches);
        const fTat = (brief.tat_breaches ?? []).filter(matches);
        const fDec = brief.pending_decisions.filter(matches);
        const fOver = brief.overdue_tasks.filter(matches);
        const fStale = brief.stale_tasks.filter(matches);
        const fDue = brief.due_this_week.filter(matches);
        const fBlock = brief.blocked_tasks.filter(matches);
        return (
          <>
            <Section
              title="🟠 Awaiting Approval"
              count={fApproval.length}
              color="bg-amber-500"
              hideWhenEmpty
              helpText="Tasks where status is done but an approver hasn't yet approved or rejected the closure."
            >
              {rows(brief.awaiting_approval)}
            </Section>
            <Section
              title="⛔ TAT Breaches"
              count={fTat.length}
              color="bg-red-600"
              hideWhenEmpty
              helpText="Any of: more than 7 days past due_date, OR blocked with no update in 7+ days, OR awaiting approval more than 3 days after closure."
            >
              {rows(brief.tat_breaches)}
            </Section>
            <Section
              title="🔴 Decisions Pending"
              count={fDec.length}
              color="bg-red-500"
              hideWhenEmpty
              helpText="Tasks whose status is pending_decision — someone is waiting on a call."
            >
              {rows(brief.pending_decisions)}
            </Section>
            <Section
              title="⏰ Overdue"
              count={fOver.length}
              color="bg-red-500"
              hideWhenEmpty
              helpText="Tasks past their due_date and not yet done or archived."
            >
              {rows(brief.overdue_tasks)}
            </Section>
            <Section
              title="🕰 Stale — Needs Update"
              count={fStale.length}
              color="bg-amber-500"
              hideWhenEmpty
              helpText="Open tasks (not done or archived) where no field has been touched in the last 7 days."
            >
              {rows(brief.stale_tasks)}
            </Section>
            <Section
              title="📅 Due This Week"
              count={fDue.length}
              color="bg-blue-500"
              hideWhenEmpty
              helpText="Tasks with a due_date between today and 7 days from now."
            >
              {rows(brief.due_this_week)}
            </Section>
            <Section
              title="🚫 Blocked"
              count={fBlock.length}
              color="bg-red-500"
              hideWhenEmpty
              helpText="Tasks currently in the blocked status."
            >
              {rows(brief.blocked_tasks)}
            </Section>
          </>
        );
      })()}

      {initProgress.length > 0 && (
        <Section
          title="🚀 Initiative Progress"
          count={initProgress.length}
          color="bg-midnight"
          helpText="Every active initiative in the workspace with its completion % (done tasks ÷ total tasks). Filtered by the current program selector."
        >
          <div className="space-y-3">
            {initProgress.map((p) => {
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
