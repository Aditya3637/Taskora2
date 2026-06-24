"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Select, cn } from "@/components/ui";

/**
 * Roadmap › List — a proper task table for the 200-task case. Loads every task
 * once, then 100% client-side: search, multi status/priority filters, owner /
 * programme / site filters, sort, group-by with collapsible counted groups.
 * Buildings/clients show as attribute badges on the task (never a row of their
 * own). Expand a task to see its sub-tasks. Inline status edit; row → Work.
 */
type Ent = { entity_name?: string; entity_type?: string; per_entity_status?: string };
type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  start_date?: string | null;
  due_date?: string | null;
  initiative_id?: string | null;
  primary_stakeholder_id?: string | null;
  blocked_since?: string | null;
  task_entities?: Ent[];
  entity_id?: string | null;      // Playbooks: the single site this task lives at
  entity_type?: string | null;
  template_step_id?: string | null;
};
type Subtask = {
  id: string; title: string; status: string;
  assignee_id?: string | null; assignee_name?: string | null;
  start_date?: string | null; due_date?: string | null;
  parent_subtask_id?: string | null;
};
type Member = { user_id: string; name?: string; email?: string };
type Initiative = { id: string; name: string; program_id?: string | null; programs?: { id: string; name: string } | null };

const STATUSES = ["backlog", "todo", "in_progress", "pending_decision", "blocked", "done"] as const;
const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog", todo: "To do", in_progress: "In progress",
  pending_decision: "Pending decision", blocked: "Blocked", done: "Done", reopened: "Reopened",
};
const STATUS_DOT: Record<string, string> = {
  backlog: "bg-slate-400", todo: "bg-slate-400", in_progress: "bg-indigo-500",
  pending_decision: "bg-amber-500", blocked: "bg-red-500", done: "bg-emerald-500", reopened: "bg-amber-500",
};
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_BADGE: Record<string, string> = {
  low: "text-slate-500", medium: "text-sky-600", high: "text-amber-600", urgent: "text-red-600",
};

type SortKey = "due_asc" | "due_desc" | "priority" | "title";
type GroupKey = "none" | "status" | "programme" | "owner" | "priority" | "site" | "step";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "due_asc", label: "Sort: Due ↑" }, { value: "due_desc", label: "Sort: Due ↓" },
  { value: "priority", label: "Sort: Priority" }, { value: "title", label: "Sort: Title" },
];
const GROUPS: { value: GroupKey; label: string }[] = [
  { value: "status", label: "Group: Status" }, { value: "programme", label: "Group: Programme" },
  { value: "site", label: "Group: Site" }, { value: "step", label: "Group: Step" },
  { value: "owner", label: "Group: Owner" }, { value: "priority", label: "Group: Priority" },
  { value: "none", label: "Group: None" },
];

const COLS = "grid grid-cols-[18px_1fr_130px_84px_84px_78px_132px] items-center gap-2";
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function isOverdue(d?: string | null, status?: string) {
  if (!d || status === "done") return false;
  return new Date(d + "T00:00:00") < new Date(new Date().toDateString());
}

