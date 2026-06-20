"use client";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/ui";
import MyDay from "../my-day/page";
import DailyBrief from "../daily-brief/page";
import Portfolio from "../portfolio/page";
import Nudges from "../nudges/page";
import Company from "../company/page";

type RiskItem = { id: string; name: string; score: number; reasons: string[] };

/**
 * Predictive-risk banner (deck: "AI risk banner — predictive reschedule").
 * Synthesizes a one-line narrative from the deterministic /risk model so the
 * highest-risk initiative greets the user the moment they land on Home.
 */
function RiskBanner() {
  const [top, setTop] = useState<RiskItem | null>(null);
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    apiFetch(`/api/v1/risk?business_id=${bid}`)
      .then((d) => {
        const items: RiskItem[] = d?.items ?? [];
        setTop(items[0] ?? null);
        setCount(items.length);
      })
      .catch(() => { /* best-effort */ });
  }, []);

  if (!top || dismissed) return null;
  const narrative = `“${top.name}” is your highest-risk initiative — ${top.reasons.join(", ")}.`;
  return (
    <div className="max-w-5xl mx-auto px-4 mt-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <p className="text-[12.5px] text-amber-900 flex-1">
          {narrative}
          {count > 1 && <span className="text-amber-700"> {count - 1} more need attention.</span>}
        </p>
        <a href="/insights?tab=risk" className="text-[12px] font-semibold text-amber-800 hover:underline whitespace-nowrap">Risk radar →</a>
        <button type="button" onClick={() => setDismissed(true)} className="text-amber-600/70 hover:text-amber-900" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Home — the merged cockpit (nav 10→7). Reuses the existing My Day / Daily
 * Brief / Portfolio / Nudges pages as tabs (no rewrite); the old routes still
 * work for deep links. Each tab is wrapped in Suspense because some embedded
 * pages use useSearchParams.
 */
const TABS = [
  { key: "focus", label: "My Day", Comp: MyDay },
  { key: "brief", label: "Daily Brief", Comp: DailyBrief },
  { key: "portfolio", label: "Portfolio", Comp: Portfolio },
  { key: "nudges", label: "Nudges", Comp: Nudges },
  { key: "company", label: "Company", Comp: Company },
] as const;

export default function HomePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("focus");
  const Active = TABS.find((t) => t.key === tab)!.Comp;
  return (
    <div>
      <RiskBanner />
      <div className="border-b border-pebble bg-white px-4">
        <div className="flex gap-1 max-w-5xl mx-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "px-3 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors",
                tab === t.key
                  ? "border-taskora-red text-midnight"
                  : "border-transparent text-steel hover:text-midnight",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<div className="p-6 text-sm text-steel">Loading…</div>}>
        <Active />
      </Suspense>
    </div>
  );
}
