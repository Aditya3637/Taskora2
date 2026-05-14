"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

type Template = { id: string; name: string; description?: string; structure: { tasks: any[] }; created_at: string };
type Initiative = { id: string; name?: string; title?: string };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showSaveFrom, setShowSaveFrom] = useState(false);
  const [showApply, setShowApply] = useState<Template | null>(null);
  const [applyInitId, setApplyInitId] = useState("");
  const [saveFromInitId, setSaveFromInitId] = useState("");
  const [newTemplate, setNewTemplate] = useState({ name: "", description: "", tasks: [""] });

  useEffect(() => {
    (async () => {
      try {
        let bid = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
        if (!bid) {
          const biz = await apiFetch("/api/v1/businesses/my");
          bid = biz?.id ?? "";
          if (bid) localStorage.setItem("business_id", bid);
        }
        setBusinessId(bid);
        if (bid) {
          const [tmpl, init] = await Promise.all([
            apiFetch(`/api/v1/templates?business_id=${bid}`),
            apiFetch(`/api/v1/initiatives/business/${bid}`),
          ]);
          setTemplates(tmpl as Template[]);
          setInitiatives(init as Initiative[]);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  async function createBlank(e: React.FormEvent) {
    e.preventDefault();
    const structure = { tasks: newTemplate.tasks.filter(Boolean).map(t => ({ title: t, priority: "medium", subtasks: [] })) };
    const tmpl = await apiFetch("/api/v1/templates/", {
      method: "POST",
      body: JSON.stringify({ business_id: businessId, name: newTemplate.name, description: newTemplate.description, structure }),
    });
    setTemplates(prev => [tmpl as Template, ...prev]);
    setShowCreate(false);
    setNewTemplate({ name: "", description: "", tasks: [""] });
  }

  async function saveFromInitiative(e: React.FormEvent) {
    e.preventDefault();
    if (!saveFromInitId) return;
    const tmpl = await apiFetch("/api/v1/templates/", {
      method: "POST",
      body: JSON.stringify({ business_id: businessId, initiative_id: saveFromInitId, action: "save_from_initiative", name: `Template from initiative` }),
    });
    setTemplates(prev => [tmpl as Template, ...prev]);
    setShowSaveFrom(false);
  }

  async function applyTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!showApply || !applyInitId) return;
    await apiFetch(`/api/v1/templates/${showApply.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ initiative_id: applyInitId }),
    });
    setShowApply(null);
    alert("Template applied! Tasks have been created in the selected initiative.");
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    await apiFetch(`/api/v1/templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
  }

  const initLabel = (i: Initiative) => i.name ?? i.title ?? i.id;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-pebble border-t-midnight rounded-full" /></div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Initiative Templates</h1>
          <p className="text-steel text-sm mt-1">Save and reuse task structures across initiatives</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => setShowSaveFrom(true)}
            className="h-9 px-3 sm:px-4 border border-pebble text-steel text-sm font-medium rounded-lg hover:text-midnight hover:border-midnight transition-colors">
            💾 <span className="hidden sm:inline">Save from Initiative</span><span className="sm:hidden">Save</span>
          </button>
          <button onClick={() => setShowCreate(true)}
            className="h-9 px-3 sm:px-4 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">
            + <span className="hidden sm:inline">New Template</span><span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-pebble p-16 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-steel">No templates yet. Create one from scratch or save from an existing initiative.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {templates.map(tmpl => (
            <div key={tmpl.id} className="bg-white border border-pebble rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-midnight truncate">{tmpl.name}</h3>
                  {tmpl.description && <p className="text-steel text-sm mt-1 line-clamp-2">{tmpl.description}</p>}
                </div>
                <button onClick={() => deleteTemplate(tmpl.id)}
                  className="text-steel hover:text-red-600 text-sm flex-shrink-0 transition-colors">✕</button>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <span className="text-xs bg-mist text-steel px-2 py-1 rounded-full">
                  {tmpl.structure?.tasks?.length ?? 0} tasks
                </span>
                <span className="text-xs text-steel">{tmpl.created_at?.slice(0, 10)}</span>
              </div>
              <button onClick={() => { setShowApply(tmpl); setApplyInitId(""); }}
                className="mt-3 w-full h-9 bg-mist hover:bg-pebble text-midnight text-sm font-medium rounded-lg transition-colors">
                Apply to Initiative →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Blank Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-midnight mb-4">Create Blank Template</h3>
            <form onSubmit={createBlank} className="space-y-4">
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Template Name</label>
                <input required value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none" placeholder="e.g. New Building Launch" />
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Description</label>
                <textarea value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border border-pebble rounded-lg text-sm focus:outline-none resize-none" />
              </div>
              <div>
                <label className="text-xs text-steel font-medium mb-2 block">Task Titles</label>
                <div className="space-y-2">
                  {newTemplate.tasks.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={t} onChange={e => setNewTemplate(p => ({ ...p, tasks: p.tasks.map((v, j) => j === i ? e.target.value : v) }))}
                        placeholder={`Task ${i + 1}`}
                        className="flex-1 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none" />
                      {newTemplate.tasks.length > 1 && (
                        <button type="button" onClick={() => setNewTemplate(p => ({ ...p, tasks: p.tasks.filter((_, j) => j !== i) }))}
                          className="text-steel hover:text-red-600 px-2">✕</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setNewTemplate(p => ({ ...p, tasks: [...p.tasks, ""] }))}
                    className="text-ocean text-sm font-medium hover:underline">+ Add task</button>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel">Cancel</button>
                <button type="submit"
                  className="flex-1 h-10 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save from Initiative Modal */}
      {showSaveFrom && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSaveFrom(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-midnight mb-4">Save Template from Initiative</h3>
            <form onSubmit={saveFromInitiative} className="space-y-4">
              <div>
                <label className="text-xs text-steel font-medium mb-1 block">Select Initiative</label>
                <select required value={saveFromInitId} onChange={e => setSaveFromInitId(e.target.value)}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                  <option value="">Choose an initiative…</option>
                  {initiatives.map(i => <option key={i.id} value={i.id}>{initLabel(i)}</option>)}
                </select>
              </div>
              <p className="text-xs text-steel">This will copy the task structure of the selected initiative as a reusable template.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowSaveFrom(false)}
                  className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel">Cancel</button>
                <button type="submit"
                  className="flex-1 h-10 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Apply Modal */}
      {showApply && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowApply(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-midnight mb-1">Apply Template</h3>
            <p className="text-steel text-sm mb-4">"{showApply.name}" → select target initiative</p>
            <form onSubmit={applyTemplate} className="space-y-4">
              <select required value={applyInitId} onChange={e => setApplyInitId(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                <option value="">Choose an initiative…</option>
                {initiatives.map(i => <option key={i.id} value={i.id}>{initLabel(i)}</option>)}
              </select>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowApply(null)}
                  className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel">Cancel</button>
                <button type="submit"
                  className="flex-1 h-10 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90">Apply</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
