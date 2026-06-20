"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/ui";

type RiskItem = {
  id: string;
  name: string;
  score: number;
  reasons: string[];
  drift_days: number;
  overdue: number;
  blocked: number;
  pushes: number;
};

function band(score: number): { label: string; cls: string; bar: string } {
  if (score >= 40) return { label: "High", cls: "text-taskora-red", bar: "bg-taskora-red" };
  if (score >= 15) return { label: "Elevated", cls: "text-amber-600", bar: "bg-amber-500" };
  return { label: "Watch", cls: "text-steel", bar: "bg-steel/50" };
}

export default function RiskPage() {
  const [items, setItems] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    setLoading(true);
    try {
      const d = await apiFetch(`/api/v1/risk?business_id=${encodeURIComponent(bid)}`);
      setItems(Array.isArray(d?.items) ? d.items : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...items.map((i) => i.score));

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <h1 className="text-xl font-bold text-midnight">Risk radar</h1>
      </div>
      <p className="text-sm text-steel mb-4">
        Initiatives most likely to slip — ranked by baseline drift, repeated date pushes, and overdue/blocked load.
      </p>

      {loading ? (
        <p className="text-sm text-steel py-8 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-pebble bg-white px-4 py-12 text-center">
          <p className="text-[15px] font-semibold text-midnight">Nothing trending at risk 🎉</p>
          <p className="text-[12.5px] text-steel mt-1">No baseline drift, repeated pushes, overdue or blocked work.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const b = band(it.score);
            return (
              <div key={it.id} className="rounded-xl border border-pebble bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-midnight truncate">{it.name}</div>
                    <div className="text-[12px] text-steel">{it.reasons.join(" · ")}</div>
                  </div>
                  <span className={cn("text-[11px] font-bold uppercase tracking-wide", b.cls)}>{b.label}</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-pebble overflow-hidden">
                  <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${Math.round((it.score / max) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
