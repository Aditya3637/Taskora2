"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronRight, ChevronDown, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * WorkTable — the redesigned Work surface (additive; rendered alongside the
 * legacy List/Board). Built for 200-300 tasks: every filter/sort/group/search
 * is evaluated server-side over the WHOLE workspace via POST /tasks/query, rows
 * are dense, and pages stream in on scroll. Row click reuses the page's detail
 * sheet via onOpenTask.
 */
type Member = { user_id: string; name?: string; email?: string };
type Initiative = { id: string; name: string };
type Group = { key: string; label: string; count: number; done: number };
export type WorkTask = {
  id: string; title: string; status: string; priority: string;
  due_date?: string | null; primary_stakeholder_id?: string | null;
  initiative_id?: string | null;
  task_entities?: { entity_id: string; entity_name?: string; entity_type?: string }[];
  [k: string]: any;
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog", todo: "To Do", in_progress: "In Progress",
  pending_decision: "Pending", blocked: "Blocked", done: "Done",
  reopened: "Reopened", archived: "Archived",
};
const STATUS_DOT: Record<string, string> = {
  backlog: "bg-gray-400", todo: "bg-gray-400", in_progress: "bg-blue-500",
  pending_decision: "bg-amber-500", blocked: "bg-red-500", done: "bg-emerald-500",
  reopened: "bg-red-500", archived: "bg-gray-300",
};
const PRIORITY_CHIP: Record<string, string> = {
  urgent: "bg-red-50 text-red-700", critical: "bg-red-100 text-red-800",
  high: "bg-amber-50 text-amber-700", medium: "bg-slate-50 text-slate-600",
  low: "bg-slate-50 text-slate-400",
};
const EDITABLE_STATUSES = ["todo", "in_progress", "pending_decision", "blocked", "done"];
const NON_DONE = ["todo", "in_progress", "pending_decision", "blocked", "backlog", "reopened"];

