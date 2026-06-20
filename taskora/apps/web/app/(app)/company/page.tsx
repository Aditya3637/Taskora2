"use client";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/components/ui";

type WS = {
  id: string;
  name: string;
  role: string;
  is_owner: boolean;
  open: number;
  overdue: number;
  blocked: number;
  done: number;
  health: "ok" | "warn" | "bad";
};
type Overview = {
  company: { id: string; name: string } | null;
  workspaces: WS[];
  totals: { open: number; overdue: number; blocked: number; done: number; workspaces: number };
};

const DOT: Record<WS["health"], string> = {
  ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-taskora-red",
};

export default function CompanyPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    setLoading(true);
    try {
      const { apiFetch } = await import("@/lib/api");
      const d = await apiFetch(`/api/v1/companies/overview?business_id=${encodeURIComponent(bid)}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function switchTo(id: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem("business_id", id);
    window.location.reload();
  }

  const activeId = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";

  if (loading) return <div className="p-6 text-sm text-steel">Loading…</div>;
  if (!data) return <div className="p-6 text-sm text-steel">Couldn’t load the company view.</div>;

  const t = data.totals;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <h1 className="text-xl font-bold text-midnight mb-1">
        {data.company?.name || "Company"}
      </h1>
      <p className="text-sm text-steel mb-4">
        Health across {t.workspaces} workspace{t.workspaces === 1 ? "" : "s"} you belong to in this company.
      </p>

      {/* Company totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Workspaces", val: t.workspaces, cls: "text-midnight" },
          { label: "Overdue", val: t.overdue, cls: t.overdue ? "text-taskora-red" : "text-midnight" },
          { label: "Blocked", val: t.blocked, cls: t.blocked ? "text-amber-600" : "text-midnight" },
          { label: "Open", val: t.open, cls: "text-midnight" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-pebble bg-white px-4 py-3">
            <div className={cn("text-2xl font-bold", m.cls)}>{m.val}</div>
            <div className="text-[12px] text-steel">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Per-workspace cards */}
      <div className="space-y-2">
        {data.workspaces.map((w) => (
          <div key={w.id} className="rounded-xl border border-pebble bg-white px-4 py-3 flex items-center gap-3">
            <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", DOT[w.health])} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-midnight truncate">
                {w.name}
                {w.id === activeId && <span className="ml-2 text-[10.5px] text-taskora-red font-medium">active</span>}
              </div>
              <div className="text-[11.5px] text-steel capitalize">{w.role}{w.is_owner ? " · owner" : ""}</div>
            </div>
            <div className="flex items-center gap-4 text-center">
              <div><div className={cn("text-[14px] font-semibold", w.overdue ? "text-taskora-red" : "text-steel")}>{w.overdue}</div><div className="text-[10px] text-steel/60">overdue</div></div>
              <div><div className={cn("text-[14px] font-semibold", w.blocked ? "text-amber-600" : "text-steel")}>{w.blocked}</div><div className="text-[10px] text-steel/60">blocked</div></div>
              <div><div className="text-[14px] font-semibold text-steel">{w.open}</div><div className="text-[10px] text-steel/60">open</div></div>
            </div>
            {w.id !== activeId && (
              <button
                type="button"
                onClick={() => switchTo(w.id)}
                className="ml-2 h-8 px-3 rounded-lg border border-pebble text-[12.5px] font-semibold text-midnight hover:bg-mist"
              >
                Open
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
