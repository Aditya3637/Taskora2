"use client";
import { useCallback, useEffect, useState } from "react";
import { Flag, Plus, X, Circle, CheckCircle2, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * P4 — program milestones on a timeline. A horizontal track positions dated
 * milestones between the earliest and latest date (with a "today" line); the
 * list below is the actionable part (mark done / delete / add). Owner/admin/lead
 * get the edit affordances; everyone reads.
 */
type Milestone = {
  id: string;
  name: string;
  date: string | null;
  completed_at: string | null;
  status: "done" | "overdue" | "upcoming";
};

const STATUS_DOT: Record<string, string> = {
  done: "text-emerald-500",
  overdue: "text-red-500",
  upcoming: "text-ocean",
};
const TRACK_DOT: Record<string, string> = {
  done: "bg-emerald-500",
  overdue: "bg-red-500",
  upcoming: "bg-ocean",
};

function fmt(d: string | null): string {
  if (!d) return "No date";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ProgramMilestones({ programId, canEdit }: { programId: string; canEdit: boolean }) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch(`/api/v1/programs/${programId}/milestones`));
    } catch {
      /* table may not exist pre-migration — leave hidden */
    } finally {
      setLoaded(true);
    }
  }, [programId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/programs/${programId}/milestones`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), date: dateStr || null }),
      });
      setName(""); setDateStr(""); setAdding(false);
      await load();
    } catch { /* surfaced by disabled state; keep form open */ } finally { setBusy(false); }
  };
  const toggle = async (m: Milestone) => {
    await apiFetch(`/api/v1/programs/${programId}/milestones/${m.id}`, {
      method: "PATCH", body: JSON.stringify({ completed: m.status !== "done" }),
    });
    await load();
  };
  const remove = async (m: Milestone) => {
    if (!confirm(`Delete milestone "${m.name}"?`)) return;
    await apiFetch(`/api/v1/programs/${programId}/milestones/${m.id}`, { method: "DELETE" });
    await load();
  };

  if (!loaded) return null;
  if (items.length === 0 && !canEdit) return null;

  // Timeline geometry: position dated milestones across [min, max].
  const dated = items.filter((m) => m.date).map((m) => ({ ...m, t: new Date(m.date! + "T00:00:00").getTime() }));
  const times = dated.map((d) => d.t);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min;
  const pos = (t: number) => (span > 0 ? ((t - min) / span) * 100 : 50);
  const todayT = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  const showTrack = dated.length >= 2 && span > 0;

  return (
    <section className="bg-white rounded-2xl border border-pebble shadow-sm p-5 mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-midnight">
          <Flag className="w-4 h-4 text-taskora-red" /> Milestones
        </h2>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-ocean font-semibold hover:underline">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {showTrack && (
        <div className="relative h-10 mb-4 mx-1">
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-pebble rounded-full" />
          {todayT >= min && todayT <= max && (
            <div className="absolute top-0 bottom-0 w-px bg-steel/40" style={{ left: `${pos(todayT)}%` }} title="Today" />
          )}
          {dated.map((m) => (
            <div
              key={m.id}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `${pos(m.t)}%` }}
            >
              <span className={`block w-3 h-3 rounded-full ring-2 ring-white ${TRACK_DOT[m.status]}`} />
              <span className="absolute left-1/2 -translate-x-1/2 top-4 whitespace-nowrap text-[10px] text-steel opacity-0 group-hover:opacity-100 transition-opacity">
                {m.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg bg-mist/50">
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Milestone name" maxLength={120}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            className="flex-1 min-w-40 h-8 px-2.5 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
          />
          <input
            type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)}
            className="h-8 px-2 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
          />
          <button onClick={add} disabled={busy || !name.trim()} className="h-8 px-3 bg-taskora-red text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">Add</button>
          <button onClick={() => { setAdding(false); setName(""); setDateStr(""); }} className="h-8 w-8 flex items-center justify-center text-steel hover:text-midnight"><X className="w-4 h-4" /></button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-steel/60 italic">No milestones yet. Add key dates to track the program against its plan.</p>
      ) : (
        <div className="divide-y divide-pebble/50">
          {items.map((m) => {
            const Icon = m.status === "done" ? CheckCircle2 : m.status === "overdue" ? AlertCircle : Circle;
            return (
              <div key={m.id} className="flex items-center gap-3 py-2 group">
                {canEdit ? (
                  <button onClick={() => toggle(m)} title={m.status === "done" ? "Mark not done" : "Mark done"} className={STATUS_DOT[m.status]}>
                    <Icon className="w-4 h-4" />
                  </button>
                ) : (
                  <Icon className={`w-4 h-4 ${STATUS_DOT[m.status]}`} />
                )}
                <span className={`text-sm font-medium truncate ${m.status === "done" ? "text-steel line-through" : "text-midnight"}`}>{m.name}</span>
                <span className={`text-xs ml-auto flex-shrink-0 ${m.status === "overdue" ? "text-red-600 font-medium" : "text-steel/70"}`}>{fmt(m.date)}</span>
                {canEdit && (
                  <button onClick={() => remove(m)} className="text-steel/40 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" aria-label="Delete milestone">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
