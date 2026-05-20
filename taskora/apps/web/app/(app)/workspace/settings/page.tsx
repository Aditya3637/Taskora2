"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SettingsTabs from "@/components/SettingsTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const token = session.access_token;
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: any) => d.detail ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

type Member = {
  user_id: string;
  name: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  can_view_people_board?: boolean;
};

type Invite = {
  id: string;
  invited_email: string;
  role: string;
  status: string;
  inviter_email?: string;
  created_at: string;
  token: string;
};

type JoinRequest = {
  id: string;
  requester_name: string | null;
  requester_email: string | null;
  created_at: string;
};

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-purple-100 text-purple-700 border-purple-200",
  admin: "bg-blue-100 text-blue-700 border-blue-200",
  member: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState("");
  const [myRole, setMyRole] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const loadData = useCallback(async (bId: string) => {
    try {
      const [membersData, roleData, invitesData, joinData] = await Promise.all([
        apiFetch(`/api/v1/businesses/${bId}/members`),
        apiFetch(`/api/v1/businesses/${bId}/my-role`),
        apiFetch(`/api/v1/invites?business_id=${bId}`),
        apiFetch(`/api/v1/join/requests?business_id=${bId}`).catch(() => []),
      ]);
      setMembers(Array.isArray(membersData) ? membersData : []);
      setMyRole(roleData?.role ?? "member");
      setInvites(
        (Array.isArray(invitesData) ? invitesData : []).filter(
          (i: Invite) => i.status === "pending"
        )
      );
      setJoinRequests(Array.isArray(joinData) ? joinData : []);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const biz = await apiFetch("/api/v1/businesses/my");
        const bId = biz?.id;
        if (!bId) throw new Error("No workspace found");
        setBusinessId(bId);

        // Check role first — redirect non-admins
        const roleData = await apiFetch(`/api/v1/businesses/${bId}/my-role`);
        const role = roleData?.role ?? "member";
        if (role === "member") {
          router.replace("/daily-brief");
          return;
        }
        setMyRole(role);
        await loadData(bId);
      } catch (e: any) {
        if (e.message.includes("403") || e.message.includes("Admin")) {
          router.replace("/daily-brief");
        } else {
          setError(e.message);
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, loadData]);

  async function handleRoleChange(targetUserId: string, newRole: "member" | "admin") {
    try {
      await apiFetch(`/api/v1/businesses/${businessId}/members/${targetUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      setMembers((prev) =>
        prev.map((m) => (m.user_id === targetUserId ? { ...m, role: newRole } : m))
      );
      showToast("Role updated");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  async function handlePeopleBoardToggle(targetUserId: string, next: boolean) {
    try {
      await apiFetch(
        `/api/v1/businesses/${businessId}/members/${targetUserId}/permissions`,
        { method: "PATCH", body: JSON.stringify({ can_view_people_board: next }) }
      );
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === targetUserId ? { ...m, can_view_people_board: next } : m
        )
      );
      showToast(next ? "People board access granted" : "Access revoked");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  async function handleRemoveMember(targetUserId: string, name: string) {
    const who = name || "this member";
    if (
      !confirm(
        `Remove ${who} from the workspace?\n\n` +
          `Their tasks stay — anything where they were the primary will be ` +
          `reassigned to you. Their secondary assignments and follower/approver ` +
          `entries are removed.`,
      )
    )
      return;
    try {
      await apiFetch(`/api/v1/businesses/${businessId}/members/${targetUserId}`, {
        method: "DELETE",
      });
      setMembers((prev) => prev.filter((m) => m.user_id !== targetUserId));
      showToast("Member removed — their tasks were reassigned to you");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  async function handleCopyInviteLink(token: string, email: string) {
    if (!token) {
      showToast("This invite has no token — try revoking and re-inviting.");
      return;
    }
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Invite link for ${email} copied to clipboard`);
    } catch {
      // Clipboard API blocked (insecure context / permission denied) —
      // fall back to a prompt so the user can still copy it manually.
      window.prompt("Copy this invite link:", url);
    }
  }

  async function handleRevokeInvite(inviteId: string, email: string) {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    try {
      await apiFetch(`/api/v1/invites/revoke/${inviteId}`, { method: "DELETE" });
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      showToast("Invite revoked");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  async function handleJoinDecision(id: string, approve: boolean) {
    try {
      await apiFetch(`/api/v1/join/requests/${id}/${approve ? "approve" : "decline"}`, {
        method: "POST",
      });
      setJoinRequests((prev) => prev.filter((r) => r.id !== id));
      showToast(approve ? "Request approved — member added" : "Request declined");
      if (approve && businessId) loadData(businessId);
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  const canManage = (targetRole: string) => {
    if (myRole === "owner") return targetRole !== "owner";
    if (myRole === "admin") return targetRole === "member";
    return false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-taskora-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-midnight text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-midnight">Workspace Settings</h1>
        <p className="text-sm text-steel mt-1">
          Manage team members, roles, and pending invitations.
        </p>
      </div>
      <SettingsTabs />

      {/* Members */}
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <h2 className="font-semibold text-midnight">
            Team Members{" "}
            <span className="text-steel font-normal text-sm ml-1">({members.length})</span>
          </h2>
          <p className="text-xs text-steel mt-1">People who have joined the workspace.</p>
        </div>

        <div className="divide-y divide-pebble/50">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-4 px-6 py-4">
              {/* Avatar initials */}
              <div className="w-9 h-9 rounded-full bg-mist flex items-center justify-center text-sm font-semibold text-midnight flex-shrink-0">
                {(m.name || "?")[0].toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-midnight text-sm truncate">
                  {m.name || "Unnamed"}
                </p>
                <p className="text-xs text-steel mt-0.5">
                  Joined {new Date(m.joined_at).toLocaleDateString()}
                </p>
              </div>

              {/* Role badge / selector */}
              {canManage(m.role) ? (
                <select
                  value={m.role}
                  onChange={(e) =>
                    handleRoleChange(m.user_id, e.target.value as "member" | "admin")
                  }
                  className="text-xs border border-pebble rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-ocean bg-white"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium border ${ROLE_BADGE[m.role] ?? ROLE_BADGE.member}`}
                >
                  {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                </span>
              )}

              {/* People board access */}
              {m.role === "member" ? (
                <button
                  onClick={() =>
                    handlePeopleBoardToggle(
                      m.user_id,
                      !m.can_view_people_board
                    )
                  }
                  title="Access to the People management board"
                  className={`text-[11px] px-2.5 py-1 rounded-full font-medium border transition-colors flex-shrink-0 ${
                    m.can_view_people_board
                      ? "bg-purple-50 text-purple-700 border-purple-200"
                      : "bg-mist text-steel border-pebble hover:border-steel"
                  }`}
                >
                  People board {m.can_view_people_board ? "on" : "off"}
                </button>
              ) : (
                <span
                  className="text-[11px] text-steel/60 flex-shrink-0"
                  title="Owners and admins always have access"
                >
                  People board: always
                </span>
              )}

              {/* Remove button */}
              {canManage(m.role) && (
                <button
                  onClick={() => handleRemoveMember(m.user_id, m.name)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium ml-1 flex-shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-pebble">
            <h2 className="font-semibold text-midnight">
              Pending Invitations{" "}
              <span className="text-steel font-normal text-sm ml-1">({invites.length})</span>
            </h2>
            <p className="text-xs text-steel mt-1">
              People you&apos;ve invited who haven&apos;t joined yet.
            </p>
          </div>

          <div className="px-6 py-3 bg-amber-50/60 border-b border-amber-200/60 text-xs text-amber-800">
            <span className="font-medium">Heads up:</span> invite emails aren&apos;t
            always delivered. Use <span className="font-medium">Copy link</span>{" "}
            and share it with them directly (WhatsApp, Slack, email) to be safe.
          </div>

          <div className="divide-y divide-pebble/50">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-midnight text-sm truncate">
                    {inv.invited_email}
                  </p>
                  <p className="text-xs text-steel mt-0.5">
                    Invited as{" "}
                    <span className="font-medium capitalize">{inv.role}</span>
                    {inv.inviter_email && ` by ${inv.inviter_email}`}
                  </p>
                </div>

                <span className="text-xs px-2.5 py-1 rounded-full font-medium border bg-amber-50 text-amber-700 border-amber-200">
                  Pending
                </span>

                <button
                  onClick={() => handleCopyInviteLink(inv.token, inv.invited_email)}
                  className="text-xs text-ocean hover:text-ocean/80 font-medium ml-1 flex-shrink-0"
                >
                  Copy link
                </button>

                <button
                  onClick={() => handleRevokeInvite(inv.id, inv.invited_email)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium ml-1 flex-shrink-0"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {invites.length === 0 && (
        <p className="text-sm text-steel/60 text-center py-2">No pending invitations.</p>
      )}

      {/* Join Requests (Entry 2: same-domain signups asking to join) */}
      {joinRequests.length > 0 && (
        <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-pebble">
            <h2 className="font-semibold text-midnight">
              Join Requests{" "}
              <span className="text-steel font-normal text-sm ml-1">({joinRequests.length})</span>
            </h2>
            <p className="text-xs text-steel mt-0.5">
              People who signed up with your company email domain and asked to join.
            </p>
          </div>

          <div className="divide-y divide-pebble/50">
            {joinRequests.map((r) => (
              <div key={r.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-midnight text-sm truncate">
                    {r.requester_name || r.requester_email || "Unknown user"}
                  </p>
                  {r.requester_email && (
                    <p className="text-xs text-steel mt-0.5 truncate">{r.requester_email}</p>
                  )}
                </div>
                <button
                  onClick={() => handleJoinDecision(r.id, false)}
                  className="text-xs px-3 py-1.5 border border-pebble text-steel rounded-lg hover:bg-mist font-medium flex-shrink-0"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleJoinDecision(r.id, true)}
                  className="text-xs px-3 py-1.5 bg-taskora-red text-white rounded-lg hover:opacity-90 font-semibold flex-shrink-0"
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
