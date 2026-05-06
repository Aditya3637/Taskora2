"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const OWNER_EMAIL = "engineeradityasingh@gmail.com";
const PERSONA_PASSWORD = "Taskora@2025!";
const STORAGE_KEY = "taskora_owner_session";
const FLAG_KEY = "taskora_owner_mode";

type Persona = {
  name: string;
  email: string;
  bizRole: "owner" | "member" | "—";
  taskRole?: string;
  flags?: string[];
  permissions: string[];
};

type Group = { label: string; personas: Persona[] };

const GROUPS: Record<string, Group> = {
  customer: {
    label: "Customer Side",
    personas: [
      {
        name: "First-Time Buyer",
        email: "customer.firsttime@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives", "Receive decisions"],
      },
      {
        name: "Property Investor",
        email: "customer.investor@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives", "Receive decisions"],
      },
      {
        name: "NRI Buyer",
        email: "customer.nri@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives", "Receive decisions"],
      },
      {
        name: "Premium Buyer",
        email: "customer.premium@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives", "Receive decisions"],
      },
      {
        name: "Budget Buyer",
        email: "customer.budget@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives", "Receive decisions"],
      },
    ],
  },
  internal_roles: {
    label: "Internal Roles",
    personas: [
      {
        name: "Sales Rep",
        email: "persona.sales@taskora.test",
        bizRole: "member",
        permissions: ["Create tasks", "Update own tasks", "View initiatives", "Comment", "View programs"],
      },
      {
        name: "Team Manager",
        email: "persona.manager@taskora.test",
        bizRole: "owner",
        permissions: ["Full CRUD on initiatives & tasks", "Manage members", "Delete entities", "View analytics", "Create templates"],
      },
      {
        name: "Read-Only User",
        email: "persona.viewer@taskora.test",
        bizRole: "member",
        permissions: ["View tasks", "View initiatives", "View programs", "No write access"],
      },
      {
        name: "Client Contact",
        email: "persona.client@taskora.test",
        bizRole: "member",
        permissions: ["View assigned tasks", "Comment on tasks", "View initiatives"],
      },
      {
        name: "Workspace Admin",
        email: "role.workspace_admin@taskora.test",
        bizRole: "owner",
        permissions: ["Full CRUD on all resources", "Manage members", "Manage invites", "Delete business entities"],
      },
      {
        name: "Primary Stakeholder",
        email: "role.primary@taskora.test",
        bizRole: "member",
        taskRole: "primary",
        permissions: ["Approve / Reject decisions", "Delegate tasks", "Escalate tasks", "Snooze tasks", "Request info"],
      },
      {
        name: "Secondary Stakeholder",
        email: "role.secondary@taskora.test",
        bizRole: "member",
        taskRole: "secondary",
        permissions: ["View task decisions", "Comment on tasks", "Support primary stakeholder"],
      },
      {
        name: "Task Follower",
        email: "role.follower@taskora.test",
        bizRole: "member",
        taskRole: "follower",
        permissions: ["View tasks (read-only)", "View comments", "No decision actions"],
      },
    ],
  },
  taskora_internal: {
    label: "Taskora Internal",
    personas: [
      {
        name: "Platform Admin",
        email: "role.platform_admin@taskora.test",
        bizRole: "member",
        flags: ["is_admin: true"],
        permissions: ["Access /admin routes", "View revenue metrics", "View funnel analytics", "View engagement metrics", "View all customers", "Access sales leads", "Access sales pipeline"],
      },
      {
        name: "Owner (You)",
        email: OWNER_EMAIL,
        bizRole: "owner",
        flags: ["is_admin: true", "persona_switching: true", "can_access_sales_leads: true", "can_access_sales_pipeline: true"],
        permissions: ["All platform permissions", "All admin routes", "Sales leads & pipeline", "Persona switching", "Full business ownership"],
      },
    ],
  },
};

