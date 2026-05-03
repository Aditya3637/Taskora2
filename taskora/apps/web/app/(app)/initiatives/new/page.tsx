"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Entity = { id: string; name: string };

export default function NewInitiativePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityType, setEntityType] = useState<"building" | "client">("building");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/businesses/").then(async (biz: { id: string; type?: string }[]) => {
      if (biz?.length) {
        const b = biz[0];
        setBusinessId(b.id);
        const et: "building" | "client" = b.type === "building" ? "building" : "client";
        setEntityType(et);
        const endpoint = et === "building"
          ? `/api/v1/businesses/${b.id}/buildings`
          : `/api/v1/businesses/${b.id}/clients`;
        const ents = await apiFetch(endpoint);
        setEntities(ents ?? []);
      }
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !businessId) return;
    setLoading(true); setError("");
    try {
      const created = await apiFetch("/api/v1/initiatives/", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() && { description: description.trim() }),
          business_id: businessId,
          ...(targetDate && { target_end_date: targetDate }),
          entities: selectedEntities.map(id => ({ entity_type: entityType, entity_id: id })),
        }),
      });
      router.push(`/initiatives/${created.id}`);
    } catch {
      setError("Failed to create initiative. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const toggleEntity = (id: string) =>
    setSelectedEntities(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-midnight mb-6">New Initiative</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-pebble p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-midnight mb-1">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} required
            placeholder="e.g. Q2 Fire Safety Compliance"
            className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean"/>
        </div>
        <div>
          <label className="block text-sm font-medium text-midnight mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Optional details..."
            className="w-full px-3 py-2 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean resize-none"/>
        </div>
        <div>
          <label className="block text-sm font-medium text-midnight mb-1">Target completion date</label>
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
            className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"/>
        </div>
        {entities.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-midnight mb-2">
              {entityType === "building" ? "Buildings" : "Clients"} to include
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {entities.map(e => (
                <label key={e.id}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                    selectedEntities.includes(e.id)
                      ? "border-taskora-red bg-red-50 text-midnight"
                      : "border-pebble hover:border-ocean text-steel"
                  }`}>
                  <input type="checkbox" className="hidden"
                    checked={selectedEntities.includes(e.id)}
                    onChange={() => toggleEntity(e.id)}/>
                  <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                    selectedEntities.includes(e.id) ? "border-taskora-red bg-taskora-red" : "border-pebble"
                  }`}>
                    {selectedEntities.includes(e.id) && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="2,6 5,9 10,3"/>
                      </svg>
                    )}
                  </span>
                  {e.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.push("/initiatives")}
            className="flex-1 h-11 border border-pebble rounded-lg text-sm text-steel hover:bg-mist">
            Cancel
          </button>
          <button type="submit" disabled={loading || !name.trim()}
            className="flex-1 h-11 bg-taskora-red text-white font-semibold rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? "Creating..." : "Create Initiative"}
          </button>
        </div>
      </form>
    </div>
  );
}
