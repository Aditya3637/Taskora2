"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
async function apiFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Initiative = {
  id: string; name: string; status: string;
  target_end_date?: string; initiative_entities?: { entity_id: string }[];
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  paused: "bg-amber-100 text-amber-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export default function InitiativesPage() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/v1/businesses/")
      .then(async (biz: { id: string }[]) => {
        if (biz?.length) {
          setBusinessId(biz[0].id);
          const data = await apiFetch(`/api/v1/initiatives/business/${biz[0].id}`);
          setInitiatives(data ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="w-6 h-6 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-midnight">Initiatives</h1>
        {businessId && (
          <Link href="/initiatives/new"
            className="px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
            + New Initiative
          </Link>
        )}
      </div>

      {initiatives.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-steel mb-4">No initiatives yet.</p>
          {businessId && (
            <Link href="/initiatives/new"
              className="px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg">
              Create your first initiative
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {initiatives.map(init => (
            <Link key={init.id} href={`/initiatives/${init.id}`}>
              <div className="bg-white border border-pebble rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-midnight">{init.name}</h2>
                    {init.target_end_date && (
                      <p className="text-xs text-steel mt-1">Target: {init.target_end_date}</p>
                    )}
                    <p className="text-xs text-steel mt-0.5">
                      {init.initiative_entities?.length ?? 0} entities
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${STATUS_STYLE[init.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {init.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
