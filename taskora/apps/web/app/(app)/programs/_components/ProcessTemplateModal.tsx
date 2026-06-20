"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Search, Building2, Users, Workflow } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { DatePicker, Select, cn } from "@/components/ui";
import { StepsEditor, EMPTY_STEP, stepsToPayload, type Step, type Member } from "./StepsEditor";

/**
 * Apply a process to many sites at once (Playbooks). Pick or build a template
 * (ordered steps + linear dependency), tick the buildings/clients, set a start
 * date → the backend fans out one dependency-wired task chain per site.
 */
type Template = { id: string; name: string; steps: { id: string; title: string; duration_days: number }[] };
type Site = { id: string; name: string };

export function ProcessTemplateModal({
  initiativeId, businessId, initiativeName, onClose, onApplied,
}: {
  initiativeId: string;
  businessId: string;
  initiativeName: string;
  onClose: () => void;
  onApplied: (summary: { tasks: number; sites: number; skipped: number; skippedSites: string[]; instanceIds: string[] }) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [buildings, setBuildings] = useState<Site[]>([]);
  const [clients, setClients] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Template selection / authoring.
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [templateId, setTemplateId] = useState("");
  const [newName, setNewName] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ ...EMPTY_STEP }]);
  const [members, setMembers] = useState<Member[]>([]);

  // Sites.
  const [kind, setKind] = useState<"building" | "client">("building");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [siteQuery, setSiteQuery] = useState("");
  const [startDate, setStartDate] = useState<string | null>(null);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const [tpls, b, c, m] = await Promise.all([
          apiFetch(`/api/v1/process-templates?business_id=${businessId}`).catch(() => []),
          apiFetch(`/api/v1/buildings?business_id=${businessId}`).catch(() => []),
          apiFetch(`/api/v1/clients?business_id=${businessId}`).catch(() => []),
          apiFetch(`/api/v1/businesses/${businessId}/members`).catch(() => []),
        ]);
        setTemplates(Array.isArray(tpls) ? tpls : []);
        setBuildings((Array.isArray(b) ? b : []).map((x: any) => ({ id: x.id, name: x.name })));
        setClients((Array.isArray(c) ? c : []).map((x: any) => ({ id: x.id, name: x.name })));
        setMembers(Array.isArray(m) ? m : []);
        if (Array.isArray(tpls) && tpls.length) setTemplateId(tpls[0].id);
        else setMode("new");
      } finally { setLoading(false); }
    })();
  }, [businessId]);

  const allSites = kind === "building" ? buildings : clients;
  const sites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    return q ? allSites.filter((s) => s.name.toLowerCase().includes(q)) : allSites;
  }, [allSites, siteQuery]);
  const pickedSites = useMemo(() => {
    const all = [...buildings.map((s) => ({ ...s, type: "building" as const })),
                 ...clients.map((s) => ({ ...s, type: "client" as const }))];
    return all.filter((s) => picked.has(s.id));
  }, [buildings, clients, picked]);

  const stepCount = mode === "new"
    ? steps.filter((s) => s.title.trim()).length
    : (templates.find((t) => t.id === templateId)?.steps.length ?? 0);
  const projected = stepCount * pickedSites.length;

  // Each site's chain runs its steps back-to-back, so per-site span = Σ durations
  // (matches the generator's sequential cursor). Surface the resulting end date.
  const perSiteDays = mode === "new"
    ? steps.filter((s) => s.title.trim()).reduce((a, s) => a + (s.duration_days || 1), 0)
    : (templates.find((t) => t.id === templateId)?.steps.reduce((a, s) => a + (s.duration_days || 1), 0) ?? 0);
  const endDate = useMemo(() => {
    if (!startDate || !perSiteDays) return null;
    const d = new Date(startDate + "T00:00:00");
    d.setDate(d.getDate() + perSiteDays);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }, [startDate, perSiteDays]);

  async function apply() {
    setError("");
    if (pickedSites.length === 0) { setError("Pick at least one site."); return; }
    if (!startDate) { setError("Set a start date."); return; }
    setBusy(true);
    try {
      // Author a template first if needed.
      let id = templateId;
      if (mode === "new") {
        const cleanSteps = stepsToPayload(steps);
        if (cleanSteps.length === 0) { setError("Add at least one step."); setBusy(false); return; }
        const created = await apiFetch("/api/v1/process-templates", {
          method: "POST",
          body: JSON.stringify({
            business_id: businessId,
            name: newName.trim() || "Untitled process",
            steps: cleanSteps,
          }),
        });
        id = created.id;
      }
      if (!id) { setError("Pick or create a template."); setBusy(false); return; }
      const res = await apiFetch(`/api/v1/initiatives/${initiativeId}/apply-process`, {
        method: "POST",
        body: JSON.stringify({
          template_id: id,
          sites: pickedSites.map((s) => ({ entity_id: s.id, entity_type: s.type })),
          start_date: startDate,
        }),
      });
      onApplied({
        tasks: res?.tasks ?? 0,
        sites: res?.instances ?? pickedSites.length,
        skipped: res?.skipped ?? 0,
        skippedSites: Array.isArray(res?.skipped_sites) ? res.skipped_sites : [],
        instanceIds: Array.isArray(res?.instance_ids) ? res.instance_ids : [],
      });
      onClose();
    } catch (e: any) {
      setError(e?.detail || e?.message || "Couldn't apply the process.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-midnight/30 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-pebble">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-pebble sticky top-0 bg-white z-10">
          <Workflow className="h-4 w-4 text-taskora-red" />
          <div className="min-w-0">
            <div className="text-[11px] text-steel truncate">{initiativeName}</div>
            <h2 className="text-sm font-semibold text-midnight">Apply a process to sites</h2>
          </div>
          <button onClick={onClose} className="ml-auto text-steel hover:text-midnight"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-steel">Loading…</p>
        ) : (
          <div className="p-5 space-y-5">
            {/* 1 · Template */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel">1 · Process</h3>
                <div className="inline-flex rounded-lg border border-pebble overflow-hidden text-[12px]">
                  <button onClick={() => setMode("pick")} disabled={templates.length === 0}
                    className={cn("px-3 py-1", mode === "pick" ? "bg-midnight text-white" : "text-steel disabled:opacity-40")}>Use saved</button>
                  <button onClick={() => setMode("new")}
                    className={cn("px-3 py-1 border-l border-pebble", mode === "new" ? "bg-midnight text-white" : "text-steel")}>New</button>
                </div>
              </div>
              {mode === "pick" ? (
                <div className="space-y-1.5">
                  <Select value={templateId} onChange={setTemplateId} className="w-full"
                    options={templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.steps.length} steps` }))} />
                  <a href="/workspace/settings/processes" target="_blank" rel="noopener"
                    className="inline-block text-[11px] text-steel hover:text-midnight underline underline-offset-2">
                    Manage saved processes →
                  </a>
                </div>
              ) : (
                <div className="space-y-2">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Process name (e.g. Site rollout)"
                    className="w-full border border-pebble rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-ocean" />
                  <StepsEditor steps={steps} setSteps={setSteps} members={members} />
                </div>
              )}
            </section>

            {/* 2 · Sites */}
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-2">2 · Sites</h3>
              <div className="inline-flex rounded-lg border border-pebble overflow-hidden mb-2 text-[12px]">
                <button onClick={() => setKind("building")}
                  className={cn("inline-flex items-center gap-1.5 px-3 py-1", kind === "building" ? "bg-midnight text-white" : "text-steel")}>
                  <Building2 className="h-3.5 w-3.5" /> Buildings ({buildings.length})
                </button>
                <button onClick={() => setKind("client")}
                  className={cn("inline-flex items-center gap-1.5 px-3 py-1 border-l border-pebble", kind === "client" ? "bg-midnight text-white" : "text-steel")}>
                  <Users className="h-3.5 w-3.5" /> Clients ({clients.length})
                </button>
                {sites.length > 0 && (
                  <button onClick={() => setPicked((p) => {
                    const n = new Set(p); const allOn = sites.every((s) => n.has(s.id));
                    sites.forEach((s) => (allOn ? n.delete(s.id) : n.add(s.id))); return n;
                  })} className="px-3 py-1 border-l border-pebble text-ocean">
                    {sites.every((s) => picked.has(s.id)) && sites.length ? "None" : "All"}
                  </button>
                )}
              </div>
              {allSites.length > 6 && (
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-steel/50" />
                  <input value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)}
                    placeholder={`Search ${kind}s…`}
                    className="w-full border border-pebble rounded-lg pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-ocean" />
                </div>
              )}
              {picked.size > 0 && (
                <div className="text-[11px] text-steel mb-1.5">{picked.size} selected</div>
              )}
              <div className="max-h-44 overflow-y-auto rounded-lg border border-pebble divide-y divide-pebble/60">
                {sites.length === 0 ? (
                  <p className="px-3 py-4 text-[12.5px] text-steel/60 text-center">
                    {siteQuery ? `No ${kind}s match “${siteQuery}”.` : `No ${kind}s in this workspace.`}
                  </p>
                ) : sites.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer hover:bg-mist/40">
                    <input type="checkbox" checked={picked.has(s.id)}
                      onChange={() => setPicked((p) => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                      className="accent-taskora-red" />
                    {s.name}
                  </label>
                ))}
              </div>
            </section>

            {/* 3 · Start + apply */}
            <section className="flex items-end gap-3 flex-wrap">
              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel mb-1.5">3 · Start date</h3>
                <DatePicker value={startDate} onChange={setStartDate} className="w-44" placeholder="Pick a start" />
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-steel">This will create</div>
                <div className="text-[15px] font-bold text-midnight">{projected} task{projected === 1 ? "" : "s"}</div>
                <div className="text-[11px] text-steel/70">{stepCount} steps × {pickedSites.length} sites</div>
                {endDate && (
                  <div className="text-[11px] text-steel/70 mt-0.5">~{perSiteDays}d per site · ends {endDate}</div>
                )}
              </div>
            </section>

            {error && <p className="text-[12px] text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-pebble text-sm text-steel hover:bg-mist font-medium">Cancel</button>
              <button onClick={apply} disabled={busy || projected === 0}
                className="flex-1 px-4 py-2.5 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {busy ? "Applying…" : `Apply to ${pickedSites.length} site${pickedSites.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