export default function TaskListView() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [entityName, setEntityName] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [priorityF, setPriorityF] = useState<Set<string>>(new Set());
  const [ownerF, setOwnerF] = useState("");
  const [programmeF, setProgrammeF] = useState("");
  const [siteF, setSiteF] = useState("");
  const [sort, setSort] = useState<SortKey>("due_asc");
  const [groupBy, setGroupBy] = useState<GroupKey>("status");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Lazy-loaded subtasks per task, keyed by task id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subtasks, setSubtasks] = useState<Record<string, Subtask[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
      if (!bid) { setLoading(false); return; }
      try {
        const [inits, mem, blds, clis] = await Promise.all([
          apiFetch(`/api/v1/initiatives/business/${bid}`).catch(() => []),
          apiFetch(`/api/v1/businesses/${bid}/members`).catch(() => []),
          apiFetch(`/api/v1/buildings?business_id=${bid}`).catch(() => []),
          apiFetch(`/api/v1/clients?business_id=${bid}`).catch(() => []),
        ]);
        if (!cancelled) {
          setInitiatives(Array.isArray(inits) ? inits : []);
          setMembers(Array.isArray(mem) ? mem : []);
          const nm: Record<string, string> = {};
          for (const e of [...(Array.isArray(blds) ? blds : []), ...(Array.isArray(clis) ? clis : [])]) nm[e.id] = e.name;
          setEntityName(nm);
        }
        const all: Task[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 20; i++) {
          const params = new URLSearchParams({ limit: "100", business_id: bid });
          if (cursor) params.set("cursor", cursor);
          const page: { items?: Task[]; next_cursor?: string | null } =
            await apiFetch(`/api/v1/tasks/my/page?${params.toString()}`);
          all.push(...(page?.items ?? []));
          cursor = page?.next_cursor ?? null;
          if (!cursor) break;
        }
        if (!cancelled) setTasks(all);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const initMap = useMemo(() => {
    const m = new Map<string, Initiative>();
    for (const i of initiatives) m.set(i.id, i);
    return m;
  }, [initiatives]);
  const memberName = useCallback((id?: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.user_id === id);
    return m?.name || m?.email || "Member";
  }, [members]);
  const initOf = useCallback((t: Task) => (t.initiative_id ? initMap.get(t.initiative_id) : null), [initMap]);
  const programmeOf = useCallback((t: Task) => initOf(t)?.programs?.name || "No programme", [initOf]);
  // A task's sites come from BOTH the legacy task_entities AND the new
  // single-site entity_id (Playbooks). Unified so badges/filter/grouping see all.
  const siteBadges = useCallback((t: Task): { name: string; type: string }[] => {
    const out: { name: string; type: string }[] = [];
    for (const e of t.task_entities ?? []) if (e.entity_name) out.push({ name: e.entity_name, type: e.entity_type || "building" });
    if (t.entity_id && entityName[t.entity_id]) out.push({ name: entityName[t.entity_id], type: t.entity_type || "building" });
    return out;
  }, [entityName]);
  const siteNamesOf = useCallback((t: Task) => siteBadges(t).map((s) => s.name), [siteBadges]);

  const allSites = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) for (const n of siteNamesOf(t)) s.add(n);
    return Array.from(s).sort();
  }, [tasks, siteNamesOf]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = tasks.filter((t) => {
      if (term && !t.title.toLowerCase().includes(term)) return false;
      if (statusF.size && !statusF.has(t.status)) return false;
      if (priorityF.size && !priorityF.has(t.priority)) return false;
      if (ownerF && t.primary_stakeholder_id !== ownerF) return false;
      if (programmeF && (initOf(t)?.program_id || "") !== programmeF) return false;
      if (siteF && !siteNamesOf(t).includes(siteF)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
      due_asc: (a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"),
      due_desc: (a, b) => (b.due_date || "").localeCompare(a.due_date || ""),
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...rows].sort(cmp[sort]);
  }, [tasks, q, statusF, priorityF, ownerF, programmeF, siteF, sort, initOf, siteNamesOf]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "All tasks", rows: filtered, done: filtered.filter((t) => t.status === "done").length }];
    const buckets = new Map<string, { label: string; rows: Task[] }>();
    const labelOf = (t: Task): string =>
      groupBy === "status" ? (STATUS_LABEL[t.status] ?? t.status)
        : groupBy === "programme" ? programmeOf(t)
          : groupBy === "owner" ? memberName(t.primary_stakeholder_id)
            : groupBy === "site" ? (siteNamesOf(t)[0] || "No site")
              : groupBy === "step" ? t.title
                : t.priority[0].toUpperCase() + t.priority.slice(1);
    // Step view groups by template_step_id (authoritative) so a renamed task or
    // two templates that share a step name don't merge/fragment; label stays the
    // step title. Everything else keys by its label.
    const keyOf = (t: Task): string =>
      groupBy === "step" ? (t.template_step_id || `title:${t.title}`) : labelOf(t);
    for (const t of filtered) {
      const k = keyOf(t);
      (buckets.get(k) ?? buckets.set(k, { label: labelOf(t), rows: [] }).get(k)!).rows.push(t);
    }
    const order = (a: [string, { label: string }], b: [string, { label: string }]) => {
      if (groupBy === "status") return STATUSES.findIndex((s) => STATUS_LABEL[s] === a[1].label) - STATUSES.findIndex((s) => STATUS_LABEL[s] === b[1].label);
      if (groupBy === "priority") return (PRIORITY_RANK[a[1].label.toLowerCase()] ?? 9) - (PRIORITY_RANK[b[1].label.toLowerCase()] ?? 9);
      return a[1].label.localeCompare(b[1].label);
    };
    return Array.from(buckets.entries()).sort(order).map(([key, { label, rows }]) => ({
      key, label, rows, done: rows.filter((t) => t.status === "done").length,
    }));
  }, [filtered, groupBy, programmeOf, memberName, siteNamesOf]);

  const activeFilters = statusF.size + priorityF.size + (ownerF ? 1 : 0) + (programmeF ? 1 : 0) + (siteF ? 1 : 0) + (q ? 1 : 0);

  async function setStatus(id: string, status: string) {
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
    try { await apiFetch(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch { /* */ }
  }
  const toggleSet = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n);
  };
  const clearAll = () => { setQ(""); setStatusF(new Set()); setPriorityF(new Set()); setOwnerF(""); setProgrammeF(""); setSiteF(""); };

  async function toggleExpand(t: Task) {
    const n = new Set(expanded);
    if (n.has(t.id)) { n.delete(t.id); setExpanded(n); return; }
    n.add(t.id); setExpanded(n);
    if (!subtasks[t.id]) {
      try {
        const full = await apiFetch(`/api/v1/tasks/${t.id}`);
        setSubtasks((prev) => ({ ...prev, [t.id]: Array.isArray(full?.subtasks) ? full.subtasks : [] }));
      } catch { setSubtasks((prev) => ({ ...prev, [t.id]: [] })); }
    }
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-steel/60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…"
            className="h-9 w-52 pl-8 pr-3 rounded-lg border border-pebble text-[13px] focus:outline-none focus:border-ocean" />
        </div>
        <Select value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS} size="md" className="w-[124px]" />
        <Select value={groupBy} onChange={(v) => setGroupBy(v as GroupKey)} options={GROUPS} size="md" className="w-[150px]" />
        <Select value={ownerF} onChange={setOwnerF} size="md" className="w-[140px]"
          options={[{ value: "", label: "All owners" }, ...members.map((m) => ({ value: m.user_id, label: m.name || m.email || "Member" }))]} />
        {allSites.length > 0 && (
          <Select value={siteF} onChange={setSiteF} size="md" className="w-[150px]"
            options={[{ value: "", label: "All sites" }, ...allSites.map((s) => ({ value: s, label: s }))]} />
        )}
        {activeFilters > 0 && (
          <button onClick={clearAll} className="inline-flex items-center gap-1 text-[12px] text-steel hover:text-midnight">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <span className="ml-auto text-[12px] text-steel">{filtered.length} task{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {/* Status + priority chips */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => toggleSet(statusF, s, setStatusF)}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              statusF.has(s) ? "border-midnight bg-midnight text-white" : "border-pebble text-steel hover:text-midnight")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", statusF.has(s) ? "bg-white" : STATUS_DOT[s])} />
            {STATUS_LABEL[s]}
          </button>
        ))}
        <span className="w-px h-4 bg-pebble mx-1" />
        {PRIORITIES.map((p) => (
          <button key={p} onClick={() => toggleSet(priorityF, p, setPriorityF)}
            className={cn("rounded-full border px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors",
              priorityF.has(p) ? "border-midnight bg-midnight text-white" : "border-pebble text-steel hover:text-midnight")}>
            {p}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-sm text-steel py-12">Loading tasks…</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-steel py-12">No tasks match these filters.</p>
      ) : (
        <div className="rounded-xl border border-pebble bg-white overflow-hidden">
          {/* Column header */}
          <div className={cn(COLS, "px-3.5 h-8 bg-mist/50 text-[10.5px] uppercase tracking-wide text-steel/70 font-semibold")}>
            <span />
            <span>Task</span><span>Owner</span><span>Start</span><span>End</span><span>Priority</span><span>Status</span>
          </div>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <div key={g.key}>
                {groupBy !== "none" && (
                  <button onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                    className="w-full flex items-center gap-2 px-3.5 h-9 bg-mist/30 border-t border-pebble/60 text-left hover:bg-mist/60">
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-steel" /> : <ChevronDown className="h-3.5 w-3.5 text-steel" />}
                    <span className="text-[12px] font-semibold text-midnight">{g.label}</span>
                    <span className="text-[11px] text-steel/70">{g.rows.length}</span>
                    {/* Roll-up: done/total — the "Survey 12/50" report at scale. */}
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-steel/70">
                      <span className="h-1.5 w-16 rounded-full bg-pebble overflow-hidden">
                        <span className="block h-full bg-emerald-500" style={{ width: `${g.rows.length ? (g.done / g.rows.length) * 100 : 0}%` }} />
                      </span>
                      {g.done}/{g.rows.length} done
                    </span>
                  </button>
                )}
                {!isCollapsed && g.rows.map((t) => {
                  const sites = siteBadges(t);
                  const isOpen = expanded.has(t.id);
                  return (
                    <div key={t.id}>
                      <div className={cn(COLS, "px-3.5 py-2 border-t border-pebble/50 hover:bg-mist/30 cursor-pointer")}
                        onClick={() => router.push(`/tasks?task=${t.id}`)}>
                        <button onClick={(e) => { e.stopPropagation(); void toggleExpand(t); }}
                          className="h-4 w-4 inline-flex items-center justify-center text-steel/60 hover:text-midnight" aria-label="Expand subtasks">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", STATUS_DOT[t.status] ?? "bg-slate-400")} />
                            <span className="text-[13px] text-midnight truncate">{t.title}</span>
                            {sites.map((e, i) => (
                              <span key={i} className={cn("flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                e.type === "building" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700")}>
                                {e.name}
                              </span>
                            ))}
                          </div>
                          <div className="text-[11px] text-steel/70 truncate pl-3.5">
                            {programmeOf(t)}{initOf(t) ? ` · ${initOf(t)!.name}` : ""}
                          </div>
                        </div>
                        <span className="text-[12px] text-steel truncate">{memberName(t.primary_stakeholder_id)}</span>
                        <span className="text-[12px] text-steel">{fmtDate(t.start_date)}</span>
                        <span className={cn("text-[12px]", isOverdue(t.due_date, t.status) ? "text-red-600 font-medium" : "text-steel")}>{fmtDate(t.due_date)}</span>
                        <span className={cn("text-[11.5px] font-medium capitalize", PRIORITY_BADGE[t.priority])}>{t.priority}</span>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Select value={t.status} onChange={(v) => setStatus(t.id, v)}
                            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} size="sm" className="w-full" />
                        </div>
                      </div>
                      {/* Sub-tasks */}
                      {isOpen && (subtasks[t.id] ?? []).map((s) => (
                        <div key={s.id} className={cn(COLS, "px-3.5 py-1.5 border-t border-pebble/40 bg-mist/10 hover:bg-mist/30 cursor-pointer")}
                          onClick={() => router.push(`/tasks?subtask=${s.id}`)}>
                          <span />
                          <div className="flex items-center gap-1.5 min-w-0 pl-5">
                            <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", STATUS_DOT[s.status] ?? "bg-slate-400")} />
                            <span className="text-[12.5px] text-steel truncate">{s.title}</span>
                          </div>
                          <span className="text-[12px] text-steel/80 truncate">{s.assignee_name || memberName(s.assignee_id) }</span>
                          <span className="text-[12px] text-steel/80">{fmtDate(s.start_date)}</span>
                          <span className="text-[12px] text-steel/80">{fmtDate(s.due_date)}</span>
                          <span />
                          <span className="text-[11px] text-steel/70">{STATUS_LABEL[s.status] ?? s.status}</span>
                        </div>
                      ))}
                      {isOpen && subtasks[t.id] && subtasks[t.id].length === 0 && (
                        <div className="px-3.5 py-1.5 pl-12 border-t border-pebble/40 bg-mist/10 text-[11.5px] text-steel/60">No sub-tasks.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
