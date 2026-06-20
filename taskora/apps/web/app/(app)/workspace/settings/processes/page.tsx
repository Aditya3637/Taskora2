"use client";

import { useCallback, useEffect, useState } from "react";
import { Workflow, Plus, Pencil, Trash2, X, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import SettingsTabs from "@/components/SettingsTabs";
import {
  StepsEditor, EMPTY_STEP, stepsFromTemplate, stepsToPayload,
  type Step, type Member,
} from "../../../programs/_components/StepsEditor";

type Template = {
  id: string;
  name: string;
  description?: string | null;
  steps: { id: string; title: string; duration_days: number; default_owner_id?: string | null; gate?: boolean }[];
};

export default function ProcessesPage() {
  const [businessId, setBusinessId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Editor: null = closed, "new" = create, otherwise the template id being edited.
  const [editing, setEditing] = useState<null | "new" | string>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ ...EMPTY_STEP }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const biz = await apiFetch("/api/v1/businesses/my");
      const role = await apiFetch(`/api/v1/businesses/${biz.id}/my-role`);
      setMyRole(role?.role ?? "");
      setBusinessId(biz.id);
      const [tpls, m] = await Promise.all([
        apiFetch(`/api/v1/process-templates?business_id=${biz.id}`).catch(() => []),
        apiFetch(`/api/v1/businesses/${biz.id}/members`).catch(() => []),
      ]);
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setMembers(Array.isArray(m) ? m : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load processes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  function startNew() {
    setName("");
    setSteps([{ ...EMPTY_STEP }]);
    setEditing("new");
  }

  function startEdit(t: Template) {
    setName(t.name);
    const s = stepsFromTemplate(t.steps);
    setSteps(s.length ? s : [{ ...EMPTY_STEP }]);
    setEditing(t.id);
  }

  async function save() {
    const cleanSteps = stepsToPayload(steps);
    if (!name.trim()) { flash("Give the process a name."); return; }
    if (cleanSteps.length === 0) { flash("Add at least one step."); return; }
    setSaving(true);
    try {
      if (editing === "new") {
        await apiFetch("/api/v1/process-templates", {
          method: "POST",
          body: JSON.stringify({ business_id: businessId, name: name.trim(), steps: cleanSteps }),
        });
        flash("Process created.");
      } else {
        await apiFetch(`/api/v1/process-templates/${editing}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), steps: cleanSteps }),
        });
        flash("Process updated. Sites already running it keep their tasks.");
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      flash(e?.detail || e?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: Template) {
    if (!window.confirm(`Delete “${t.name}”? Sites already running it keep their tasks; you just can't apply it to new sites.`)) return;
    try {
      await apiFetch(`/api/v1/process-templates/${t.id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      flash("Process deleted.");
    } catch (e: any) {
      flash(e?.detail || e?.message || "Couldn't delete.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-taskora-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="max-w-2xl mx-auto p-6"><p className="text-red-600 text-sm">{error}</p></div>;
  }

  const isAdmin = myRole === "owner" || myRole === "admin";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-midnight text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-midnight">Workspace Settings</h1>
        <p className="text-sm text-steel mt-1">
          Reusable processes (“playbooks”) — an ordered set of steps you apply across many sites at once.
        </p>
      </div>
      <SettingsTabs />

      {/* Editor */}
      {editing !== null ? (
        <section className="bg-white rounded-2xl border border-pebble shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-taskora-red" />
            <h2 className="text-sm font-semibold text-midnight">{editing === "new" ? "New process" : "Edit process"}</h2>
            <button onClick={() => setEditing(null)} className="ml-auto text-steel hover:text-midnight"><X className="h-4 w-4" /></button>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Process name (e.g. Metering rollout)"
            className="w-full border border-pebble rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-ocean" />
          <StepsEditor steps={steps} setSteps={setSteps} members={members} />
          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditing(null)} className="flex-1 px-4 py-2.5 rounded-lg border border-pebble text-sm text-steel hover:bg-mist font-medium">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : editing === "new" ? "Create process" : "Save changes"}
            </button>
          </div>
        </section>
      ) : isAdmin && (
        <button onClick={startNew}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-taskora-red text-white text-[13px] font-semibold hover:opacity-90">
          <Plus className="h-4 w-4" /> New process
        </button>
      )}

      {/* Library */}
      {templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-pebble">
          <Workflow className="h-8 w-8 text-steel/30 mx-auto mb-2" />
          <p className="text-sm text-steel">No processes yet.</p>
          <p className="text-[12.5px] text-steel/70 mt-1">
            Create one here, or save an initiative’s tasks as a process from its “Process” menu.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start gap-3 bg-white rounded-xl border border-pebble p-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-midnight">{t.name}</div>
                <div className="text-[11.5px] text-steel mt-0.5">
                  {t.steps.length} step{t.steps.length === 1 ? "" : "s"}
                </div>
                {t.steps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    {t.steps.map((s, i) => (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-steel/40 text-[10px]">→</span>}
                        <span className="rounded bg-mist px-1.5 py-0.5 text-[10.5px] text-steel">
                          {s.title}{s.gate ? " 🚦" : ""} · {s.duration_days}d
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(t)} title="Edit"
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-steel hover:text-midnight hover:bg-mist">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(t)} title="Delete"
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-steel hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
