"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { EntityStatusMatrix } from "./EntityStatusMatrix";
import { wrLinkHref, type QueueTask } from "./types";

const ALLOWED = ["done", "in_progress", "blocked", "pending_decision"] as const;

export function ActiveFocus({
  task,
  onActed,
}: {
  task: QueueTask | null;
  onActed: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!task) {
    return (
      <div className="p-6">
        <div className="text-center py-16 text-steel">
          <p className="text-lg font-medium">Nothing selected</p>
          <p className="text-sm mt-2">Pick an item from the Decision Queue to act on it.</p>
        </div>
        <EntityStatusMatrix entities={[]} />
      </div>
    );
  }

  const href = wrLinkHref(task.link);
  const entities = (task.task_entities ?? []).map((e) => ({
    name: e.entity_name ?? e.entity_id,
    status: (ALLOWED as readonly string[]).includes(e.per_entity_status ?? "")
      ? (e.per_entity_status as (typeof ALLOWED)[number])
      : "in_progress",
    due_date: e.per_entity_end_date ?? "—",
    last_updated: e.updated_at ? new Date(e.updated_at).toLocaleDateString() : "—",
  }));

  async function act(action: string) {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Reason for rejecting / sending back?");
      if (!reason) return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${task!.id}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          ...(reason ? { reason } : {}),
          ...(action === "snooze" ? { snooze_hours: 24 } : {}),
        }),
      });
      onActed();
    } catch { /* reload surfaces state */ } finally { setBusy(false); }
  }

  async function comment() {
    const c = window.prompt("Add a comment");
    if (!c?.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${task!.id}/comments`, {
        method: "POST", body: JSON.stringify({ content: c.trim() }),
      });
      onActed();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className="p-6">
      {(task.program_name || task.initiative_name) && (
        <p className="text-xs text-steel/70 mb-1">
          {task.program_name}
          {task.program_name && task.initiative_name && " › "}
          {task.initiative_name}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-midnight">{task.title}</h1>
        {href && (
          <button
            onClick={() => router.push(href)}
            className="text-xs text-ocean border border-pebble px-2.5 py-1 rounded-lg hover:bg-mist whitespace-nowrap"
          >
            Open full ↗
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-mist text-steel">{task.status.replace("_", " ")}</span>
        <span className="px-2 py-0.5 rounded-full bg-mist text-steel">{task.priority}</span>
        {task.age_label && <span className="text-steel/60">⏱ {task.age_label}</span>}
        {!!task.days_overdue && task.days_overdue > 0 && (
          <span className="text-red-700 font-semibold">{task.days_overdue}d overdue</span>
        )}
        {task.approval_state === "pending" && (
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold">awaiting approval</span>
        )}
      </div>

      {task.description && <p className="text-sm text-steel mt-3">{task.description}</p>}
      {task.blocker_reason && (
        <p className="text-sm text-red-700 mt-2"><span className="font-semibold">Blocked:</span> {task.blocker_reason}</p>
      )}
      {task.last_comment && (
        <p className="text-sm text-steel bg-mist/60 rounded p-2 mt-3">
          <span className="font-semibold text-midnight">{task.last_comment.author_name || "Someone"}</span>: {task.last_comment.snippet}
        </p>
      )}
      {!!task.pending_approvers?.length && (
        <p className="text-sm text-steel mt-2"><span className="font-semibold">Approvers:</span> {task.pending_approvers.join(", ")}</p>
      )}
      <p className="text-xs text-steel/70 mt-2">
        Owner: {task.primary_stakeholder_name || "—"}
        {task.total_subtasks ? ` · ${task.done_subtasks}/${task.total_subtasks} subtasks` : ""}
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        <button disabled={busy} onClick={() => act("approve")} className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">Approve</button>
        <button disabled={busy} onClick={() => act("reject")} className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50">Reject</button>
        <button disabled={busy} onClick={() => act("escalate")} className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50">Escalate</button>
        <button disabled={busy} onClick={() => act("snooze")} className="px-3 py-1.5 bg-pebble text-steel text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50">Snooze 24h</button>
        <button disabled={busy} onClick={comment} className="px-3 py-1.5 border border-pebble text-steel text-xs font-semibold rounded-lg hover:bg-mist disabled:opacity-50">Comment</button>
      </div>

      <EntityStatusMatrix entities={entities} />
    </div>
  );
}
