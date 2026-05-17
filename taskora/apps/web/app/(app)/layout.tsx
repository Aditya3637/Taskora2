"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import PersonaSwitcher from "@/components/testing/PersonaSwitcher";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

const coreNavItems = [
  { href: "/daily-brief", label: "Daily Brief", icon: "☀️" },
  { href: "/people",      label: "People",      icon: "👥" },
  { href: "/programs",    label: "Programs",    icon: "🗂️" },
  { href: "/tasks",       label: "Tasks",       icon: "✅" },
  { href: "/gantt",       label: "Gantt",       icon: "📊" },
  { href: "/analytics",   label: "Analytics",   icon: "📈" },
];

const SIDEBAR_KEY = "taskora_sidebar_expanded";

// ── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true); setError(""); setInviteLink("");
    try {
      const businessId = typeof window !== "undefined"
        ? localStorage.getItem("business_id") ?? ""
        : "";
      const result = await apiFetch("/api/v1/invites/", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role, business_id: businessId }),
      });
      setInviteLink(result?.invite_link ?? result?.link ?? "");
    } catch {
      setError("Failed to create invite. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-midnight">Invite Team Member</h2>
          <button onClick={onClose} className="text-steel hover:text-midnight text-xl leading-none">&times;</button>
        </div>
        {!inviteLink ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="colleague@company.com" required
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean" />
            </div>
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel hover:bg-mist">Cancel</button>
              <button type="submit" disabled={loading}
                className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
                {loading ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-steel">Invite created! Share this link with your teammate:</p>
            <div className="flex items-center gap-2 bg-mist rounded-lg p-3 border border-pebble">
              <span className="text-xs font-mono text-midnight flex-1 break-all">{inviteLink}</span>
              <button onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="text-xs px-3 py-1.5 bg-white border border-pebble rounded-lg text-steel hover:text-midnight flex-shrink-0">Copy</button>
            </div>
            <button onClick={onClose}
              className="w-full h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar inner content (shared between desktop & mobile drawer) ─────────────
function SidebarContent({
  expanded,
  onToggle,
  onInvite,
}: {
  expanded: boolean;
  onToggle: () => void;
  onInvite: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isWorkspaceAdmin, setIsWorkspaceAdmin] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    async function loadRoles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.is_admin) setIsPlatformAdmin(true);

      // Ensure business_id is in localStorage — auto-resolve if missing
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        let businessId =
          typeof window !== "undefined"
            ? localStorage.getItem("business_id") ?? ""
            : "";

        if (!businessId) {
          const res = await fetch(`${API}/api/v1/businesses/my`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const biz = await res.json();
            businessId = biz?.id ?? "";
            if (businessId) localStorage.setItem("business_id", businessId);
          }
        }

        if (businessId) {
          const [roleRes, subRes] = await Promise.all([
            fetch(`${API}/api/v1/businesses/${businessId}/my-role`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
            fetch(`${API}/api/v1/billing/status/${businessId}`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
          ]);

          if (roleRes.ok) {
            const data = await roleRes.json();
            if (data.role === "owner" || data.role === "admin") setIsWorkspaceAdmin(true);
          }

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
    await supabase.auth.signOut();
    router.push("/login");
  }

  const navItems = [
    ...coreNavItems,
    ...(isWorkspaceAdmin
      ? [{ href: "/workspace/settings", label: "Workspace", icon: "⚙️" }]
      : []),
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
        <button
          onClick={onInvite}
          title={!expanded ? "Invite Team" : undefined}
          className={`flex items-center gap-3 mx-2 rounded-lg py-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors ${
            expanded ? "px-3 w-[calc(100%-1rem)]" : "justify-center w-[calc(100%-1rem)]"
          }`}
        >
          <span className="text-[1.1rem] leading-none flex-shrink-0">👥</span>
          {expanded && <span className="text-sm font-medium">Invite Team</span>}
        </button>

        <Link
          href="/workspace/settings"
          title={!expanded ? "Settings" : undefined}
          className={`flex items-center gap-3 mx-2 rounded-lg py-2.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors ${
            expanded ? "px-3" : "justify-center"
          }`}
        >
          <svg className="w-[1.1rem] h-[1.1rem] flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          {expanded && <span className="text-sm font-medium">Settings</span>}
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
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored !== null) setExpanded(stored === "true");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem(SIDEBAR_KEY, String(expanded));
  }, [expanded, mounted]);

  // Close mobile drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const sidebarW = mounted ? (expanded ? "14rem" : "3.5rem") : "14rem";

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
          onInvite={() => setShowInvite(true)}
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
          onInvite={() => { setShowInvite(true); setMobileOpen(false); }}
        />
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="min-h-screen pt-14 md:pt-0 flex-1 min-w-0">
        {children}
      </main>

    </div>
    <PersonaSwitcher />
    {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </>
  );
}
