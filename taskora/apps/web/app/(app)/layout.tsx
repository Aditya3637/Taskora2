"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Sun,
  Users,
  Building2,
  CheckSquare,
  BarChart3,
  LineChart,
  Notebook,
  ShieldCheck,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsUpDown,
  Menu,
  X as XIcon,
  Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import PersonaSwitcher from "@/components/testing/PersonaSwitcher";
import NotificationBell from "@/components/NotificationBell";
import FirstRunWelcome from "@/components/FirstRunWelcome";
import QuickCapture from "@/components/QuickCapture";
import CommandK from "@/components/CommandK";
import PresenceStrip from "@/components/PresenceStrip";
import { Avatar, Tooltip, Spinner, Badge, cn, ToastProvider } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type NavItem = {
  href: string;
  label: string;
  Icon: typeof Sun;
};

// The 7-surface IA (nav 10→7). Home/Roadmap/Insights are merged tab shells that
// reuse the old pages; the legacy routes still resolve for deep links.
const coreNavItems: NavItem[] = [
  { href: "/home",     label: "Home",     Icon: Sun },          // My Day · Daily Brief · Portfolio · Nudges
  { href: "/roadmap",  label: "Roadmap",  Icon: BarChart3 },    // Timeline (Gantt) · Programmes
  { href: "/tasks",    label: "Work",     Icon: CheckSquare },
  { href: "/sites",    label: "Sites",    Icon: Building2 },
  { href: "/people",   label: "People",   Icon: Users },
  { href: "/insights", label: "Insights", Icon: LineChart },    // Analytics · War Room
  { href: "/notebook", label: "Notebook", Icon: Notebook },
];

const SIDEBAR_KEY = "taskora_sidebar_expanded";
const SIDEBAR_NAME_MAX = 24;

