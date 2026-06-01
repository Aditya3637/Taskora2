"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Assignment, ChecklistItem } from "../_lib/types";

type Tab = "mine" | "assigned";

/**
 * Personal global checklist with two tabs:
 *   - My checklist: items the caller owns
 *   - Tasks assigned by others: pending delegations with count badge
 * Accept on an assignment promotes it to the My tab.
 */
export default function Checklist({ onChange }: { onChange?: () => void }) {
  const [tab, setTab] = useState<Tab>("mine");
  const [mine, setMine] = useState<ChecklistItem[]>([]);
  const [assigned, setAssigned] = useState<Assignment[]>([]);
  const [assignedCount, setAssignedCount] = useState(0);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(true);
  // Inline edit of an existing item.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const addRef = useRef<HTMLInputElement | null>(null);

  const loadMine = useCallback(async () => {
    const data = await apiFetch("/api/v1/notebook/checklist?tab=mine");
    setMine(Array.isArray(data) ? data : []);
  }, []);

  const loadAssigned = useCallback(async () => {
    const data = await apiFetch("/api/v1/notebook/checklist?tab=assigned");
    setAssigned(Array.isArray(data) ? data : []);
  }, []);

  const loadCount = useCallback(async () => {
    const data = await apiFetch("/api/v1/notebook/checklist/assigned-count");
    setAssignedCount(data?.count ?? 0);
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadMine(), loadAssigned(), loadCount()]);
      setLoading(false);
    })();
  }, [loadMine, loadAssigned, loadCount]);

  const addItem = async () => {
    const content = newItem.trim();
    if (!content) return;
    await apiFetch("/api/v1/notebook/checklist", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    setNewItem("");
    await loadMine();
    onChange?.();
    // Keep the cursor in the box so you can rattle off several items.
    addRef.current?.focus();
  };

  const startEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditText(item.content);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const content = editText.trim();
    const id = editingId;
    setEditingId(null);
    if (!content) return;
    await apiFetch(`/api/v1/notebook/checklist/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
    await loadMine();
    onChange?.();
  };

  const toggleDone = async (item: ChecklistItem) => {
    await apiFetch(`/api/v1/notebook/checklist/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: item.status === "done" ? "open" : "done" }),
    });
    await loadMine();
    onChange?.();
  };

  const deleteItem = async (id: string) => {
    await apiFetch(`/api/v1/notebook/checklist/${id}`, { method: "DELETE" });
    await loadMine();
    onChange?.();
  };

  const accept = async (a: Assignment) => {
    await apiFetch(`/api/v1/notebook/assignments/${a.id}/accept`, { method: "POST" });
    await Promise.all([loadMine(), loadAssigned(), loadCount()]);
    onChange?.();
  };

  const decline = async (a: Assignment) => {
    await apiFetch(`/api/v1/notebook/assignments/${a.id}/decline`, { method: "POST" });
    await Promise.all([loadAssigned(), loadCount()]);
    onChange?.();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold tracking-wide text-steel uppercase">Checklist</h2>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-0 mb-2 text-xs">
        <button
          onClick={() => setTab("mine")}
          className={`px-3 py-1.5 rounded-l border ${
            tab === "mine"
              ? "bg-midnight text-white border-midnight"
              : "bg-white text-steel border-pebble hover:text-midnight"
          }`}
        >
          My checklist
        </button>
        <button
          onClick={() => setTab("assigned")}
          className={`px-3 py-1.5 rounded-r border-y border-r flex items-center gap-1.5 ${
            tab === "assigned"
              ? "bg-midnight text-white border-midnight"
              : "bg-white text-steel border-pebble hover:text-midnight"
          }`}
        >
          Assigned by others
          {assignedCount > 0 && (
            <span
              className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                tab === "assigned" ? "bg-white text-midnight" : "bg-taskora-red text-white"
              }`}
            >
              {assignedCount}
            </span>
          )}
        </button>
      </div>

      {loading && <div className="text-xs text-steel/60">Loading…</div>}

      {/* Mine tab */}
      {!loading && tab === "mine" && (
        <div className="flex flex-col gap-1 overflow-y-auto flex-1">
          {mine.length === 0 && (
            <p className="text-xs text-steel/60 italic mb-2">
              No items yet. Add one below — or accept tasks from the other tab.
            </p>
          )}
          {mine.map((item) => (
            <div key={item.id} className="flex items-start gap-2 group py-1 px-1 hover:bg-pebble/40 rounded">
              <input
                type="checkbox"
                checked={item.status === "done"}
                onChange={() => toggleDone(item)}
                className="mt-1 accent-taskora-red flex-shrink-0"
              />
              {editingId === item.id ? (
                <input
                  type="text"
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                  }}
                  className="flex-1 text-sm bg-transparent border-b border-taskora-red focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => item.status !== "done" && startEdit(item)}
                  title={item.status === "done" ? "" : "Click to edit"}
                  className={`flex-1 text-sm cursor-text ${
                    item.status === "done" ? "line-through text-steel/60 cursor-default" : "text-midnight"
                  }`}
                >
                  {item.content}
                </span>
              )}
              <button
                onClick={() => deleteItem(item.id)}
                className="opacity-0 group-hover:opacity-100 text-steel/50 hover:text-red-500 text-xs"
                aria-label="Delete"
              >
                ×
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <input
              ref={addRef}
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addItem();
                else if (e.key === "Escape") setNewItem("");
              }}
              placeholder="+ Add an item — press Enter"
              className="flex-1 text-sm bg-transparent border-b border-pebble focus:border-taskora-red focus:outline-none py-1"
            />
          </div>
        </div>
      )}

      {/* Assigned tab */}
      {!loading && tab === "assigned" && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {assigned.length === 0 && (
            <p className="text-xs text-steel/60 italic">
              Your inbox is empty. Items appear here when someone @-mentions you
              with a task on a notebook page.
            </p>
          )}
          {assigned.map((a) => (
            <div key={a.id} className="border border-pebble rounded p-2 bg-white">
              <p className="text-sm text-midnight">{a.content}</p>
              <p className="text-[11px] text-steel/70 mt-1">
                From <span className="font-medium">{a.sender_name || "someone"}</span>
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => accept(a)}
                  className="text-xs px-2 py-1 bg-taskora-red text-white rounded hover:opacity-90"
                >
                  Accept
                </button>
                <button
                  onClick={() => decline(a)}
                  className="text-xs px-2 py-1 border border-pebble text-steel rounded hover:bg-pebble/40"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