const VIEWS: { key: string; label: string; f: (me: string) => any }[] = [
  { key: "mine", label: "My open", f: (me) => ({ assignee_ids: [me], status: NON_DONE }) },
  { key: "overdue", label: "Overdue", f: () => ({ due: "overdue" }) },
  { key: "blocked", label: "Blocked", f: () => ({ blocked: true }) },
  { key: "unassigned", label: "Unassigned", f: () => ({ unassigned: true }) },
  { key: "week", label: "This week", f: () => ({ due: "week" }) },
  { key: "all", label: "All", f: () => ({}) },
];
const SORTS: { key: string; label: string; sort: any[] }[] = [
  { key: "recent", label: "Newest", sort: [{ field: "created_at", dir: "desc" }] },
  { key: "due", label: "Due date", sort: [{ field: "due_date", dir: "asc" }] },
  { key: "priority", label: "Priority", sort: [{ field: "priority", dir: "asc" }] },
  { key: "status", label: "Status", sort: [{ field: "status", dir: "asc" }] },
  { key: "title", label: "A–Z", sort: [{ field: "title", dir: "asc" }] },
];
const GROUPS = [
  { key: "none", label: "No grouping" }, { key: "status", label: "Status" },
  { key: "initiative", label: "Initiative" }, { key: "assignee", label: "Assignee" },
  { key: "priority", label: "Priority" }, { key: "due", label: "Due" },
];
const PAGE = 50;
const COLS =
  "grid grid-cols-[20px_136px_minmax(0,1fr)_84px_128px_92px] gap-2 items-center";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function isOverdue(due?: string | null, status?: string) {
  return !!due && status !== "done" && status !== "archived" && due.slice(0, 10) < todayISO();
}
function dueBucket(due?: string | null, status?: string): string {
  if (!due) return "none";
  const d = due.slice(0, 10), t = todayISO();
  const wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  if (status !== "done" && status !== "archived" && d < t) return "overdue";
  if (d === t) return "today";
  if (d <= wk) return "week";
  return "later";
}
function fmtDue(due?: string | null) {
  if (!due) return "";
  return new Date(due.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkTable({
  businessId, currentUserId, members, initiatives, onOpenTask,
}: {
  businessId: string;
  currentUserId: string;
  members: Member[];
  initiatives: Initiative[];
  onOpenTask: (task: WorkTask) => void;
}) {
  const [viewKey, setViewKey] = useState("mine");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortKey, setSortKey] = useState("recent");
  const [groupBy, setGroupBy] = useState("none");
  const [compact, setCompact] = useState(false);

  const [items, setItems] = useState<WorkTask[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");

  const memberName = useMemo(() => {
    const m = new Map(members.map((x) => [x.user_id, x.name || x.email || "Member"]));
    return (id?: string | null) => (id ? m.get(id) || "—" : "Unassigned");
  }, [members]);
  const initName = useMemo(() => {
    const m = new Map(initiatives.map((x) => [x.id, x.name]));
    return (id?: string | null) => (id ? m.get(id) || "" : "");
  }, [initiatives]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const buildBody = useCallback((offset: number) => {
    const view = VIEWS.find((v) => v.key === viewKey)!;
    const filters: any = view.f(currentUserId);
    if (debounced) filters.search = debounced;
    return {
      business_id: businessId, filters,
      sort: SORTS.find((s) => s.key === sortKey)!.sort,
      group_by: groupBy, limit: PAGE, offset,
    };
  }, [viewKey, debounced, sortKey, groupBy, businessId, currentUserId]);

  const fetchPage = useCallback(async (reset: boolean, offset: number) => {
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const res = await apiFetch("/api/v1/tasks/query", {
        method: "POST", body: JSON.stringify(buildBody(offset)),
      });
      const newItems: WorkTask[] = Array.isArray(res?.items) ? res.items : [];
      setItems((prev) => (reset ? newItems : [...prev, ...newItems]));
      setTotal(res?.total ?? 0);
      setGroups(Array.isArray(res?.groups) ? res.groups : []);
      setHasMore(!!res?.has_more);
    } catch {
      if (reset) { setItems([]); setTotal(0); setGroups([]); setHasMore(false); }
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }, [buildBody]);

  // Refetch from scratch whenever the query shape changes.
  useEffect(() => {
    setSelected(new Set());
    void fetchPage(true, 0);
  }, [fetchPage]);

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
        void fetchPage(false, items.length);
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, items.length, fetchPage]);

  async function setStatus(id: string, status: string) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try { await apiFetch(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); }
    catch { void fetchPage(true, 0); }
  }

  async function applyBulk() {
    if (!bulkStatus || selected.size === 0) return;
    const ids = Array.from(selected);
    setItems((prev) => prev.map((t) => (selected.has(t.id) ? { ...t, status: bulkStatus } : t)));
    setSelected(new Set()); setBulkStatus("");
    try { await apiFetch("/api/v1/tasks/bulk-update", { method: "POST", body: JSON.stringify({ task_ids: ids, status: bulkStatus }) }); }
    catch { void fetchPage(true, 0); }
  }

  function groupKeyOf(t: WorkTask): string {
    if (groupBy === "initiative") return t.initiative_id || "—";
    if (groupBy === "status") return t.status || "—";
    if (groupBy === "assignee") return t.primary_stakeholder_id || "__unassigned__";
    if (groupBy === "priority") return t.priority || "—";
    if (groupBy === "due") return dueBucket(t.due_date, t.status);
    return "";
  }

  const rowPad = compact ? "py-1" : "py-2";
  let lastGroup: string | null = null;

  return (
    <div className="flex flex-col h-full">
      {/* Saved views */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setViewKey(v.key)}
            className={`px-2.5 h-7 rounded-full text-[12px] font-medium border transition-colors ${
              viewKey === v.key
                ? "bg-midnight text-white border-midnight"
                : "bg-white text-steel border-pebble hover:text-midnight hover:border-steel/40"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-steel/50" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all tasks…"
            className="w-full border border-pebble rounded-lg pl-8 pr-3 h-8 text-[13px] focus:outline-none focus:border-ocean" />
        </div>
        <LabeledSelect label="Group" value={groupBy} onChange={setGroupBy}
          options={GROUPS.map((g) => ({ value: g.key, label: g.label }))} />
        <LabeledSelect label="Sort" value={sortKey} onChange={setSortKey}
          options={SORTS.map((s) => ({ value: s.key, label: s.label }))} />
        <button onClick={() => setCompact((c) => !c)}
          className="h-8 px-2.5 rounded-lg border border-pebble text-[12px] text-steel hover:text-midnight">
          {compact ? "Comfortable" : "Compact"}
        </button>
        <span className="text-[12px] text-steel/70 ml-auto tabular-nums">
          {loading ? "…" : `${items.length} of ${total}`}
        </span>
      </div>

      {/* Header */}
      <div className={`${COLS} px-2.5 h-8 bg-mist/50 rounded-t-lg text-[10.5px] uppercase tracking-wide text-steel/70 font-semibold border border-pebble`}>
        <span />
        <span>Status</span><span>Task</span><span>Priority</span><span>Owner</span><span>Due</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto border-x border-b border-pebble rounded-b-lg">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-steel">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-steel">No tasks match this view.</div>
        ) : (
          items.map((t) => {
            const gk = groupBy !== "none" ? groupKeyOf(t) : null;
            const header = gk !== null && gk !== lastGroup ? gk : null;
            lastGroup = gk;
            const g = header !== null ? groupMap.get(header) : null;
            const ent = t.task_entities?.[0];
            return (
              <div key={t.id}>
                {header !== null && (
                  <div className="flex items-center gap-2 px-2.5 h-8 bg-mist/30 border-t border-pebble/60 sticky top-0 z-[1]">
                    <span className="text-[12px] font-semibold text-midnight">
                      {groupBy === "assignee" && header === "__unassigned__" ? "Unassigned"
                        : groupBy === "initiative" ? (initName(header) || "No initiative")
                        : groupBy === "assignee" ? memberName(header)
                        : groupBy === "status" ? (STATUS_LABELS[header] ?? header)
                        : header}
                    </span>
                    {g && (
                      <span className="text-[11px] text-steel/70">
                        {g.done}/{g.count}
                        <span className="inline-block ml-1.5 h-1.5 w-12 rounded-full bg-pebble overflow-hidden align-middle">
                          <span className="block h-full bg-emerald-500" style={{ width: `${g.count ? (g.done / g.count) * 100 : 0}%` }} />
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <div className={`${COLS} px-2.5 ${rowPad} border-t border-pebble/50 hover:bg-mist/30 group cursor-pointer`}
                  onClick={() => onOpenTask(t)}>
                  <input type="checkbox" checked={selected.has(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => setSelected((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                    className={`accent-taskora-red ${selected.has(t.id) ? "" : "opacity-0 group-hover:opacity-100"}`} />
                  <div onClick={(e) => e.stopPropagation()}>
                    <StatusPill value={t.status} onChange={(s) => setStatus(t.id, s)} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] text-midnight truncate">{t.title}</span>
                      {ent && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          ent.entity_type === "client" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
                          {ent.entity_name || "Site"}{(t.task_entities?.length ?? 0) > 1 ? ` +${t.task_entities!.length - 1}` : ""}
                        </span>
                      )}
                    </div>
                    {initName(t.initiative_id) && (
                      <div className="text-[11px] text-steel/60 truncate">{initName(t.initiative_id)}</div>
                    )}
                  </div>
                  <span className={`justify-self-start rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_CHIP[t.priority] ?? "text-steel/50"}`}>
                    {t.priority}
                  </span>
                  <span className="text-[12px] text-steel truncate">{memberName(t.primary_stakeholder_id)}</span>
                  <span className={`text-[12px] tabular-nums ${isOverdue(t.due_date, t.status) ? "text-red-600 font-medium" : "text-steel"}`}>
                    {fmtDue(t.due_date)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={sentinel} />
        {loadingMore && <div className="p-3 text-center text-[12px] text-steel/60">Loading more…</div>}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-3 rounded-xl bg-midnight text-white text-[13px] px-4 py-2.5 shadow-2xl">
          <span className="font-medium">{selected.size} selected</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}
            className="bg-white/10 border border-white/20 rounded px-2 h-7 text-[12.5px] focus:outline-none">
            <option value="" className="text-midnight">Set status…</option>
            {EDITABLE_STATUSES.map((s) => <option key={s} value={s} className="text-midnight">{STATUS_LABELS[s]}</option>)}
          </select>
          <button onClick={applyBulk} disabled={!bulkStatus}
            className="h-7 px-3 rounded bg-taskora-red font-semibold disabled:opacity-40">Apply</button>
          <button onClick={() => setSelected(new Set())} className="text-white/70 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function StatusPill({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="relative inline-flex items-center">
      <span className={`absolute left-2 h-2 w-2 rounded-full pointer-events-none ${STATUS_DOT[value] ?? "bg-gray-400"}`} />
      <select value={EDITABLE_STATUSES.includes(value) ? value : ""} onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-6 pr-2 h-7 w-full rounded-md border border-pebble bg-white text-[12px] text-midnight hover:border-steel/40 focus:outline-none focus:border-ocean cursor-pointer">
        {!EDITABLE_STATUSES.includes(value) && <option value="">{STATUS_LABELS[value] ?? value}</option>}
        {EDITABLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 h-8 px-2 rounded-lg border border-pebble text-[12px] text-steel">
      <span className="text-steel/60">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-midnight font-medium focus:outline-none cursor-pointer">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