function clampLabel(s: string, max = SIDEBAR_NAME_MAX): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// ── Sidebar inner content (shared between desktop & mobile drawer) ─────────────
function SidebarContent({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string; is_owner: boolean; company_id?: string | null; company_name?: string | null }[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Create-workspace modal. The backend caps owned workspaces at one per
  // user (anti-abuse), so for someone who already owns one we surface that
  // up-front instead of letting them type a name and hit a 409.
  const [createOpen, setCreateOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [createWsErr, setCreateWsErr] = useState("");

  async function createWorkspace() {
    const name = newWsName.trim();
    if (!name) return;
    setCreatingWs(true);
    setCreateWsErr("");
    try {
      const biz: { id?: string } = await apiFetch("/api/v1/businesses/", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (typeof window !== "undefined" && biz?.id) {
        // Switch into the new workspace; the layout re-resolves on reload.
        localStorage.setItem("business_id", biz.id);
        window.location.href = "/home";
      }
    } catch (e: any) {
      // 409 surfaces the friendly cap message ("You already own a workspace…").
      setCreateWsErr(e?.detail || e?.message || "Couldn't create workspace.");
      setCreatingWs(false);
    }
  }
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    async function loadRoles() {
      const { data: { user } } = await supabase.auth.getUser();
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const metaName = typeof meta.name === "string" ? meta.name : "";
      setUserName(metaName || user?.email || "");

      try {
        const me = await apiFetch("/api/v1/users/me");
        if (me?.is_platform_admin) setIsPlatformAdmin(true);
      } catch { /* not signed in / transient */ }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        let businessId =
          typeof window !== "undefined"
            ? localStorage.getItem("business_id") ?? ""
            : "";

        try {
          const url = businessId
            ? `${API}/api/v1/businesses/my?prefer=${encodeURIComponent(businessId)}`
            : `${API}/api/v1/businesses/my`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const biz = await res.json();
            if (biz?.id) {
              businessId = biz.id;
              localStorage.setItem("business_id", businessId);
            }
            if (biz?.name) setWorkspaceName(biz.name);
          }
        } catch {
          /* network blip — fall back to the cached id below */
        }

        try {
          const list = await apiFetch("/api/v1/businesses/mine");
          if (Array.isArray(list)) setWorkspaces(list);
        } catch { /* non-critical */ }

        if (businessId) {
          const subRes = await fetch(`${API}/api/v1/billing/status/${businessId}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });

          if (subRes.ok) {
            const sub = await subRes.json();
            if (sub?.status === "trialing" && sub?.trial_end) {
              const daysLeft = Math.ceil(
                (new Date(sub.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
              setTrialDaysLeft(Math.max(0, daysLeft));
            }
          }
        }
      } catch {
        /* non-critical */
      }
    }
    loadRoles();
  }, []);

  async function handleSignOut() {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Sign out of Taskora?")
    ) {
      return;
    }
    localStorage.removeItem("taskora_owner_session");
    localStorage.removeItem("taskora_owner_mode");
    sessionStorage.removeItem("taskora_persona_active");
    localStorage.removeItem("business_id");
    await supabase.auth.signOut();
    router.push("/login");
  }

  const navItems: NavItem[] = [
    ...coreNavItems,
    ...(isPlatformAdmin
      ? [{ href: "/admin", label: "Admin", Icon: ShieldCheck }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full bg-chrome overflow-hidden chrome-scroll text-chrome-fg">
      {/* ── Brand + collapse ───────────────────────────────────────── */}
      <div
        className={cn(
          "h-14 flex items-center border-b border-chrome-line flex-shrink-0 px-3",
          expanded ? "justify-between" : "justify-center",
        )}
      >
        {expanded && (
          <Link
            href="/home"
            className="flex items-center gap-2 min-w-0"
            aria-label="Taskora — go to Home"
          >
            <span
              aria-hidden="true"
              className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm"
            >
              <span className="text-white font-display font-bold text-sm leading-none">T</span>
            </span>
            <span className="font-display font-semibold text-chrome-fg text-[15px] tracking-tighter-1 truncate">
              Taskora
            </span>
          </Link>
        )}
        <Tooltip label={expanded ? "Collapse sidebar" : "Expand sidebar"} side="right">
          <button
            onClick={onToggle}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="h-8 w-8 inline-flex items-center justify-center text-chrome-fg-muted hover:text-chrome-fg hover:bg-white/5 rounded-md transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {expanded ? <PanelLeftClose className="h-[18px] w-[18px]" /> : <PanelLeftOpen className="h-[18px] w-[18px]" />}
          </button>
        </Tooltip>
      </div>

      {/* ── Global search trigger (opens ⌘K palette) ───────────────── */}
      <div className="px-2 pt-3">
        <Tooltip label={expanded ? "" : "Search (⌘K)"} side="right">
          <button
            onClick={() => window.dispatchEvent(new Event("taskora:command-k"))}
            aria-label="Search"
            className={cn(
              "w-full h-9 inline-flex items-center rounded-md border border-chrome-line text-chrome-fg-muted hover:text-chrome-fg hover:bg-white/5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              expanded ? "px-2.5 gap-2 justify-between" : "justify-center",
            )}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <Search className="h-[15px] w-[15px] flex-shrink-0" />
              {expanded && <span className="text-[13px] truncate">Search…</span>}
            </span>
            {expanded && (
              <kbd className="text-[10px] border border-chrome-line rounded px-1 py-0.5 text-chrome-fg-muted">⌘K</kbd>
            )}
          </button>
        </Tooltip>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────── */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden" aria-label="Primary">
        <ul className="space-y-0.5 px-2">
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href);
            const link = (
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center rounded-md transition-colors duration-fast",
                  expanded ? "gap-3 px-2.5 py-2" : "justify-center py-2",
                  active
                    ? "bg-white/[0.08] text-chrome-fg"
                    : "text-chrome-fg-muted hover:text-chrome-fg hover:bg-white/[0.04]",
                )}
              >
                {/* Active accent rail. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-opacity duration-fast",
                    active ? "bg-brand-500 opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] flex-shrink-0",
                    active ? "text-chrome-fg" : "text-chrome-fg-muted group-hover:text-chrome-fg",
                  )}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {expanded && (
                  <span className="text-[13px] font-medium tracking-tight whitespace-nowrap">
                    {label}
                  </span>
                )}
              </Link>
            );
            return (
              <li key={href}>
                {expanded ? link : <Tooltip label={label} side="right">{link}</Tooltip>}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Trial chip ─────────────────────────────────────────────── */}
      {trialDaysLeft !== null && (
        <div className="px-2 pb-2 flex-shrink-0">
          {expanded ? (
            <div
              className={cn(
                "rounded-md px-3 py-2 text-[12px] flex items-center gap-2",
                trialDaysLeft <= 7
                  ? "bg-brand-700/30 text-brand-100 border border-brand-700/60"
                  : "bg-white/[0.06] text-chrome-fg-muted border border-white/[0.08]",
              )}
            >
              {trialDaysLeft > 0 ? (
                <>
                  <span className="tabular font-semibold text-chrome-fg">{trialDaysLeft}d</span>
                  <span className="opacity-80">left in trial</span>
                </>
              ) : (
                <span className="font-medium text-brand-100">Trial expired — upgrade to continue</span>
              )}
            </div>
          ) : (
            <Tooltip label={trialDaysLeft > 0 ? `${trialDaysLeft} days left in trial` : "Trial expired"} side="right">
              <div className="mx-auto w-9 h-7 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[10.5px] font-bold text-chrome-fg tabular">
                {trialDaysLeft}d
              </div>
            </Tooltip>
          )}
        </div>
      )}

      {/* ── Identity + footer actions ──────────────────────────────── */}
      <div className="border-t border-chrome-line p-2 flex-shrink-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={switcherOpen}
            title={!expanded ? `${workspaceName || "Workspace"} · ${userName || ""}` : undefined}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-md transition-colors duration-fast",
              "hover:bg-white/[0.05]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              expanded ? "px-2 py-2" : "p-1.5 justify-center",
            )}
          >
            <Avatar
              name={workspaceName || "?"}
              size="md"
              square
              className="shadow-sm"
            />
            {expanded && (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-semibold text-chrome-fg truncate leading-tight">
                    {clampLabel(workspaceName || "Workspace")}
                  </span>
                  {userName && (
                    <span className="block text-[11px] text-chrome-fg-muted truncate leading-tight mt-0.5">
                      {clampLabel(userName)}
                    </span>
                  )}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-chrome-fg-muted flex-shrink-0" />
              </>
            )}
          </button>

          {switcherOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 bottom-full mb-2 bg-chrome-2 border border-chrome-line rounded-lg shadow-xl z-30 py-1 max-h-72 overflow-y-auto chrome-scroll animate-scale-in origin-bottom"
            >
              {(() => {
                // Group workspaces by company so a multi-workspace company reads
                // as one heading with its workspaces beneath it.
                const order: string[] = [];
                const byCompany: Record<string, typeof workspaces> = {};
                for (const w of workspaces) {
                  const key = w.company_name || "";
                  if (!byCompany[key]) { byCompany[key] = []; order.push(key); }
                  byCompany[key].push(w);
                }
                return order.map((company) => (
                  <div key={company || "_none"}>
                    {company && (
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-chrome-fg-muted/70">
                        {company}
                      </div>
                    )}
                    {byCompany[company].map((w) => {
                      const active =
                        typeof window !== "undefined" &&
                        localStorage.getItem("business_id") === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (typeof window === "undefined") return;
                            localStorage.setItem("business_id", w.id);
                            window.location.reload();
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors duration-fast",
                            active
                              ? "bg-white/[0.08] text-chrome-fg"
                              : "text-chrome-fg-muted hover:bg-white/[0.04] hover:text-chrome-fg",
                          )}
                        >
                          <Avatar name={w.name || "?"} size="sm" square />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-medium truncate leading-tight">
                              {w.name || "Workspace"}
                            </span>
                            <span className="block text-[10.5px] opacity-70 capitalize leading-tight mt-0.5">
                              {w.role}{w.is_owner ? " · owner" : ""}
                            </span>
                          </span>
                          {active && <Badge tone="brand" size="sm" dot>active</Badge>}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}

              {/* Create a new workspace. Owned-workspace cap is enforced in
                  the modal (and re-checked server-side). */}
              <div className="border-t border-chrome-line my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSwitcherOpen(false);
                  setNewWsName("");
                  setCreateWsErr("");
                  setCreateOpen(true);
                }}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-chrome-fg-muted hover:bg-white/[0.04] hover:text-chrome-fg transition-colors duration-fast"
              >
                <span className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-white/15 text-sm flex-shrink-0">+</span>
                <span className="text-[12.5px] font-medium">New workspace</span>
              </button>
            </div>
          )}
        </div>

        {createOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => !creatingWs && setCreateOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Create workspace"
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5"
              onClick={(e) => e.stopPropagation()}
            >
              {(
                <>
                  <h2 className="text-base font-bold text-midnight mb-1">New workspace</h2>
                  <p className="text-sm text-steel mb-3">
                    You’ll be the owner and can invite teammates afterward.
                  </p>
                  <input
                    autoFocus
                    value={newWsName}
                    onChange={(e) => setNewWsName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createWorkspace();
                      else if (e.key === "Escape") setCreateOpen(false);
                    }}
                    placeholder="Workspace name"
                    disabled={creatingWs}
                    className="w-full border border-pebble rounded px-3 py-1.5 text-sm text-midnight focus:outline-none focus:border-taskora-red"
                  />
                  {createWsErr && <p className="text-xs text-red-600 mt-2">{createWsErr}</p>}
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={() => setCreateOpen(false)}
                      disabled={creatingWs}
                      className="h-9 px-4 border border-pebble text-steel text-sm font-semibold rounded-lg hover:bg-mist disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void createWorkspace()}
                      disabled={creatingWs || !newWsName.trim()}
                      className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
                    >
                      {creatingWs ? "Creating…" : "Create"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="mt-1 space-y-0.5">
          <FooterAction
            href="/workspace/settings"
            label="Workspace"
            expanded={expanded}
            Icon={Settings}
          />
          <FooterAction
            label="Sign out"
            expanded={expanded}
            Icon={LogOut}
            onClick={handleSignOut}
          />
        </div>
      </div>
    </div>
  );
}

function FooterAction({
  href,
  label,
  expanded,
  Icon,
  onClick,
}: {
  href?: string;
  label: string;
  expanded: boolean;
  Icon: typeof Settings;
  onClick?: () => void;
}) {
  const cls = cn(
    "w-full flex items-center rounded-md text-chrome-fg-muted hover:text-chrome-fg hover:bg-white/[0.05]",
    "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
    expanded ? "gap-3 px-2.5 py-2" : "justify-center py-2",
  );
  const content = (
    <>
      <Icon className="h-[16px] w-[16px] flex-shrink-0" strokeWidth={1.8} />
      {expanded && <span className="text-[13px] font-medium">{label}</span>}
    </>
  );
  if (href) {
    const link = (
      <Link href={href} className={cls} aria-label={label}>
        {content}
      </Link>
    );
    return expanded ? link : <Tooltip label={label} side="right">{link}</Tooltip>;
  }
  const btn = (
    <button type="button" onClick={onClick} className={cls} aria-label={label}>
      {content}
    </button>
  );
  return expanded ? btn : <Tooltip label={label} side="right">{btn}</Tooltip>;
}

// ── App Layout ────────────────────────────────────────────────────────────────
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState<boolean>(
    typeof window !== "undefined" && !!localStorage.getItem("business_id"),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const storedBizId =
          typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
        const res = await fetch(
          `${API}/api/v1/onboarding/status${storedBizId ? `?business_id=${storedBizId}` : ""}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (cancelled) return;
        if (res.status === 404) {
          try {
            const inv = await fetch(`${API}/api/v1/invites/pending-for-me`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (cancelled) return;
            const invData = inv.ok ? await inv.json() : null;
            if (invData?.token) {
              router.replace(`/invite/${invData.token}`);
              return;
            }
          } catch { /* fall through to onboarding */ }
          router.replace("/onboarding");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data?.onboarding_completed === false) {
            setOnboarded(false);
            router.replace("/onboarding");
            return;
          }
        }
        setOnboarded(true);
      } catch {
        if (!cancelled) setOnboarded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored !== null) setExpanded(stored === "true");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (workspaceReady) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) setWorkspaceReady(true);
          return;
        }
        try {
          const res = await fetch(`${API}/api/v1/businesses/my`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (cancelled) return;
          if (res.ok) {
            const biz = await res.json();
            if (biz?.id && typeof window !== "undefined") {
              localStorage.setItem("business_id", biz.id);
            }
          }
        } catch { /* network blip */ }
      } catch {
        /* unknown error */
      } finally {
        if (!cancelled) setWorkspaceReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceReady]);

  useEffect(() => {
    if (mounted) localStorage.setItem(SIDEBAR_KEY, String(expanded));
  }, [expanded, mounted]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const sidebarW = mounted ? (expanded ? "15rem" : "3.75rem") : "15rem";

  if (onboarded !== true || !workspaceReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-3">
        <span
          aria-hidden="true"
          className="h-10 w-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm animate-pulse-soft"
        >
          <span className="text-white font-display font-bold text-base leading-none">T</span>
        </span>
        <Spinner size="sm" />
        <span className="text-xs text-fg-subtle">Loading your workspace…</span>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        {/* Desktop sidebar */}
        <aside
          className="hidden md:flex flex-col sticky top-0 self-start h-screen z-50 border-r border-chrome-line overflow-hidden flex-shrink-0"
          style={{ width: sidebarW, transition: "width 220ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          <SidebarContent
            expanded={expanded}
            onToggle={() => setExpanded(v => !v)}
          />
        </aside>

        {/* Mobile top bar */}
        <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-chrome border-b border-chrome-line z-50 flex items-center px-3 gap-3">
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="h-9 w-9 inline-flex items-center justify-center text-chrome-fg-muted hover:text-chrome-fg rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <XIcon className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link href="/home" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm"
            >
              <span className="text-white font-display font-bold text-sm leading-none">T</span>
            </span>
            <span className="font-display font-semibold text-chrome-fg text-[15px] tracking-tighter-1">
              Taskora
            </span>
          </Link>
          <button
            onClick={() => window.dispatchEvent(new Event("taskora:command-k"))}
            aria-label="Search"
            className="ml-auto h-9 w-9 inline-flex items-center justify-center text-chrome-fg-muted hover:text-chrome-fg rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0"
          >
            <Search className="h-5 w-5" />
          </button>
        </header>

        {mobileOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "md:hidden fixed top-0 left-0 h-full w-64 z-50",
            "transition-transform duration-slow ease-out-soft",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SidebarContent
            expanded={true}
            onToggle={() => setMobileOpen(false)}
          />
        </aside>

        {/* Main content */}
        <main className="min-h-screen pt-14 md:pt-0 flex-1 min-w-0">
          {children}
        </main>
      </div>
      <NotificationBell />
      <FirstRunWelcome />
      <QuickCapture />
      <CommandK />
      <PresenceStrip />
      <PersonaSwitcher />
    </ToastProvider>
  );
}
