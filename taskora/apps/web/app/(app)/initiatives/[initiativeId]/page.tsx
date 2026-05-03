"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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

type EntityProgress = { entity_id: string; entity_name: string; completion_pct: number; total: number; done: number };
type Analytics = { completion_pct?: number; total_tasks?: number; completed_count?: number; entity_progress?: EntityProgress[] };
type Task = { id: string; title: string; status: string; initiative_id?: string };
type Initiative = { id: string; name: string; description?: string; status: string; target_end_date?: string };

export default function InitiativeDetailPage() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initiativeId) return;
    Promise.all([
      apiFetch(`/api/v1/initiatives/${initiativeId}`),
      apiFetch(`/api/v1/tasks/my`),
      apiFetch(`/api/v1/analytics/initiative/${initiativeId}`),
    ]).then(([init, allTasks, anal]) => {
      setInitiative(init);
      setTasks((allTasks as Task[]).filter(t => t.initiative_id === initiativeId));
      setAnalytics(anal);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [initiativeId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="w-6 h-6 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/>
      </div>
    );
  }
  if (!initiative) return <p className="p-8 text-steel">Initiative not found.</p>;

  const pct = Math.round(analytics?.completion_pct ?? 0);
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-taskora-red";

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-2">
        <Link href="/initiatives" className="text-sm text-steel hover:text-midnight">← Initiatives</Link>
      </div>
      <h1 className="text-2xl font-bold text-midnight mb-1">{initiative.name}</h1>
      {initiative.description && <p className="text-steel mb-6">{initiative.description}</p>}

      {/* Progress bar */}
      <div className="bg-white border border-pebble rounded-xl p-5 mb-6">
        <div className="flex justify-between mb-2">
          <span className="font-semibold text-midnight">Overall Progress</span>
          <span className="font-mono text-steel">{pct}%</span>
        </div>
        <div className="h-3 bg-pebble rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }}/>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-steel">
          <span>{analytics?.total_tasks ?? 0} total tasks</span>
          <span>{analytics?.completed_count ?? 0} completed</span>
        </div>
      </div>

      {/* Entity progress */}
      {analytics?.entity_progress && analytics.entity_progress.length > 0 && (
        <div className="bg-white border border-pebble rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-pebble bg-mist">
            <h2 className="font-semibold text-midnight text-sm">Entity Progress</h2>
          </div>
          <div className="divide-y divide-pebble">
            {analytics.entity_progress.map(ep => {
              const epct = Math.round(ep.completion_pct);
              const ecolor = epct >= 80 ? "bg-green-500" : epct >= 50 ? "bg-amber-400" : "bg-taskora-red";
              return (
                <div key={ep.entity_id} className="px-5 py-3 flex items-center gap-4">
                  <span className="text-sm font-medium text-midnight w-40 flex-shrink-0">{ep.entity_name}</span>
                  <div className="flex-1 h-2 bg-pebble rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${ecolor}`} style={{ width: `${epct}%` }}/>
                  </div>
                  <span className="text-xs text-steel font-mono w-10 text-right">{epct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-midnight">Tasks ({tasks.length})</h2>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-steel italic">No tasks for this initiative yet.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="bg-white border border-pebble rounded-lg p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-midnight">{t.title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-mist text-steel">{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
