"use client";
import { useState, useEffect } from "react";
import { X, History, Eye, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: any) => d.detail ?? d.message ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

export type EditableInitiative = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  impact?: string | null;
  impact_metric?: string | null;
  impact_category?: string | null;
  start_date?: string | null;
  target_end_date?: string | null;
  primary_stakeholder_id?: string | null;
  owner_id?: string | null;
};

type Member = { user_id: string; name: string; email: string; role: string };

type ActivityLogEntry = {
  id: string;
  action: string;
  actor_email?: string | null;
  old_value?: any;
  new_value?: any;
  created_at: string;
};

const IMPACT_CATEGORIES = [
  { value: "cost", label: "Cost" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "process_efficiency", label: "Process Efficiency" },
  { value: "other", label: "Others" },
] as const;

type ImpactCatValue = (typeof IMPACT_CATEGORIES)[number]["value"];

export function EditInitiativeModal({
  initiative,
  businessId,
  onClose,
  onSaved,
}: {
  initiative: EditableInitiative;
  businessId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initiative.name);
  const [description, setDescription] = useState(initiative.description ?? "");
  const [status, setStatus] = useState(initiative.status);
  const [startDate, setStartDate] = useState(initiative.start_date ?? "");
  const [targetDate, setTargetDate] = useState(initiative.target_end_date ?? "");
  const [primaryStakeholderId, setPrimaryStakeholderId] = useState(initiative.primary_stakeholder_id ?? "");
  const [ownerId, setOwnerId] = useState(initiative.owner_id ?? "");
  const [impactCategory, setImpactCategory] = useState<ImpactCatValue>(
    (initiative.impact_category as ImpactCatValue) ?? "other",
  );
  const [impact, setImpact] = useState(initiative.impact ?? "");
  const [impactMetric, setImpactMetric] = useState(initiative.impact_metric ?? "");

  const [members, setMembers] = useState<Member[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [followers, setFollowers] = useState<Array<{ user_id: string; name: string; email: string }>>([]);
  const [followerAddOpen, setFollowerAddOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [followerError, setFollowerError] = useState("");
  const [followerBusy, setFollowerBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function reloadFollowers() {
    try {
      const d = await apiFetch(`/api/v1/initiatives/${initiative.id}/followers`);
      setFollowers(Array.isArray(d) ? d : []);
    } catch (err: any) {
      // Surface the error so add/remove failures aren't silent.
      setFollowerError(err?.message ?? "Failed to load followers.");
    }
  }

  useEffect(() => {
    apiFetch(`/api/v1/businesses/${businessId}/members`)
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {});
    apiFetch(`/api/v1/initiatives/${initiative.id}/activity`)
      .then((d) => setActivity(Array.isArray(d) ? d : []))
      .catch(() => {});
    reloadFollowers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, initiative.id]);

  function togglePick(uid: string) {
    setPickedIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  }

  async function handleAddFollowers() {
    if (pickedIds.length === 0) return;
    setFollowerBusy(true);
    setFollowerError("");
    // Add sequentially so a single 403 doesn't leave the rest in an unknown
    // state — also makes the error message specific to the offender.
    for (const uid of pickedIds) {
      try {
        await apiFetch(`/api/v1/initiatives/${initiative.id}/followers`, {
          method: "POST",
          body: JSON.stringify({ user_id: uid }),
        });
      } catch (err: any) {
        setFollowerError(err?.message ?? `Failed to add ${uid}.`);
        break;
      }
    }
    setPickedIds([]);
    setFollowerAddOpen(false);
    setFollowerBusy(false);
    await reloadFollowers();
  }

  async function handleRemoveFollower(userId: string) {
    setFollowerError("");
    try {
      await apiFetch(`/api/v1/initiatives/${initiative.id}/followers/${userId}`, {
        method: "DELETE",
      });
      await reloadFollowers();
    } catch (err: any) {
      setFollowerError(err?.message ?? "Failed to remove follower.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Dates are mandatory and ordered (056).
    if (!startDate || !targetDate) {
      setError("Start date and target end date are required.");
      return;
    }
    if (targetDate < startDate) {
      setError("Target end date can't be before the start date.");
      return;
    }
    setSaving(true);
    setError("");

    const payload: Record<string, any> = {};
    if (name.trim() !== initiative.name) payload.name = name.trim();
    if ((description || null) !== (initiative.description ?? null)) payload.description = description || null;
    if (status !== initiative.status) payload.status = status;
    if ((startDate || null) !== (initiative.start_date ?? null)) payload.start_date = startDate;
    if ((targetDate || null) !== (initiative.target_end_date ?? null)) payload.target_end_date = targetDate;
    if ((primaryStakeholderId || null) !== (initiative.primary_stakeholder_id ?? null)) payload.primary_stakeholder_id = primaryStakeholderId || null;
    if ((ownerId || null) !== (initiative.owner_id ?? null)) payload.owner_id = ownerId || null;
    if (impactCategory !== (initiative.impact_category ?? "other")) payload.impact_category = impactCategory;
    if ((impact || null) !== (initiative.impact ?? null)) payload.impact = impact || null;
    if ((impactMetric || null) !== (initiative.impact_metric ?? null)) payload.impact_metric = impactMetric || null;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    try {
      await apiFetch(`/api/v1/initiatives/${initiative.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update initiative.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-pebble sticky top-0 bg-white">
          <h2 className="text-xl font-bold text-midnight">Edit Initiative</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-mist">
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Name *</label>
            <input className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
              value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Description</label>
            <textarea className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red">
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="in_progress">In progress</option>
                <option value="paused">Paused</option>
                <option value="on_hold">On hold</option>
                <option value="done">Done</option>
                <option value="completed">Completed</option>
                <option value="reopened">Reopened</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Category</label>
              <select value={impactCategory} onChange={(e) => setImpactCategory(e.target.value as ImpactCatValue)}
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red">
                {IMPACT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Target End Date *</label>
              <input type="date" value={targetDate} min={startDate || undefined} onChange={(e) => setTargetDate(e.target.value)} required
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Primary Stakeholder</label>
              <select value={primaryStakeholderId} onChange={(e) => setPrimaryStakeholderId(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red">
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Owner</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red">
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Expected Impact</label>
            <textarea className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red resize-none"
              rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1.5">Impact Metric</label>
            <input className="w-full border border-pebble rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-taskora-red"
              value={impactMetric} onChange={(e) => setImpactMetric(e.target.value)} maxLength={200} />
          </div>

          {/* Followers: read-only viewers of the entire initiative tree */}
          <div className="pt-2 border-t border-pebble">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-steel uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Followers
              </label>
              {!followerAddOpen && (
                <button
                  type="button"
                  onClick={() => setFollowerAddOpen(true)}
                  className="flex items-center gap-1 text-xs text-taskora-red hover:underline font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" /> Add follower
                </button>
              )}
            </div>
            <p className="text-[11px] text-steel/70 mb-2">
              Read-only access to this initiative, its tasks, and subtasks. Followers can&apos;t edit or create.
            </p>

            {followers.length === 0 ? (
              <p className="text-xs text-steel/60 italic">No followers yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {followers.map((f) => (
                  <span
                    key={f.user_id}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-mist border border-pebble"
                  >
                    <span className="text-midnight font-medium">{f.name || f.email || f.user_id}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFollower(f.user_id)}
                      aria-label={`Remove ${f.name || f.email}`}
                      className="text-steel/60 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {followerError && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {followerError}
              </div>
            )}

            {followerAddOpen && (() => {
              const available = members.filter(
                (m) => !followers.some((f) => f.user_id === m.user_id),
              );
              return (
                <div className="mt-3 border border-pebble rounded-lg bg-white">
                  <p className="text-xs text-steel/70 px-3 pt-3 pb-2">
                    Select members to add as followers. Showing all workspace members not already following.
                  </p>
                  <div className="max-h-44 overflow-y-auto px-3">
                    {available.length === 0 ? (
                      <p className="text-xs text-steel/60 italic py-2">
                        All workspace members are already followers.
                      </p>
                    ) : (
                      available.map((m) => {
                        const checked = pickedIds.includes(m.user_id);
                        return (
                          <label
                            key={m.user_id}
                            className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-mist/40 rounded px-1"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePick(m.user_id)}
                              className="rounded border-pebble accent-taskora-red"
                            />
                            <span className="text-sm text-midnight font-medium">
                              {m.name || m.email}
                            </span>
                            {m.name && m.email && (
                              <span className="text-xs text-steel/60 truncate">{m.email}</span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="flex gap-2 px-3 py-3 border-t border-pebble">
                    <button
                      type="button"
                      onClick={handleAddFollowers}
                      disabled={pickedIds.length === 0 || followerBusy}
                      className="px-3 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                      {followerBusy
                        ? "Adding…"
                        : `Add${pickedIds.length > 0 ? ` (${pickedIds.length})` : ""}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFollowerAddOpen(false);
                        setPickedIds([]);
                      }}
                      className="px-3 py-2 rounded-lg border border-pebble text-sm text-steel hover:bg-mist"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-pebble text-sm text-steel hover:bg-mist font-medium">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>

        <div className="border-t border-pebble bg-mist/30 px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-steel" />
            <h3 className="text-sm font-semibold text-midnight">Recent activity</h3>
          </div>
          {activity.length === 0 ? (
            <p className="text-xs text-steel/70">No edits logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {activity.slice(0, 8).map((log) => {
                const fieldName = log.action.replace(/^initiative_/, "").replace(/_changed$/, "").replace(/_/g, " ");
                const oldV = log.old_value?.name ?? log.old_value?.value;
                const newV = log.new_value?.name ?? log.new_value?.value;
                return (
                  <li key={log.id} className="flex items-start gap-2 text-xs">
                    <span className="text-steel/60 whitespace-nowrap">{new Date(log.created_at).toLocaleDateString()}</span>
                    <span className="text-midnight flex-1">
                      <span className="font-medium">{log.actor_email ?? "Someone"}</span>{" "}
                      changed <span className="font-medium">{fieldName}</span>
                      {oldV !== undefined && newV !== undefined && (
                        <>
                          {" from "}
                          <span className="line-through text-steel/70">{String(oldV ?? "—")}</span>
                          {" → "}
                          <span className="font-medium">{String(newV ?? "—")}</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
