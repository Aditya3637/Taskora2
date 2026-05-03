"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

const coreNavItems = [
  { href: "/daily-brief",  label: "Daily Brief",  icon: "☀️" },
  { href: "/war-room",     label: "War Room",     icon: "⚡" },
  { href: "/initiatives",  label: "Initiatives",  icon: "🏗️" },
  { href: "/tasks",        label: "My Tasks",     icon: "✅" },
  { href: "/programs",     label: "Programs",     icon: "🗂️" },
  { href: "/gantt",        label: "Gantt",        icon: "📊" },
  { href: "/reports",      label: "Reports",      icon: "📄" },
  { href: "/templates",    label: "Templates",    icon: "📋" },
  { href: "/analytics",   label: "Analytics",    icon: "📈" },
];

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
    } catch (err) {
      setError("Failed to create invite. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-midnight">Invite Team Member</h2>
          <button onClick={onClose} className="text-steel hover:text-midnight text-xl leading-none">&times;</button>
        </div>
        {!inviteLink ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean"
              />
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
                className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel hover:bg-mist">
                Cancel
              </button>
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
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="text-xs px-3 py-1.5 bg-white border border-pebble rounded-lg text-steel hover:text-midnight flex-shrink-0">
                Copy
              </button>
            </div>
            <button onClick={onClose}
              className="w-full h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.is_admin) setIsAdmin(true);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const navItems = isAdmin
    ? [...coreNavItems, { href: "/admin", label: "Admin", icon: "🛡️" }]
    : coreNavItems;

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 h-14 bg-midnight border-b border-white/10 z-50 flex items-center px-4 gap-1">
        <Link href="/daily-brief" className="text-white font-bold text-lg mr-4 flex-shrink-0">Taskora</Link>
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${active ? "bg-white/15 text-white" : "text-white/60 hover:text-white hover:bg-white/10"}`}>
                <span className="text-base leading-none">{item.icon}</span>
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          <button
            onClick={() => setShowInvite(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition-colors">
            <span>👥</span>
            <span>Invite Team</span>
          </button>
          <Link href="/settings" className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors" title="Settings">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
            </svg>
          </Link>
          <button onClick={handleSignOut} className="text-white/60 hover:text-white text-xs font-medium px-3 py-1.5 hover:bg-white/10 rounded-lg transition-colors">Sign out</button>
        </div>
      </nav>
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <AppNav />
      <div className="pt-14">{children}</div>
    </div>
  );
}
