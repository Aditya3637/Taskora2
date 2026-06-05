"use client";
import { useEffect, useState } from "react";
import { Users, Building2, Briefcase } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * P5 — program accountability. Two rollups a lead/founder reads at a glance:
 *  • Owner load — who is carrying (and overdue on) the program's tasks.
 *  • By site    — how each building/client is tracking.
 * Read-only, best-effort; renders nothing when there's no data.
 */
type Row = {
  name: string;
  total: number;
  done: number;
  open: number;
  overdue: number;
  completion_pct: number | null;
};
type Owner = Row & { user_id: string };
type Site = Row & { entity_type: "building" | "client"; entity_id: string };

function initials(name: string): string {
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((x) => x[0]?.toUpperCase() ?? "").join("") || "?";
}

function RollupRow({ label, leading, row }: { label: string; leading: React.ReactNode; row: Row }) {
  const denom = row.done + row.open;
  return (
    <div className="flex items-center gap-3 py-2">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-midnight font-medium truncate">{label}</span>
          <span className="text-[11px] text-steel/70 flex-shrink-0">
            {row.completion_pct == null ? "—" : `${row.completion_pct}%`}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-pebble overflow-hidden my-1">
          <div className="h-full bg-emerald-500" style={{ width: `${denom ? (row.done / denom) * 100 : 0}%` }} />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-steel">
          <span>{row.open} open</span>
          {row.overdue > 0 && <span className="text-red-600 font-medium">{row.overdue} overdue</span>}
          <span className="text-steel/50 ml-auto">{row.total} total</span>
        </div>
      </div>
    </div>
  );
}

export function ProgramAccountability({ programId }: { programId: string }) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiFetch(`/api/v1/programs/${programId}/accountability`)
      .then((r: { owners?: Owner[]; sites?: Site[] }) => {
        setOwners(r?.owners ?? []);
        setSites(r?.sites ?? []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [programId]);

  if (!loaded || (owners.length === 0 && sites.length === 0)) return null;

  return (
    <section className="bg-white rounded-2xl border border-pebble shadow-sm p-5 mb-8">
      <h2 className="text-sm font-bold text-midnight mb-1">Accountability</h2>
      <p className="text-xs text-steel mb-3">Who&apos;s carrying the work, and how each site is tracking.</p>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
        {/* Owner load */}
        <div>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">
            <Users className="w-3.5 h-3.5" /> Owner load
          </h3>
          {owners.length === 0 ? (
            <p className="text-xs text-steel/60 italic py-2">No task owners yet.</p>
          ) : (
            <div className="divide-y divide-pebble/50">
              {owners.map((o) => (
                <RollupRow
                  key={o.user_id}
                  label={o.name}
                  row={o}
                  leading={
                    <div className="w-7 h-7 rounded-full bg-ocean/10 flex items-center justify-center text-[10px] font-semibold text-ocean flex-shrink-0">
                      {initials(o.name)}
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>
        {/* By site */}
        <div>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">
            <Building2 className="w-3.5 h-3.5" /> By site
          </h3>
          {sites.length === 0 ? (
            <p className="text-xs text-steel/60 italic py-2">No tasks are linked to a building or client yet.</p>
          ) : (
            <div className="divide-y divide-pebble/50">
              {sites.map((s) => {
                const Icon = s.entity_type === "client" ? Briefcase : Building2;
                return (
                  <RollupRow
                    key={`${s.entity_type}:${s.entity_id}`}
                    label={s.name}
                    row={s}
                    leading={
                      <div className="w-7 h-7 rounded-lg bg-mist flex items-center justify-center flex-shrink-0">
                        <Icon className="w-3.5 h-3.5 text-steel" />
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
