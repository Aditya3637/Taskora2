"use client";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Select } from "@/components/ui";

/**
 * Shared ordered-step editor for process templates — used by both the "apply a
 * process" modal (authoring a fresh template) and the workspace Template Library
 * (editing a saved one). Keeps one source of truth for the step-row UI and the
 * two-way mapping between editor state and the API step shape.
 */
export type Member = { user_id: string; name?: string; email?: string };
export type Step = {
  title: string; description: string; duration_days: number;
  dependsOnPrev: boolean; ownerId: string; gate: boolean;
};
export const EMPTY_STEP: Step = {
  title: "", description: "", duration_days: 1, dependsOnPrev: false, ownerId: "", gate: false,
};

/** DB template steps → editor state. "after prev" is inferred from depends_on. */
export function stepsFromTemplate(dbSteps: any[]): Step[] {
  return [...(dbSteps ?? [])]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((s) => ({
      title: s.title ?? "",
      description: s.description ?? "",
      duration_days: s.duration_days ?? 1,
      dependsOnPrev: Array.isArray(s.depends_on) && s.depends_on.includes((s.order_index ?? 0) - 1),
      ownerId: s.default_owner_id ?? "",
      gate: !!s.gate,
    }));
}

/** Editor state → API steps[] payload (drops blank-title rows). */
export function stepsToPayload(steps: Step[]) {
  return steps
    .filter((s) => s.title.trim())
    .map((s, i) => ({
      title: s.title.trim(),
      description: s.description.trim() || null,
      duration_days: Math.max(0, s.duration_days || 1),
      depends_on: s.dependsOnPrev && i > 0 ? [i - 1] : [],
      default_owner_id: s.ownerId || null,
      gate: s.gate,
    }));
}

export function StepsEditor({
  steps, setSteps, members,
}: {
  steps: Step[];
  setSteps: React.Dispatch<React.SetStateAction<Step[]>>;
  members: Member[];
}) {
  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="rounded-lg border border-pebble/70 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex flex-col -my-1">
                <button onClick={() => moveStep(i, -1)} disabled={i === 0}
                  className="text-steel/40 hover:text-midnight disabled:opacity-20 disabled:hover:text-steel/40" aria-label="Move step up">
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}
                  className="text-steel/40 hover:text-midnight disabled:opacity-20 disabled:hover:text-steel/40" aria-label="Move step down">
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              <span className="text-[11px] text-steel/60 w-4">{i + 1}</span>
              <input value={s.title} onChange={(e) => updateStep(i, { title: e.target.value })}
                placeholder={`Step ${i + 1} (e.g. Survey)`}
                className="flex-1 border border-pebble rounded px-2 py-1.5 text-[13px] focus:outline-none focus:border-ocean" />
              <div className="flex items-center gap-1">
                <input type="number" min={0} value={s.duration_days}
                  onChange={(e) => updateStep(i, { duration_days: parseInt(e.target.value) || 0 })}
                  className="w-14 border border-pebble rounded px-1.5 py-1.5 text-[12px] text-center focus:outline-none focus:border-ocean" />
                <span className="text-[11px] text-steel/60">days</span>
              </div>
              <button onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
                className="text-steel/40 hover:text-red-600" aria-label="Remove step">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <input value={s.description} onChange={(e) => updateStep(i, { description: e.target.value })}
              placeholder="Notes for whoever runs this step (optional)"
              className="w-full ml-6 max-w-[calc(100%-1.5rem)] border border-pebble/70 rounded px-2 py-1 text-[12px] text-steel focus:outline-none focus:border-ocean" />
            <div className="flex items-center gap-2 pl-6 flex-wrap">
              <Select value={s.ownerId} onChange={(v) => updateStep(i, { ownerId: v })} size="sm" className="w-[150px]"
                options={[{ value: "", label: "Owner: default" }, ...members.map((m) => ({ value: m.user_id, label: m.name || m.email || "Member" }))]} />
              {i > 0 && (
                <label className="flex items-center gap-1 text-[11px] text-steel cursor-pointer" title="This step waits for the previous one (same site)">
                  <input type="checkbox" checked={s.dependsOnPrev}
                    onChange={(e) => updateStep(i, { dependsOnPrev: e.target.checked })}
                    className="accent-taskora-red" /> after prev
                </label>
              )}
              {i > 0 && (
                <label className="flex items-center gap-1 text-[11px] text-steel cursor-pointer" title="Gate: wait until ALL sites finish the previous step before any site starts this one">
                  <input type="checkbox" checked={s.gate}
                    onChange={(e) => updateStep(i, { gate: e.target.checked })}
                    className="accent-ocean" /> 🚦 gate all sites
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setSteps((p) => [...p, { ...EMPTY_STEP, dependsOnPrev: true }])}
        className="inline-flex items-center gap-1 text-[12px] text-taskora-red font-semibold">
        <Plus className="h-3.5 w-3.5" /> Add step
      </button>
    </div>
  );
}
