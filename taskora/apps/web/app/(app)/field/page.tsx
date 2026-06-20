"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { cn, useToast } from "@/components/ui";

type Site = {
  task_id: string;
  task_title: string;
  entity_id: string;
  entity_type: string;
  entity_name: string;
  status: string | null;
  due: string | null;
};

// Field-friendly status set (maps to per_entity_status values).
const STATUSES: { key: string; label: string; cls: string }[] = [
  { key: "todo", label: "To do", cls: "bg-gray-100 text-gray-700" },
  { key: "in_progress", label: "WIP", cls: "bg-blue-100 text-blue-800" },
  { key: "blocked", label: "Blocked", cls: "bg-red-100 text-red-700" },
  { key: "done", label: "Done", cls: "bg-emerald-100 text-emerald-800" },
];

export default function FieldPage() {
  const { toast } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    setLoading(true);
    try {
      const d = await apiFetch(`/api/v1/businesses/${bid}/my-sites`);
      setSites(Array.isArray(d) ? d : []);
    } catch { setSites([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(s: Site, status: string) {
    setSites((prev) => prev.map((x) => (x.task_id === s.task_id && x.entity_id === s.entity_id ? { ...x, status } : x)));
    try {
      await apiFetch(`/api/v1/tasks/${s.task_id}/entities/${s.entity_id}`, {
        method: "PATCH", body: JSON.stringify({ per_entity_status: status }),
      });
      toast({ title: "Updated", description: `${s.entity_name} → ${status}`, variant: "success" });
    } catch (e: any) {
      toast({ title: "Couldn’t update", description: e?.message, variant: "error" });
      load();
    }
  }

  async function postNote(s: Site) {
    const text = noteText.trim();
    if (!text) { setNoteOpen(null); return; }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${s.task_id}/entities/${s.entity_id}/comments`, {
        method: "POST", body: JSON.stringify({ content: text }),
      });
      toast({ title: "Note added", variant: "success" });
      setNoteOpen(null); setNoteText("");
    } catch (e: any) {
      toast({ title: "Couldn’t add note", description: e?.message, variant: "error" });
    } finally { setBusy(false); }
  }

  async function uploadPhoto(s: Site, file: File) {
    setBusy(true);
    try {
      const sign = await apiFetch(`/api/v1/tasks/${s.task_id}/entities/${s.entity_id}/photos/sign`, {
        method: "POST", body: JSON.stringify({ file_name: file.name, content_type: file.type || "image/jpeg" }),
      });
      if (file.size > (sign.max_bytes ?? 26214400)) throw new Error("Photo is too large (max 25 MB).");
      const { error: upErr } = await supabase.storage
        .from(sign.bucket).uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      await apiFetch(`/api/v1/tasks/${s.task_id}/entities/${s.entity_id}/photos`, {
        method: "POST", body: JSON.stringify({ path: sign.path, file_name: file.name, file_size_bytes: file.size }),
      });
      toast({ title: "Photo added", variant: "success" });
    } catch (e: any) {
      toast({ title: "Couldn’t add photo", description: e?.message, variant: "error" });
    } finally { setBusy(false); }
  }

  const key = (s: Site) => `${s.task_id}:${s.entity_id}`;

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <h1 className="text-lg font-bold text-midnight">Today on your sites</h1>
      <p className="text-[13px] text-steel mb-4">Tap a status to update from the field.</p>

      {loading ? (
        <p className="text-sm text-steel py-8 text-center">Loading…</p>
      ) : sites.length === 0 ? (
        <div className="rounded-xl border border-pebble bg-white px-4 py-10 text-center">
          <p className="text-[14px] font-semibold text-midnight">No site work assigned 🎉</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sites.map((s) => (
            <div key={key(s)} className="rounded-xl border border-pebble bg-white p-3.5">
              <div className="text-[14px] font-semibold text-midnight">🏢 {s.entity_name}</div>
              <div className="text-[12px] text-steel">{s.task_title}{s.due ? ` · due ${s.due}` : ""}</div>
              <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                {STATUSES.map((st) => (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setStatus(s, st.key)}
                    className={cn(
                      "h-9 rounded-lg text-[12px] font-semibold transition-colors",
                      s.status === st.key ? st.cls + " ring-2 ring-offset-1 ring-current" : "bg-mist/60 text-steel",
                    )}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              {noteOpen === key(s) ? (
                <div className="mt-2.5 flex gap-2">
                  <input
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Quick note…"
                    className="flex-1 border border-pebble rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-taskora-red"
                  />
                  <button type="button" disabled={busy} onClick={() => postNote(s)}
                    className="h-9 px-3 rounded-lg bg-midnight text-white text-[12.5px] font-semibold disabled:opacity-40">Add</button>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <button type="button" onClick={() => { setNoteOpen(key(s)); setNoteText(""); }}
                    className="text-[12px] text-steel hover:text-midnight">+ Add note</button>
                  <label className={cn("text-[12px] text-steel hover:text-midnight cursor-pointer", busy && "opacity-40 pointer-events-none")}>
                    📷 Add photo
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(s, f); e.currentTarget.value = ""; }} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
