"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Workflow, Lock, Plus, X, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * P6 — initiative dependencies / critical path. Lists the program's initiatives
 * grouped by `stage` (longest prerequisite chain), flags the ones blocked by an
 * unfinished prerequisite, and lets owner/admin/lead wire the edges (cycles are
 * rejected server-side). Renders nothing when there's nothing meaningful to show.
 */
type DepRef = { id: string; name: string; status: string; done: boolean };
type Item = {
  id: string;
  name: string;
  status: string;
  stage: number;
  depends_on: DepRef[];
  blocked: boolean;
  blocked_by: DepRef[];
  blocks: string[];
};

export function ProgramDependencies({ programId, canEdit }: { programId: string; canEdit: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/dependencies`);
      setItems(r?.initiatives ?? []);
    } catch {
      /* table/column may not exist pre-migration — leave hidden */
    } finally {
      setLoaded(true);
    }
  }, [programId]);
  useEffect(() => { load(); }, [load]);

  const setDeps = async (initiativeId: string, depIds: string[]) => {
    setMsg(null);
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/dependencies`, {
        method: "PUT",
        body: JSON.stringify({ initiative_id: initiativeId, depends_on: depIds }),
      });
      setItems(r?.initiatives ?? []);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "";
      setMsg(/cycle/i.test(m) ? "That would create a dependency cycle." : "Couldn't update dependencies.");
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const stages = useMemo(() => {
    const map = new Map<number, Item[]>();
    for (const i of items) {
      if (!map.has(i.stage)) map.set(i.stage, []);
      map.get(i.stage)!.push(i);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);
  const blockedCount = items.filter((i) => i.blocked).length;

  if (!loaded) return null;
  if (items.length < 2 && !canEdit) return null;

  return (
    <section className="bg-white rounded-2xl border border-pebble shadow-sm p-5 mb-8">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-midnight">
          <Workflow className="w-4 h-4 text-taskora-red" /> Dependencies
        </h2>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
          blockedCount > 0 ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
        }`}>
          {blockedCount > 0 ? `${blockedCount} blocked` : "No blockers"}
        </span>
      </div>
      <p className="text-xs text-steel mb-3">Sequence by prerequisite — each stage can run once the stage before it is done.</p>

      {msg && <p className="flex items-center gap-1.5 text-xs text-red-600 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> {msg}</p>}

      <div className="space-y-3">
        {stages.map(([stage, group]) => (
          <div key={stage}>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-steel/60 mb-1">
              Stage {stage + 1}{stage === 0 ? " · no prerequisites" : ""}
            </div>
            <div className="space-y-1.5">
              {group.map((i) => {
                const candidates = items.filter(
                  (o) => o.id !== i.id && !i.depends_on.some((d) => d.id === o.id),
                );
                return (
                  <div key={i.id} className="rounded-lg border border-pebble px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {i.blocked && <Lock className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                      <span className="text-sm font-medium text-midnight truncate">{i.name}</span>
                      {i.blocked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-50 text-red-600 border border-red-200">blocked</span>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => setEditing(editing === i.id ? null : i.id)}
                          className="ml-auto text-[11px] text-ocean font-semibold hover:underline flex-shrink-0"
                        >
                          {editing === i.id ? "Done" : "Edit"}
                        </button>
                      )}
                    </div>

                    {(i.depends_on.length > 0 || editing === i.id) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        <span className="text-[11px] text-steel/70">Waits on:</span>
                        {i.depends_on.length === 0 && <span className="text-[11px] text-steel/50 italic">nothing</span>}
                        {i.depends_on.map((d) => (
                          <span key={d.id} className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${
                            d.done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}>
                            {d.name}
                            {canEdit && editing === i.id && (
                              <button
                                onClick={() => setDeps(i.id, i.depends_on.filter((x) => x.id !== d.id).map((x) => x.id))}
                                className="hover:text-red-600" aria-label={`Remove ${d.name}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))}
                        {canEdit && editing === i.id && candidates.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) setDeps(i.id, [...i.depends_on.map((d) => d.id), e.target.value]); }}
                            className="text-[11px] border border-pebble rounded-full px-2 py-0.5 bg-white text-steel focus:outline-none focus:border-ocean"
                          >
                            <option value="">+ add</option>
                            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
