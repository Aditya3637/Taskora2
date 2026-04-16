"use client";
import { useState } from "react";

interface QueueTask {
  id: string;
  title: string;
  priority: string;
  created_at: string;
  task_entities: { entity_id: string; per_entity_status: string }[];
}

export function DecisionQueue() {
  const [tasks] = useState<QueueTask[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");

  const filters = ["All", "Urgent", "High", "Medium"];
  const filtered = filter === "All" ? tasks : tasks.filter((t) => t.priority === filter.toLowerCase());

  return (
    <div className="p-4">
      <h2 className="text-midnight font-semibold text-lg mb-4">Decision Queue</h2>
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
        <div
          key={t.id}
          onClick={() => setSelected(t.id)}
          className={`mb-3 p-4 bg-white rounded-xl border cursor-pointer transition-all ${
            selected === t.id ? "border-ocean shadow-md" : "border-pebble hover:border-steel"
          } ${t.priority === "urgent" ? "border-taskora-red" : ""}`}
        >
          <p className="text-midnight font-medium text-sm mb-1">{t.title}</p>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                t.priority === "urgent" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"
              }`}
            >
              {t.priority}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
