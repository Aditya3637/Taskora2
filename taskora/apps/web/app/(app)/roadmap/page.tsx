"use client";
import { Suspense, useState } from "react";
import { cn } from "@/components/ui";
import Gantt from "../gantt/page";
import Programs from "../programs/page";
import TaskListView from "./_components/TaskListView";

/**
 * Roadmap — merged Programs + Gantt + a flat task List (nav 10→7). Timeline is
 * the default tab (the heart). Reuses the existing pages as tabs; old routes
 * still work.
 */
const TABS = [
  { key: "timeline", label: "Timeline", Comp: Gantt },
  { key: "list", label: "List", Comp: TaskListView },
  { key: "programs", label: "Programmes", Comp: Programs },
] as const;

export default function RoadmapPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("timeline");
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
