"use client";
import { Suspense, useState } from "react";
import { cn } from "@/components/ui";
import Analytics from "../analytics/page";
import WarRoom from "../war-room/page";
import Risk from "../risk/page";

/**
 * Insights — merged Analytics + War Room (nav 10→7). Reuses the existing pages
 * as tabs; old routes still work for deep links.
 */
const TABS = [
  { key: "analytics", label: "Analytics", Comp: Analytics },
  { key: "risk", label: "Risk radar", Comp: Risk },
  { key: "warroom", label: "War Room", Comp: WarRoom },
] as const;

export default function InsightsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("analytics");
  const Active = TABS.find((t) => t.key === tab)!.Comp;
  return (
    <div>
      <div className="border-b border-pebble bg-white px-4">
        <div className="flex gap-1 max-w-6xl mx-auto">
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
