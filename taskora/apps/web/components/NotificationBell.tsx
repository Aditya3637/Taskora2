"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Settings as SettingsIcon, ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn, useToast } from "@/components/ui";

// Event types shown in the settings matrix. `push` flags the types that can
// fire a device push (the rest are in-app only — matching the backend).
const NOTIF_TYPES: { type: string; label: string; push: boolean }[] = [
  { type: "assigned", label: "Assigned to me", push: true },
  { type: "approval_requested", label: "Approval requested", push: true },
  { type: "approval_resolved", label: "Approval decided", push: true },
  { type: "blocked", label: "Blocked items", push: true },
  { type: "mentioned", label: "Mentions", push: false },
  { type: "comment", label: "Comments", push: false },
  { type: "due_soon", label: "Due soon", push: false },
  { type: "overdue", label: "Overdue", push: false },
];

type Prefs = Record<string, { inapp?: boolean; push?: boolean }>;

type Notif = {
  id: string;
  ts: string;
  template: string;
  meta: {
    title?: string;
    body?: string;
    entity_type?: string | null;
    entity_id?: string | null;
    actor_id?: string | null;
  } | null;
  opened_at: string | null;
  clicked_at: string | null;
};

const POLL_MS = 60_000;

// Best-effort deep-link until per-entity routes land. Marks read either way.
function hrefFor(n: Notif): string | null {
  const t = n.meta?.entity_type;
  if (t === "task" || t === "subtask" || t === "entity") return "/tasks";
  if (t === "initiative" || t === "program") return "/programs";
  return null;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function bizId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("business_id") ?? "";
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-[18px] w-9 items-center rounded-full transition-colors",
        on ? "bg-taskora-red" : "bg-pebble",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export default function NotificationBell() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"feed" | "settings">("feed");
  const [prefs, setPrefs] = useState<Prefs>({});
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const bid = bizId();
    if (!bid) return;
    try {
      const data = await apiFetch(`/api/v1/notifications?business_id=${encodeURIComponent(bid)}&limit=30`);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setUnread(data?.unread_count ?? 0);
    } catch {
      /* transient — keep last state */
    }
  }, []);

  // Initial load + poll on focus + every 60s. Cheap, no realtime infra (v1).
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(load, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the drawer = "seen": clears the badge.
    if (next && unread > 0) {
      const bid = bizId();
      setUnread(0);
      try {
        await apiFetch(`/api/v1/notifications/seen?business_id=${encodeURIComponent(bid)}`, { method: "POST" });
      } catch { /* best effort */ }
    }
  }

  async function openItem(n: Notif) {
    setOpen(false);
    try {
      await apiFetch(`/api/v1/notifications/${n.id}/read`, { method: "POST" });
    } catch { /* best effort */ }
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, clicked_at: new Date().toISOString() } : x)));
    const href = hrefFor(n);
    if (href) router.push(href);
  }

  async function markAllRead() {
    const bid = bizId();
    setItems((prev) => prev.map((x) => ({ ...x, clicked_at: x.clicked_at ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await apiFetch(`/api/v1/notifications/read-all?business_id=${encodeURIComponent(bid)}`, { method: "POST" });
      toast({ title: "All caught up", description: "Marked all notifications read." });
    } catch { /* best effort */ }
  }

  async function openSettings() {
    setView("settings");
    try {
      const data = await apiFetch("/api/v1/notifications/settings");
      setPrefs(data && typeof data === "object" ? data : {});
    } catch { /* keep current */ }
  }

  // Toggle one channel for one type and persist (default = on when absent).
  async function setChannel(type: string, channel: "inapp" | "push", on: boolean) {
    const next: Prefs = { ...prefs, [type]: { ...(prefs[type] ?? {}), [channel]: on } };
    setPrefs(next);
    try {
      await apiFetch("/api/v1/notifications/settings", {
        method: "PUT",
        body: JSON.stringify({ prefs: next }),
      });
    } catch { /* best effort; local state already reflects intent */ }
  }

  function isOn(type: string, channel: "inapp" | "push"): boolean {
    return prefs[type]?.[channel] ?? true;
  }

  const today: Notif[] = [];
  const earlier: Notif[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (const n of items) {
    (Date.now() - new Date(n.ts).getTime() < dayMs ? today : earlier).push(n);
  }

  function Row({ n }: { n: Notif }) {
    const isRead = !!n.clicked_at;
    return (
      <button
        type="button"
        onClick={() => openItem(n)}
        className={cn(
          "w-full text-left flex gap-2.5 px-3.5 py-2.5 border-t border-pebble/60 transition-colors",
          "hover:bg-mist/60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0",
            isRead ? "bg-transparent border border-pebble" : "bg-taskora-red",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-midnight leading-snug">{n.meta?.title || "Notification"}</span>
          {n.meta?.body ? (
            <span className="block text-[11.5px] text-steel truncate mt-0.5">{n.meta.body}</span>
          ) : null}
        </span>
        <span className="text-[10.5px] text-steel/70 whitespace-nowrap mt-0.5">{timeAgo(n.ts)}</span>
      </button>
    );
  }

  return (
    <div className="fixed top-3 right-3 z-[60]" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        aria-expanded={open}
        className={cn(
          "relative h-9 w-9 inline-flex items-center justify-center rounded-lg",
          "bg-white border border-pebble shadow-sm text-steel hover:text-midnight hover:bg-mist transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taskora-red/40",
        )}
      >
        <Bell className="h-[17px] w-[17px]" strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-taskora-red text-white text-[10px] font-bold leading-[16px] text-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-11 right-0 w-[340px] max-h-[70vh] overflow-y-auto bg-white border border-pebble rounded-xl shadow-2xl animate-scale-in origin-top-right">
          {view === "feed" ? (
            <>
              <div className="flex items-center gap-2 px-3.5 h-11 border-b border-pebble sticky top-0 bg-white">
                <span className="font-semibold text-[13.5px] text-midnight">Notifications</span>
                <button
                  type="button"
                  onClick={markAllRead}
                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-steel hover:text-midnight"
                >
                  <Check className="h-3.5 w-3.5" /> Mark all read
                </button>
                <button
                  type="button"
                  onClick={openSettings}
                  aria-label="Notification settings"
                  className="text-steel hover:text-midnight"
                >
                  <SettingsIcon className="h-4 w-4" />
                </button>
              </div>

              {items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-[13px] font-medium text-midnight">You&rsquo;re all caught up.</p>
                  <p className="text-[11.5px] text-steel mt-1">New assignments, approvals and mentions show up here.</p>
                </div>
              ) : (
                <>
                  {today.length > 0 && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wide text-steel/70">Today</div>
                      {today.map((n) => <Row key={n.id} n={n} />)}
                    </>
                  )}
                  {earlier.length > 0 && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wide text-steel/70">Earlier</div>
                      {earlier.map((n) => <Row key={n.id} n={n} />)}
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3.5 h-11 border-b border-pebble sticky top-0 bg-white">
                <button
                  type="button"
                  onClick={() => setView("feed")}
                  aria-label="Back"
                  className="text-steel hover:text-midnight"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-semibold text-[13.5px] text-midnight">Notification settings</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3.5 py-2 text-[10.5px] uppercase tracking-wide text-steel/70 border-b border-pebble/60">
                <span>Notify me about</span><span>In-app</span><span>Push</span>
              </div>
              {NOTIF_TYPES.map(({ type, label, push }) => (
                <div key={type} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3.5 py-2.5 border-b border-pebble/40">
                  <span className="text-[12.5px] text-midnight">{label}</span>
                  <Toggle on={isOn(type, "inapp")} onChange={(v) => setChannel(type, "inapp", v)} />
                  {push ? (
                    <Toggle on={isOn(type, "push")} onChange={(v) => setChannel(type, "push", v)} />
                  ) : (
                    <span className="text-steel/40 text-center text-[16px] leading-none w-9">–</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
