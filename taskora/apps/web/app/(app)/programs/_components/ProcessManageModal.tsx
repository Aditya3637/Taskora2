"use client";
import { useEffect, useState } from "react";
import { X, Workflow, Calendar, Trash2, RefreshCw, Save, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { DatePicker, Select, cn } from "@/components/ui";

/**
 * Manage running process instances (Playbooks P3): reschedule a whole site's
 * chain, shift one step across all sites, or remove a site. Read-only list +
 * the three at-scale actions.
 */
type Instance = { id: string; label: string; entity_id: string; entity_type: string; start_date: string | null; template_id: string | null };
type Template = { id: string; name: string; steps: { id: string; title: string }[] };
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type BehindSite = { label: string; status: string; overdue: boolean };
type RollupStep = {
  step_id: string; title: string; order_index: number;
  total: number; done: number; in_progress: number; blocked: number;
  not_started: number; overdue: number; behind: BehindSite[];
};
type RollupTemplate = {
  template_id: string; name: string; sites: number; steps: RollupStep[];
  finish_date: string | null; slowest_site: string | null;
};

export function ProcessManageModal({
  initiativeId, businessId, initiativeName, onClose, onChanged, onApply,
}: {
  initiativeId: string;
  businessId: string;
  initiativeName: string;
  onClose: () => void;
  onChanged: () => void;
  onApply?: () => void;   // open the "apply a process to sites" flow
}) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rollup, setRollup] = useState<RollupTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Shift-step controls.
  const [stepId, setStepId] = useState("");
  const [stepDays, setStepDays] = useState(7);

  // Per-instance reschedule (which row's controls are expanded) + drill-in.
  const [openInst, setOpenInst] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = async () => {
    setLoading(true);
    try {
      const [inst, tpls, roll] = await Promise.all([
        apiFetch(`/api/v1/initiatives/${initiativeId}/process-instances`).catch(() => []),
        apiFetch(`/api/v1/process-templates?business_id=${businessId}`).catch(() => []),
        apiFetch(`/api/v1/initiatives/${initiativeId}/step-rollup`).catch(() => ({ templates: [] })),
      ]);
      setInstances(Array.isArray(inst) ? inst : []);
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setRollup(Array.isArray(roll?.templates) ? roll.templates : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [initiativeId]);

  // All steps across templates actually used by these instances.
  const usedTemplateIds = new Set(instances.map((i) => i.template_id).filter(Boolean));
  const stepOptions = templates
    .filter((t) => usedTemplateIds.has(t.id))
    .flatMap((t) => t.steps.map((s) => ({ value: s.id, label: `${s.title} (${t.name})` })));

  async function reschedule(inst: Instance, days: number) {
    if (!days) return;
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/api/v1/process-instances/${inst.id}/reschedule`, {
        method: "POST", body: JSON.stringify({ days }),
      });
      setMsg(`Moved ${inst.label} by ${days > 0 ? "+" : ""}${days}d (${r.tasks} tasks).`);
      onChanged();
    } catch (e: any) { setMsg(e?.detail || "Couldn't reschedule."); }
    finally { setBusy(false); }
  }

  async function rescheduleToDate(inst: Instance, iso: string | null) {
    if (!iso || !inst.start_date) return;
    const days = Math.round(
      (new Date(iso + "T00:00:00").getTime() - new Date(inst.start_date + "T00:00:00").getTime()) / 86400000,
    );
    if (days !== 0) await reschedule(inst, days);
  }

  async function removeInstance(inst: Instance) {
    if (!window.confirm(`Remove "${inst.label}" and all its tasks? This can't be undone.`)) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/api/v1/process-instances/${inst.id}`, { method: "DELETE" });
      setInstances((prev) => prev.filter((x) => x.id !== inst.id));
      onChanged();
      void load();
    } catch (e: any) { setMsg(e?.detail || "Couldn't remove."); }
    finally { setBusy(false); }
  }

  async function saveAsTemplate() {
    const name = window.prompt("Name this template — clones this initiative's un-sited tasks into a reusable process")?.trim();
    if (!name) return;
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/api/v1/initiatives/${initiativeId}/save-as-template`, {
        method: "POST", body: JSON.stringify({ name }),
      });
      setMsg(`Saved "${r.name}" as a template (${r.steps?.length ?? 0} steps). Reuse it from “Process”.`);
      void load();
    } catch (e: any) { setMsg(e?.detail || "Couldn't save as template."); }
    finally { setBusy(false); }
  }

  async function shiftStep() {
    if (!stepId || !stepDays) return;
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/api/v1/initiatives/${initiativeId}/shift-step`, {
        method: "POST", body: JSON.stringify({ template_step_id: stepId, days: stepDays }),
      });
      setMsg(`Shifted that step by ${stepDays > 0 ? "+" : ""}${stepDays}d across ${r.tasks} site${r.tasks === 1 ? "" : "s"}.`);
      onChanged();
      void load();
    } catch (e: any) { setMsg(e?.detail || "Couldn't shift the step."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-midnight/30 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-pebble">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-pebble sticky top-0 bg-white z-10">
          <Workflow className="h-4 w-4 text-taskora-red" />
          <div className="min-w-0">
            <div className="text-[11px] text-steel truncate">{initiativeName}</div>
            <h2 className="text-sm font-semibold text-midnight">Manage processes</h2>
          </div>
          {onApply && (
            <button onClick={onApply}
              className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-taskora-red text-white text-[12px] font-semibold hover:opacity-90">
              <Workflow className="h-3.5 w-3.5" /> Apply to sites
            </button>
          )}
          <button onClick={onClose} className={cn("text-steel hover:text-midnight", !onApply && "ml-auto")}><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-steel">Loading…</p>
        ) : (
          <div className="p-5 space-y-5">
            {msg && <div className="text-[12px] rounded-lg bg-emerald-50 text-emerald-700 px-3 py-1.5">{msg}</div>}

            {/* Save this initiative's tasks as a reusable template */}
            <section className="flex items-center gap-3 rounded-xl border border-pebble p-3.5">
              <div className="min-w-0 flex-1">
                <h3 className="text-[12.5px] font-semibold text-midnight">Save as a template</h3>
                <p className="text-[11.5px] text-steel">Turn this initiative’s un-sited tasks into a reusable process you can apply elsewhere.</p>
              </div>
              <button onClick={saveAsTemplate} disabled={busy}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-pebble text-[12.5px] font-semibold text-midnight hover:bg-mist disabled:opacity-40">
                <Save className="h-3.5 w-3.5" /> Save
              </button>
            </section>

            {instances.length === 0 && (
              <div className="text-center py-6">
                <Workflow className="h-7 w-7 text-steel/30 mx-auto mb-2" />
                <p className="text-[13px] text-steel mb-3">No process applied yet. Generate a step-by-step task chain across many sites at once.</p>
                {onApply && (
                  <button onClick={onApply}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-taskora-red text-white text-[12.5px] font-semibold hover:opacity-90">
                    <Workflow className="h-3.5 w-3.5" /> Apply a process to sites
                  </button>
                )}
              </div>
            )}

            {/* Step roll-up: per-step completion across every site (the report
                that answers "every building still on Survey?" at a glance). */}
            {rollup.map((tpl) => (
              <section key={tpl.template_id} className="rounded-xl border border-pebble p-3.5">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel">Step progress</h3>
                  <span className="text-[11px] text-steel">{tpl.name} · {tpl.sites} site{tpl.sites === 1 ? "" : "s"}</span>
                </div>
                {tpl.finish_date && (
                  <div className="text-[11px] text-steel/80 mb-2.5">
                    Finishes <span className="font-medium text-midnight">{fmtDate(tpl.finish_date)}</span>
                    {tpl.slowest_site && <> · critical path: {tpl.slowest_site.split(" · ").pop()}</>}
                  </div>
                )}
                <div className="space-y-2.5">
                  {tpl.steps.map((s) => {
                    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                    const ipPct = s.total ? Math.round((s.in_progress / s.total) * 100) : 0;
                    const behind = s.behind ?? [];
                    const isOpen = openStep === s.step_id;
                    return (
                      <div key={s.step_id}>
                        <button
                          onClick={() => setOpenStep(isOpen ? null : s.step_id)}
                          disabled={behind.length === 0}
                          className="w-full text-left group disabled:cursor-default">
                          <div className="flex items-center justify-between text-[12px] mb-1">
                            <span className="flex items-center gap-1 font-medium text-midnight truncate">
                              {behind.length > 0 && (isOpen
                                ? <ChevronDown className="h-3 w-3 text-steel/60 shrink-0" />
                                : <ChevronRight className="h-3 w-3 text-steel/60 shrink-0 group-hover:text-midnight" />)}
                              {s.title}
                            </span>
                            <span className="text-steel tabular-nums shrink-0 ml-2">
                              {s.done}/{s.total}
                              {s.blocked > 0 && <span className="text-red-600"> · {s.blocked} blocked</span>}
                              {s.overdue > 0 && <span className="text-amber-600"> · {s.overdue} overdue</span>}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-mist overflow-hidden flex" title={`${pct}% complete`}>
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            <div className="h-full bg-amber-400" style={{ width: `${ipPct}%` }} />
                          </div>
                        </button>
                        {isOpen && behind.length > 0 && (
                          <div className="mt-1.5 ml-4 flex flex-wrap gap-1">
                            {behind.map((b, i) => (
                              <span key={i} className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                                b.overdue ? "bg-amber-50 text-amber-700"
                                  : b.status === "blocked" ? "bg-red-50 text-red-700"
                                  : b.status === "in_progress" ? "bg-sky-50 text-sky-700"
                                  : "bg-mist text-steel")}>
                                {b.overdue && <AlertTriangle className="h-2.5 w-2.5" />}
                                {b.label.split(" · ").pop()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* Shift a step across all sites */}
            {stepOptions.length > 0 && (
              <section className="rounded-xl border border-pebble p-3.5">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-2">Shift a step across all sites</h3>
                <div className="flex items-end gap-2 flex-wrap">
                  <Select value={stepId} onChange={setStepId} className="flex-1 min-w-[180px]"
                    options={[{ value: "", label: "Pick a step…" }, ...stepOptions]} />
                  <div className="flex items-center gap-1">
                    <input type="number" value={stepDays} onChange={(e) => setStepDays(parseInt(e.target.value) || 0)}
                      className="w-16 border border-pebble rounded px-2 py-1.5 text-[13px] text-center focus:outline-none focus:border-ocean" />
                    <span className="text-[12px] text-steel">days</span>
                  </div>
                  <button onClick={shiftStep} disabled={busy || !stepId}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-midnight text-white text-[12.5px] font-semibold disabled:opacity-40">
                    <Calendar className="h-3.5 w-3.5" /> Shift
                  </button>
                </div>
              </section>
            )}

            {/* Per-site instances */}
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-2">Sites · {instances.length}</h3>
              <div className="rounded-xl border border-pebble divide-y divide-pebble/60">
                {instances.map((inst) => (
                  <div key={inst.id}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-midnight truncate">{inst.label}</div>
                        {inst.start_date && <div className="text-[11px] text-steel">starts {inst.start_date}</div>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => reschedule(inst, -7)} disabled={busy}
                          title="Pull earlier 1 week" className="h-7 px-2 rounded border border-pebble text-[11.5px] text-steel hover:bg-mist disabled:opacity-40">−7d</button>
                        <button onClick={() => reschedule(inst, 7)} disabled={busy}
                          title="Push later 1 week" className="h-7 px-2 rounded border border-pebble text-[11.5px] text-steel hover:bg-mist disabled:opacity-40">+7d</button>
                        <button onClick={() => setOpenInst(openInst === inst.id ? null : inst.id)} disabled={busy}
                          title="More — shift by N days or move to a date"
                          className={cn("h-7 w-7 inline-flex items-center justify-center rounded border border-pebble text-steel hover:bg-mist disabled:opacity-40",
                            openInst === inst.id && "bg-mist")}>
                          <Calendar className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => removeInstance(inst)} disabled={busy}
                          title="Remove this site" className="h-7 w-7 inline-flex items-center justify-center rounded text-steel hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {openInst === inst.id && (
                      <div className="flex items-end gap-3 flex-wrap px-3 pb-3 bg-mist/30">
                        <InstShift inst={inst} busy={busy} onShift={(d) => reschedule(inst, d)} />
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wide text-steel/70 mb-1">Move start to</div>
                          <DatePicker value={inst.start_date} onChange={(d) => rescheduleToDate(inst, d)} className="w-40" placeholder="Pick a date" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={load} className="mt-2 inline-flex items-center gap-1 text-[12px] text-steel hover:text-midnight">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shift one site's chain by an arbitrary number of days (±). */
function InstShift({ inst, busy, onShift }: { inst: Instance; busy: boolean; onShift: (days: number) => void }) {
  const [days, setDays] = useState(14);
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-steel/70 mb-1">Shift by</div>
      <div className="flex items-center gap-1">
        <input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value) || 0)}
          className="w-16 border border-pebble rounded px-2 py-1.5 text-[13px] text-center focus:outline-none focus:border-ocean" />
        <span className="text-[12px] text-steel">days</span>
        <button onClick={() => days && onShift(days)} disabled={busy || !days}
          className="ml-1 h-9 px-3 rounded-lg bg-midnight text-white text-[12.5px] font-semibold disabled:opacity-40">
          Shift
        </button>
      </div>
    </div>
  );
}
