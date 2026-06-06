"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks, X, Plus } from "lucide-react";
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
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
          <ListChecks className="w-3.5 h-3.5 text-ocean" /> Checklist
        </h2>
      </div>

      {/* Tab toggle — segmented control */}
      <div className="flex gap-0.5 mb-3 p-0.5 bg-mist rounded-lg text-xs">
        <button
          onClick={() => setTab("mine")}
          className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors ${
            tab === "mine" ? "bg-white text-fg shadow-sm" : "text-fg-muted hover:text-fg"
          }`}
        >
          My checklist
        </button>
        <button
          onClick={() => setTab("assigned")}
          className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === "assigned" ? "bg-white text-fg shadow-sm" : "text-fg-muted hover:text-fg"
          }`}
        >
          Assigned
          {assignedCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-taskora-red text-white">
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
            <p className="text-xs text-fg-subtle mb-2">
              No items yet. Add one below — or accept tasks from the other tab.
            </p>
          )}
          {mine.map((item) => (
            <div key={item.id} className="flex items-start gap-2 group py-1 px-1.5 -mx-1.5 hover:bg-mist rounded-md transition-colors">
              <input
                type="checkbox"
                checked={item.status === "done"}
                onChange={() => toggleDone(item)}
                className="mt-1 w-4 h-4 accent-ocean flex-shrink-0 cursor-pointer"
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
                  className="flex-1 text-sm bg-transparent border-b border-ocean focus:outline-none"
                />
              ) : (
                <span
                  onClick={() => item.status !== "done" && startEdit(item)}
                  title={item.status === "done" ? "" : "Click to edit"}
                  className={`flex-1 text-sm cursor-text ${
                    item.status === "done" ? "line-through text-fg-subtle cursor-default" : "text-fg"
                  }`}
                >
                  {item.content}
                </span>
              )}
              <button
                onClick={() => deleteItem(item.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-fg-subtle hover:text-red-500 hover:bg-white"
                aria-label="Delete"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="mt-2 relative">
            <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
            <input
              ref={addRef}
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addItem();
                else if (e.key === "Escape") setNewItem("");
              }}
              placeholder="Add an item — press Enter"
              className="w-full text-sm bg-white border border-pebble rounded-lg pl-8 pr-3 py-1.5 placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ocean/30 focus:border-ocean transition-shadow"
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
            <div key={a.id} className="border border-pebble rounded-xl p-3 bg-white shadow-sm">
              <p className="text-sm text-fg">{a.content}</p>
              <p className="text-[11px] text-fg-subtle mt-1">
                From <span className="font-medium text-fg-muted">{a.sender_name || "someone"}</span>
              </p>
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={() => accept(a)}
                  className="text-xs px-2.5 py-1 bg-ocean text-white rounded-lg hover:opacity-90 font-medium"
                >
                  Accept
                </button>
                <button
                  onClick={() => decline(a)}
                  className="text-xs px-2.5 py-1 border border-pebble text-fg-muted rounded-lg hover:bg-mist"
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
