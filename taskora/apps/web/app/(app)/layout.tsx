"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import PersonaSwitcher from "@/components/testing/PersonaSwitcher";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

const coreNavItems = [
  { href: "/daily-brief", label: "Daily Brief", icon: "☀️" },
  { href: "/people",      label: "People",      icon: "👥" },
  { href: "/programs",    label: "Programs",    icon: "🗂️" },
  { href: "/tasks",       label: "Tasks",       icon: "✅" },
  { href: "/gantt",       label: "Gantt",       icon: "📊" },
  { href: "/analytics",   label: "Analytics",   icon: "📈" },
];

const SIDEBAR_KEY = "taskora_sidebar_expanded";

// "Business Excellence" → "BE". First letter of up to the first two words.
function workspaceInitials(name: string): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).slice(0, 2);
  const initials = words.map((w) => w[0]?.toUpperCase() ?? "").join("");
  return initials || "?";
}

// Hard cap on the visible workspace-name label in the sidebar identity row.
// CSS `truncate` already handles overflow, but a char cap gives a predictable
// max length regardless of sidebar width and avoids a single very long word
// (which CSS truncates aggressively) eating the whole row.
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
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    async function loadRoles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.is_admin) setIsPlatformAdmin(true);
      // Display name: prefer user_metadata.name (set during signup), else email.
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const metaName = typeof meta.name === "string" ? meta.name : "";
      setUserName(metaName || user?.email || "");

      // Ensure business_id is in localStorage — auto-resolve if missing
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        let businessId =
          typeof window !== "undefined"
            ? localStorage.getItem("business_id") ?? ""
            : "";

        // Always reconcile the cached business_id against the user's
        // actual business. A stale id (a prior account, a deleted test
        // workspace, the persona switcher) otherwise makes every
        // business-scoped call 403 "Not a member of this business".
        // Keep the cached id only as a fallback if the lookup fails.
        try {
          const res = await fetch(`${API}/api/v1/businesses/my`, {
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
    // Scrub owner/persona state so the next account on this browser
    // (e.g. a fresh signup) can't inherit the testing switcher.
    localStorage.removeItem("taskora_owner_session");
    localStorage.removeItem("taskora_owner_mode");
    sessionStorage.removeItem("taskora_persona_active");
    localStorage.removeItem("business_id");
    await supabase.auth.signOut();
    router.push("/login");
  }

  const navItems = [
    ...coreNavItems,
    ...(isPlatformAdmin
      ? [{ href: "/admin", label: "Admin", icon: "🛡️" }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full bg-midnight overflow-hidden">
      {/* Logo + collapse toggle */}
      <div className={`h-14 flex items-center border-b border-white/10 flex-shrink-0 px-3 ${expanded ? "justify-between" : "justify-center"}`}>
        {expanded && (
          <Link href="/daily-brief" className="text-white font-bold text-lg truncate mr-2">
            Taskora
          </Link>
        )}
        <button
          onClick={onToggle}
          className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? "" : "rotate-180"}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!expanded ? item.label : undefined}
              className={`flex items-center gap-3 my-0.5 mx-2 rounded-lg transition-colors ${
                expanded ? "px-3 py-2.5" : "py-2.5 justify-center"
              } ${active
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              <span className="text-[1.1rem] leading-none flex-shrink-0">{item.icon}</span>
              {expanded && (
                <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Trial indicator */}
      {trialDaysLeft !== null && (
        <div className={`mx-2 mb-1 rounded-lg px-3 py-2 text-xs ${
          trialDaysLeft <= 7 ? "bg-red-900/60 text-red-200" : "bg-white/10 text-white/70"
        }`}>
          {expanded ? (
            trialDaysLeft > 0
              ? <span><span className="font-bold text-white">{trialDaysLeft}d</span> left in free trial</span>
              : <span className="text-red-300 font-medium">Trial expired — upgrade to continue</span>
          ) : (
            <span className="font-bold text-center block" title={`${trialDaysLeft} days left in trial`}>
              {trialDaysLeft}d
            </span>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="border-t border-white/10 py-2 flex-shrink-0 space-y-0.5">
        {/* Identity row — workspace initials + user/workspace names. Anchors
            the sidebar to "what am I logged into right now." Becomes the
            structural seed for the multi-workspace switcher later. */}
        <div
          title={!expanded ? `${workspaceName || "Workspace"} · ${userName || ""}` : undefined}
          className={`flex items-center gap-2.5 mx-2 mb-1 rounded-lg ${
            expanded ? "px-2 py-2" : "py-2 justify-center"
          }`}
        >
          <div
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-taskora-red to-taskora-red/70 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm"
            aria-label={workspaceName ? `${workspaceName} workspace` : "Workspace"}
          >
            {workspaceInitials(workspaceName)}
          </div>
          {expanded && (
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold text-white truncate leading-tight"
                title={workspaceName || undefined}
              >
                {clampLabel(workspaceName || "Workspace")}
              </p>
              {userName && (
                <p
                  className="text-[11px] text-white/60 truncate leading-tight mt-0.5"
                  title={userName}
                >
                  {clampLabel(userName)}
                </p>
              )}
            </div>
          )}
        </div>

        <Link
          href="/workspace/settings"
          title={!expanded ? "Workspace" : undefined}
          className={`flex items-center gap-3 mx-2 rounded-lg py-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors ${
            expanded ? "px-3" : "justify-center"
          }`}
        >
          <svg className="w-[1.1rem] h-[1.1rem] flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          {expanded && <span className="text-sm font-medium">Workspace</span>}
        </Link>

        <button
          onClick={handleSignOut}
          title={!expanded ? "Sign out" : undefined}
          className={`flex items-center gap-3 mx-2 rounded-lg py-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors ${
            expanded ? "px-3 w-[calc(100%-1rem)]" : "justify-center w-[calc(100%-1rem)]"
          }`}
        >
          <svg className="w-[1.1rem] h-[1.1rem] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          {expanded && <span className="text-sm font-medium">Sign out</span>}
        </button>
      </div>
    </div>
  );
}

// ── App Layout ────────────────────────────────────────────────────────────────
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // null = checking, true = onboarded (render app), false = redirecting out
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // Gate child rendering until localStorage.business_id is reconciled.
  // React fires child useEffects bottom-up on mount, so without this gate
  // a multi-workspace user with empty localStorage (post-logout, fresh
  // signup, workspace deletion) hits /tasks/my and /daily-brief BEFORE
  // the sidebar's reconciliation populates business_id — backend then
  // either 400s (tasks, strict mode) or pools data across workspaces
  // (daily brief). Sidebar already calls /businesses/my for its own
  // workspace-name display; this just enforces ordering so children see
  // a populated pin before they fetch. Fast path: if localStorage
  // already has business_id, ready=true on first render and no extra
  // fetch happens.
  const [workspaceReady, setWorkspaceReady] = useState<boolean>(
    typeof window !== "undefined" && !!localStorage.getItem("business_id"),
  );

  // Force any user whose onboarding isn't complete back into the wizard.
  // No app page is usable half-set-up. Only block on a definitive signal
  // (explicit incomplete, or no business yet); let transient API errors
  // through so a backend blip can't trap everyone on /onboarding.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; // middleware handles unauthenticated users
        const storedBizId =
          typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
        const res = await fetch(
          `${API}/api/v1/onboarding/status${storedBizId ? `?business_id=${storedBizId}` : ""}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (cancelled) return;
        if (res.status === 404) {
          // No business yet. If they have a pending invite, send them to
          // accept it (join the existing workspace) instead of onboarding,
          // which would spawn a duplicate business.
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
        // Network/unknown error: don't trap the user — let them through.
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

  // Workspace reconciliation. Only runs when localStorage was empty at
  // mount (the empty-pin race case). Calls /businesses/my to populate
  // the pin so child pages can fetch with business_id from their first
  // useEffect.
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
        } catch {
          // Network blip — let children through; better usable page
          // than spin forever.
        }
      } catch {
        /* unknown error — fall through */
      } finally {
        if (!cancelled) setWorkspaceReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceReady]);

  useEffect(() => {
    if (mounted) localStorage.setItem(SIDEBAR_KEY, String(expanded));
  }, [expanded, mounted]);

  // Close mobile drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const sidebarW = mounted ? (expanded ? "14rem" : "3.5rem") : "14rem";

  // Don't render the app shell until we know onboarding is complete —
  // prevents a half-set-up flash before the redirect to /onboarding.
  // Also wait for workspace reconciliation so child pages don't fetch
  // business-scoped data before localStorage.business_id is populated.
  if (onboarded !== true || !workspaceReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist">
        <div className="w-7 h-7 border-2 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
    <div className="flex min-h-screen bg-mist">
      {/* ── Desktop sidebar (sticky in flex) ─────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col sticky top-0 self-start h-screen z-50 border-r border-white/10 overflow-hidden flex-shrink-0"
        style={{ width: sidebarW, transition: "width 0.2s ease" }}
      >
        <SidebarContent
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
        />
      </aside>

      {/* ── Mobile top bar ────────────────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-midnight border-b border-white/10 z-50 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(v => !v)}
          className="w-9 h-9 flex flex-col items-center justify-center gap-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          aria-label="Toggle menu"
        >
          <span className={`block w-5 h-0.5 bg-current transition-transform origin-center ${mobileOpen ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`block w-5 h-0.5 bg-current transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
          <span className={`block w-5 h-0.5 bg-current transition-transform origin-center ${mobileOpen ? "-translate-y-2 -rotate-45" : ""}`} />
        </button>
        <Link href="/daily-brief" className="text-white font-bold text-lg">Taskora</Link>
      </header>

      {/* ── Mobile backdrop ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-64 z-50 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent
          expanded={true}
          onToggle={() => setMobileOpen(false)}
        />
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="min-h-screen pt-14 md:pt-0 flex-1 min-w-0">
        {children}
      </main>

    </div>
    <PersonaSwitcher />
    </>
  );
}