export default function PersonaSwitcher() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedType, setSelectedType] = useState("customer");
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [activePersona, setActivePersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Determine if we should show the panel
  useEffect(() => {
    async function check() {
      const ownerMode = localStorage.getItem(FLAG_KEY);
      if (ownerMode === "true") { setVisible(true); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email === OWNER_EMAIL) {
        localStorage.setItem(FLAG_KEY, "true");
        // Save owner session for later restoration
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }));
        }
        setVisible(true);
      }
    }
    check();
  }, []);

  // Sync selectedPersona when type changes
  useEffect(() => {
    setSelectedPersona(null);
  }, [selectedType]);

  const personas = GROUPS[selectedType]?.personas ?? [];

  async function handleSwitch() {
    if (!selectedPersona) return;
    if (selectedPersona.email === OWNER_EMAIL) { handleReset(); return; }
    setLoading(true); setError("");
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: selectedPersona.email,
        password: PERSONA_PASSWORD,
      });
      if (signInErr) throw signInErr;
      setActivePersona(selectedPersona);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? "Failed to switch persona");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    setLoading(true); setError("");
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { access_token, refresh_token } = JSON.parse(stored);
        const { error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
        if (sessErr) throw sessErr;
      } else {
        // Fallback: sign in fresh as owner
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: OWNER_EMAIL,
          password: PERSONA_PASSWORD,
        });
        if (signInErr) throw signInErr;
      }
      setActivePersona(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? "Failed to restore owner session");
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  const isActingAsPersona = activePersona !== null;
  const displayPersona = selectedPersona ?? activePersona;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col items-end gap-2 select-none">
      {/* Expanded panel */}
      {expanded && (
        <div className="w-80 bg-midnight text-white rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">🧪 Persona Testing</span>
              {isActingAsPersona && (
                <span className="text-[10px] px-2 py-0.5 bg-yellow-400/20 text-yellow-300 rounded-full font-medium">
                  ACTING AS
                </span>
              )}
            </div>
            <button onClick={() => setExpanded(false)} className="text-white/40 hover:text-white text-lg leading-none">&times;</button>
          </div>

          {/* Active persona banner */}
          {isActingAsPersona && (
            <div className="px-4 py-2 bg-yellow-400/10 border-b border-yellow-400/20 flex items-center justify-between">
              <div>
                <p className="text-xs text-yellow-300 font-medium">{activePersona!.name}</p>
                <p className="text-[10px] text-yellow-300/60">{activePersona!.email}</p>
              </div>
              <button
                onClick={handleReset}
                disabled={loading}
                className="text-[10px] px-2.5 py-1 bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-300 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Reset to Owner
              </button>
            </div>
          )}

          <div className="p-4 space-y-3">
            {/* Type selector */}
            <div>
              <label className="text-[10px] text-white/40 font-medium uppercase tracking-wider block mb-1.5">Type</label>
              <div className="flex gap-1.5">
                {Object.entries(GROUPS).map(([key, group]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedType(key)}
                    className={`flex-1 text-[10px] py-1.5 rounded-lg font-medium transition-colors ${
                      selectedType === key
                        ? "bg-white/15 text-white"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Persona selector */}
            <div>
              <label className="text-[10px] text-white/40 font-medium uppercase tracking-wider block mb-1.5">Persona</label>
              <select
                value={selectedPersona?.email ?? ""}
                onChange={e => {
                  const p = personas.find(p => p.email === e.target.value) ?? null;
                  setSelectedPersona(p);
                }}
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-white/30 appearance-none"
              >
                <option value="">— Select persona —</option>
                {personas.map(p => (
                  <option key={p.email} value={p.email}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Permissions preview */}
            {displayPersona && (
              <div className="bg-white/5 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white">{displayPersona.name}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    displayPersona.bizRole === "owner"
                      ? "bg-ocean/40 text-blue-300"
                      : "bg-white/10 text-white/60"
                  }`}>
                    {displayPersona.bizRole}
                  </span>
                </div>
                {displayPersona.taskRole && (
                  <p className="text-[10px] text-white/50">Task role: <span className="text-white/70">{displayPersona.taskRole}</span></p>
                )}
                {displayPersona.flags?.map(f => (
                  <span key={f} className="inline-block text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full mr-1">{f}</span>
                ))}
                <div className="pt-1 border-t border-white/10">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Permissions</p>
                  <ul className="space-y-0.5">
                    {displayPersona.permissions.map(perm => (
                      <li key={perm} className="flex items-start gap-1.5 text-[11px] text-white/70">
                        <span className="text-green-400 mt-0.5 flex-shrink-0">✓</span>
                        {perm}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {error && <p className="text-red-400 text-xs">{error}</p>}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              {isActingAsPersona && (
                <button
                  onClick={handleReset}
                  disabled={loading}
                  className="flex-1 h-9 bg-white/10 hover:bg-white/15 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  ↩ Owner
                </button>
              )}
              <button
                onClick={handleSwitch}
                disabled={loading || !selectedPersona}
                className="flex-1 h-9 bg-taskora-red hover:opacity-90 text-white text-xs font-semibold rounded-lg transition-opacity disabled:opacity-40"
              >
                {loading ? "Switching…" : selectedPersona?.email === OWNER_EMAIL ? "Reset to Owner" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle pill */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg text-xs font-semibold transition-all ${
          isActingAsPersona
            ? "bg-yellow-400 text-midnight"
            : "bg-midnight text-white border border-white/20 hover:border-white/40"
        }`}
      >
        <span>🧪</span>
        {isActingAsPersona
          ? `Testing: ${activePersona!.name}`
          : "Persona Switcher"}
        <span className={`transition-transform ${expanded ? "rotate-180" : ""}`}>▲</span>
      </button>
    </div>
  );
}
