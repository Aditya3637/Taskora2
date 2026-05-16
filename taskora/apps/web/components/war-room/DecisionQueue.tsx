"use client";
import { useState } from "react";
import type { QueueTask } from "./types";

export function DecisionQueue({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: QueueTask[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Urgent", "High", "Medium"];
  const filtered =
    filter === "All" ? tasks : tasks.filter((t) => t.priority === filter.toLowerCase());

  return (
    <div className="p-4">
      <h2 className="text-midnight font-semibold text-lg mb-1">Decision Queue</h2>
      <p className="text-xs text-steel mb-4">{tasks.length} need attention</p>
      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              filter === f
                ? "border-taskora-red text-taskora-red bg-red-50"
                : "border-pebble text-steel hover:border-taskora-red hover:text-taskora-red"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="text-steel text-sm text-center py-8">No pending decisions</p>
      )}
      {filtered.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`w-full text-left mb-3 p-4 bg-white rounded-xl border cursor-pointer transition-all ${
            selectedId === t.id ? "border-ocean shadow-md" : "border-pebble hover:border-steel"
          } ${t.priority === "urgent" ? "border-l-4 border-l-taskora-red" : ""}`}
        >
          {(t.program_name || t.initiative_name) && (
            <p className="text-[11px] text-steel/70 mb-0.5 truncate">
              {t.program_name}
              {t.program_name && t.initiative_name && " › "}
              {t.initiative_name}
            </p>
          )}
          <p className="text-midnight font-medium text-sm mb-1">{t.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={`px-2 py-0.5 rounded-full font-semibold ${
                t.status === "blocked"
                  ? "bg-red-50 text-red-800"
                  : "bg-purple-50 text-purple-800"
              }`}
            >
              {t.status.replace("_", " ")}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-mist text-steel">{t.priority}</span>
            {t.age_label && <span className="text-steel/60">⏱ {t.age_label}</span>}
            {!!t.days_overdue && t.days_overdue > 0 && (
              <span className="text-red-700 font-semibold">{t.days_overdue}d overdue</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
