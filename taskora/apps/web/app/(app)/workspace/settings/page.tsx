"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import SettingsTabs from "@/components/SettingsTabs";
import { Dialog } from "@/components/ui";

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
  email?: string | null;
  role: "owner" | "admin" | "member";
  joined_at: string;
  can_view_people_board?: boolean;
  onboarded_at?: string | null;
  last_sign_in_at?: string | null;
};

// Consumer email providers — when the workspace owner's email is on one of
// these, we treat the workspace as "personal" and skip the external-domain
// warning on invites. Otherwise the warning would fire on every invite from
// a Gmail-owned workspace.
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "msn.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "rediffmail.com",
]);

function emailDomain(email: string): string {
  const at = email.toLowerCase().lastIndexOf("@");
  return at === -1 ? "" : email.toLowerCase().slice(at + 1);
}

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

function isMemberOnboarded(m: Member): boolean {
  // Owners are always onboarded. For everyone else, BOTH signals must be true:
  // (1) they have logged in at least once, AND (2) an admin has marked them.
  if (m.role === "owner") return true;
  return Boolean(m.last_sign_in_at) && Boolean(m.onboarded_at);
}

type Assignee = { id: string; name: string };

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<"personal" | "organisation" | null>(null);
  const [workspaceDomain, setWorkspaceDomain] = useState<string>("");
  const [myRole, setMyRole] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  // Invite form (Team tab)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteSending, setInviteSending] = useState(false);

  // Assignees (only for personal-mode workspaces; named, no-login people)
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeInput, setAssigneeInput] = useState("");
  const [assigneeSaving, setAssigneeSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // Remove-member dialog (G2): pick who inherits the leaver's work instead of
  // silently dumping it all on the admin who clicked Remove.
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);
  const [removeSummary, setRemoveSummary] = useState<{ initiatives_owned: number; tasks_primary: number; as_secondary_or_watcher: number } | null>(null);
  const [reassignTo, setReassignTo] = useState<string>(""); // "" = reassign to me
  const [removing, setRemoving] = useState(false);

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

  const loadAssignees = useCallback(async (bId: string) => {
    try {
      const data = await apiFetch(`/api/v1/onboarding/assignees?business_id=${bId}`);
      setAssignees(Array.isArray(data) ? data : []);
    } catch {
      /* personal-mode assignees are optional — surface nothing on failure */
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
        setWorkspaceMode(biz?.workspace_mode ?? null);
        setWorkspaceDomain((biz?.domain ?? "").toLowerCase());

        // Members see the page in read-only mode (can still invite teammates);
        // admins/owners get the full management controls. Gating happens in
        // the JSX via `isAdmin` below, not here.
        const roleData = await apiFetch(`/api/v1/businesses/${bId}/my-role`);
        setMyRole(roleData?.role ?? "member");
        await loadData(bId);
        if (biz?.workspace_mode === "personal") {
          await loadAssignees(bId);
        }
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
  }, [router, loadData, loadAssignees]);

  async function handleAddAssignee() {
    const name = assigneeInput.trim();
    if (!name || !businessId) return;
    setAssigneeSaving(true);
    try {
      const created = await apiFetch("/api/v1/onboarding/assignees", {
        method: "POST",
        body: JSON.stringify({ name, business_id: businessId }),
      });
      setAssignees((prev) => [...prev, created]);
      setAssigneeInput("");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setAssigneeSaving(false);
    }
  }

  async function handleRemoveAssignee(id: string) {
    const prev = assignees;
    setAssignees((p) => p.filter((a) => a.id !== id));
    try {
      await apiFetch(`/api/v1/onboarding/assignees/${id}`, { method: "DELETE" });
    } catch (e: any) {
      // Roll back optimistic update
      setAssignees(prev);
      showToast(`Error: ${e.message}`);
    }
  }

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

  async function handleMarkOnboarded(targetUserId: string, next: boolean) {
    try {
      await apiFetch(
        `/api/v1/businesses/${businessId}/members/${targetUserId}/onboarded`,
        { method: "PATCH", body: JSON.stringify({ onboarded: next }) }
      );
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === targetUserId
            ? { ...m, onboarded_at: next ? new Date().toISOString() : null }
            : m
        )
      );
      showToast(next ? "Marked onboarded" : "Onboarding flag cleared");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    // External-domain guard: if the workspace has a real org domain (derived
    // from owner email, ignoring consumer providers) and the invitee is on
    // a different domain, prompt the inviter to confirm.
    if (referenceDomain) {
      const d = emailDomain(email);
      if (d && d !== referenceDomain) {
        const ok = confirm(
          `${email} is outside your organisation (@${referenceDomain}).\n\n` +
            `External users will get full workspace access for the role you ` +
            `picked. Are you sure you want to invite them?`,
        );
        if (!ok) return;
      }
    }
    setInviteSending(true);
    try {
      await apiFetch("/api/v1/invites/", {
        method: "POST",
        body: JSON.stringify({
          invited_email: email,
          role: inviteRole,
          business_id: businessId,
        }),
      });
      setInviteEmail("");
      showToast(`Invite sent to ${email}`);
      // Reload invites list (handler scope can't read loadData var directly,
      // but it's defined above this — call it).
      if (businessId) loadData(businessId);
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setInviteSending(false);
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
    // Open the reassignment dialog and load what this member owns so the admin
    // can choose who inherits it (default = me).
    setRemoveTarget({ userId: targetUserId, name: name || "this member" });
    setReassignTo("");
    setRemoveSummary(null);
    try {
      const s = await apiFetch(`/api/v1/businesses/${businessId}/members/${targetUserId}/work-summary`);
      setRemoveSummary(s);
    } catch { /* dialog still works; counts just won't show */ }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const q = reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : "";
      await apiFetch(`/api/v1/businesses/${businessId}/members/${removeTarget.userId}${q}`, {
        method: "DELETE",
      });
      setMembers((prev) => prev.filter((m) => m.user_id !== removeTarget.userId));
      const heir = reassignTo
        ? members.find((m) => m.user_id === reassignTo)?.name || "the chosen member"
        : "you";
      showToast(`Member removed — their work was reassigned to ${heir}`);
      setRemoveTarget(null);
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setRemoving(false);
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

  // Bucketed, sorted member list.
  // Visible-by-default: owner + members who still need onboarding.
  // Behind the "Show all" toggle: everyone else, newest joiners first.
  const { ownerMembers, needsOnboardingMembers, onboardedMembers } = useMemo(() => {
    const byJoinedDesc = (a: Member, b: Member) =>
      new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
    const owners = members.filter((m) => m.role === "owner");
    const needs = members
      .filter((m) => m.role !== "owner" && !isMemberOnboarded(m))
      .sort(byJoinedDesc);
    const done = members
      .filter((m) => m.role !== "owner" && isMemberOnboarded(m))
      .sort(byJoinedDesc);
    return {
      ownerMembers: owners,
      needsOnboardingMembers: needs,
      onboardedMembers: done,
    };
  }, [members]);

  // When the user is searching, ignore the collapse and match across all
  // members on name or email (case-insensitive). When not searching, fall
  // back to the bucketed view: owner + needs-onboarding always visible,
  // onboarded behind the "Show all" toggle.
  const searchActive = memberSearch.trim().length > 0;
  const visibleMembers = useMemo(() => {
    if (searchActive) {
      const q = memberSearch.trim().toLowerCase();
      const all = [...ownerMembers, ...needsOnboardingMembers, ...onboardedMembers];
      return all.filter((m) => {
        const name = (m.name || "").toLowerCase();
        const email = (m.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    return showAllMembers
      ? [...ownerMembers, ...needsOnboardingMembers, ...onboardedMembers]
      : [...ownerMembers, ...needsOnboardingMembers];
  }, [
    searchActive,
    memberSearch,
    showAllMembers,
    ownerMembers,
    needsOnboardingMembers,
    onboardedMembers,
  ]);

  // Reference domain for the external-invite check.
  // Priority: an explicit business.domain (set on the Profile page) wins.
  // Fallback: derive from the owner's email domain, ignoring consumer
  // providers (gmail etc.) so personal workspaces don't get spurious warnings.
  const referenceDomain = useMemo(() => {
    if (workspaceDomain) return workspaceDomain;
    const owner = ownerMembers[0];
    if (!owner?.email) return "";
    const d = emailDomain(owner.email);
    if (!d || CONSUMER_EMAIL_DOMAINS.has(d)) return "";
    return d;
  }, [workspaceDomain, ownerMembers]);

  function renderMemberRow(m: Member) {
    const needsOnboarding = m.role !== "owner" && !isMemberOnboarded(m);
    const neverLoggedIn = m.role !== "owner" && !m.last_sign_in_at;
    const joinedShort = new Date(m.joined_at).toLocaleDateString();
    return (
      <div
        key={m.user_id}
        className={`flex items-center gap-3 px-6 py-2 ${
          needsOnboarding ? "bg-amber-50/40" : ""
        }`}
      >
        {/* Avatar initials */}
        <div className="w-8 h-8 rounded-full bg-mist flex items-center justify-center text-xs font-semibold text-midnight flex-shrink-0">
          {(m.name || "?")[0].toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-midnight text-sm truncate leading-tight">
              {m.name || "Unnamed"}
            </p>
            {needsOnboarding && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 border border-amber-200 flex-shrink-0"
                title={
                  neverLoggedIn
                    ? "Hasn't logged in yet"
                    : "Logged in but not marked onboarded"
                }
              >
                {neverLoggedIn ? "Not yet active" : "Needs onboarding"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-steel/70 truncate leading-tight mt-0.5">
            {m.email ? `${m.email} · ` : ""}Joined {joinedShort}
          </p>
        </div>

        {/* Role badge / selector */}
        {canManage(m.role) ? (
          <select
            value={m.role}
            onChange={(e) =>
              handleRoleChange(m.user_id, e.target.value as "member" | "admin")
            }
            className="text-xs border border-pebble rounded-lg px-2 py-1 focus:outline-none focus:border-ocean bg-white"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
              ROLE_BADGE[m.role] ?? ROLE_BADGE.member
            }`}
          >
            {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
          </span>
        )}

        {/* Mark onboarded — only when this member still needs it */}
        {needsOnboarding && canManage(m.role) && (
          <button
            onClick={() => handleMarkOnboarded(m.user_id, true)}
            title={
              neverLoggedIn
                ? "Member must log in before you can mark them onboarded"
                : "Mark this member as onboarded"
            }
            disabled={neverLoggedIn}
            className="text-[11px] px-2 py-0.5 rounded-full font-medium border transition-colors flex-shrink-0 bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Mark onboarded
          </button>
        )}

        {/* People board access */}
        {m.role === "member" ? (
          isAdmin ? (
            <button
              onClick={() =>
                handlePeopleBoardToggle(m.user_id, !m.can_view_people_board)
              }
              title="Access to the People management board"
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium border transition-colors flex-shrink-0 ${
                m.can_view_people_board
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-mist text-steel border-pebble hover:border-steel"
              }`}
            >
              People board {m.can_view_people_board ? "on" : "off"}
            </button>
          ) : (
            <span
              title="Only admins can change People board access"
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium border flex-shrink-0 ${
                m.can_view_people_board
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-mist text-steel border-pebble"
              }`}
            >
              People board {m.can_view_people_board ? "on" : "off"}
            </span>
          )
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
    );
  }

  const isAdmin = myRole === "owner" || myRole === "admin";

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
          {isAdmin
            ? "Manage team members, roles, and pending invitations."
            : "See who's on the team and invite new teammates."}
        </p>
      </div>
      <SettingsTabs />

      {/* Invite Team Member (top of Team tab) */}
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <h2 className="font-semibold text-midnight">Invite Team Member</h2>
          <p className="text-xs text-steel mt-1">
            Send an invitation by email. They&apos;ll show up under Pending
            Invitations below until they accept.
          </p>
        </div>
        <div className="px-6 py-4 flex flex-wrap items-center gap-2">
          <input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSendInvite();
              }
            }}
            className="flex-1 min-w-48 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
            className="h-9 px-2 border border-pebble rounded-lg text-sm bg-white disabled:bg-mist disabled:cursor-not-allowed"
            disabled={!isAdmin}
            title={isAdmin ? undefined : "Only admins can invite admins"}
          >
            <option value="member">Member</option>
            {isAdmin && <option value="admin">Admin</option>}
          </select>
          <button
            onClick={handleSendInvite}
            disabled={inviteSending || !inviteEmail.trim()}
            className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {inviteSending ? "Sending…" : "Invite"}
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-midnight">
                Team Members{" "}
                <span className="text-steel font-normal text-sm ml-1">({members.length})</span>
              </h2>
              <p className="text-xs text-steel mt-1">
                Owner first, then members still needing onboarding. Tap{" "}
                <span className="font-medium">Show all</span> to reveal everyone else.
              </p>
            </div>
            <input
              type="search"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search name or email…"
              className="h-9 w-56 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red flex-shrink-0"
            />
          </div>
        </div>

        <div className="divide-y divide-pebble/50">
          {(searchActive
            ? visibleMembers
            : ownerMembers
          ).map((m) => renderMemberRow(m))}

          {/* Expand/collapse button — sits right after the owner row when
              not searching, so the user can reveal everyone else without
              hunting for the toggle at the bottom of a long list. */}
          {!searchActive && onboardedMembers.length > 0 && (
            <button
              onClick={() => setShowAllMembers((v) => !v)}
              className="w-full flex items-center gap-1.5 px-6 py-2 text-xs font-medium text-steel hover:text-midnight hover:bg-mist/40 transition-colors"
            >
              {showAllMembers ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              {showAllMembers
                ? `Hide ${onboardedMembers.length} onboarded member${
                    onboardedMembers.length !== 1 ? "s" : ""
                  }`
                : `Show all team members (${onboardedMembers.length} more)`}
            </button>
          )}

          {!searchActive && needsOnboardingMembers.map((m) => renderMemberRow(m))}
          {!searchActive && showAllMembers && onboardedMembers.map((m) => renderMemberRow(m))}
        </div>

        {/* Empty-search state */}
        {searchActive && visibleMembers.length === 0 && (
          <div className="px-6 py-6 text-center text-sm text-steel/70">
            No members match &ldquo;{memberSearch}&rdquo;.
          </div>
        )}
      </div>

      {/* Assignees — personal-mode workspaces use named, no-login people */}
      {workspaceMode === "personal" && (
        <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-pebble">
            <h2 className="font-semibold text-midnight">
              Assignees{" "}
              <span className="text-steel font-normal text-sm ml-1">({assignees.length})</span>
            </h2>
            <p className="text-xs text-steel mt-1">
              Named people you assign tasks to. No email or login needed.
            </p>
          </div>
          <div className="px-6 py-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="e.g. Ravi, Site Supervisor…"
              value={assigneeInput}
              onChange={(e) => setAssigneeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddAssignee();
                }
              }}
              maxLength={100}
              className="flex-1 min-w-48 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
            />
            <button
              onClick={handleAddAssignee}
              disabled={assigneeSaving || !assigneeInput.trim()}
              className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              + Add
            </button>
          </div>
          {assignees.length > 0 && (
            <div className="px-6 pb-5">
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {assignees.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between bg-mist rounded-lg px-3 py-2"
                  >
                    <span className="text-sm text-midnight font-medium truncate">
                      {a.name}
                    </span>
                    <button
                      onClick={() => handleRemoveAssignee(a.id)}
                      className="text-steel hover:text-red-500 text-lg leading-none flex-shrink-0 ml-2"
                      aria-label={`Remove ${a.name}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

                {isAdmin && (
                  <button
                    onClick={() => handleRevokeInvite(inv.id, inv.invited_email)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium ml-1 flex-shrink-0"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {invites.length === 0 && (
        <p className="text-sm text-steel/60 text-center py-2">No pending invitations.</p>
      )}

      {/* Join Requests (Entry 2: same-domain signups asking to join) */}
      {isAdmin && joinRequests.length > 0 && (
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

      {removeTarget && (
        <Dialog
          open={!!removeTarget}
          onOpenChange={(o) => { if (!o && !removing) setRemoveTarget(null); }}
          title={`Remove ${removeTarget.name}?`}
          description="Their tasks and initiatives stay in the workspace — choose who inherits the ones they owned. Secondary assignments and follower/approver entries are removed."
          footer={
            <>
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                disabled={removing}
                className="h-9 rounded-lg border border-pebble px-4 text-sm font-semibold text-steel hover:bg-mist disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemoveMember}
                disabled={removing}
                className="h-9 rounded-lg bg-taskora-red px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {removing ? "Removing…" : "Remove & reassign"}
              </button>
            </>
          }
        >
          {removeSummary && (
            <p className="text-[13px] text-steel mb-3">
              They own <b className="text-midnight">{removeSummary.initiatives_owned}</b> initiative(s) and are primary on{" "}
              <b className="text-midnight">{removeSummary.tasks_primary}</b> task(s)
              {removeSummary.as_secondary_or_watcher > 0 && (
                <> · {removeSummary.as_secondary_or_watcher} secondary/watcher entr{removeSummary.as_secondary_or_watcher === 1 ? "y" : "ies"} will be removed</>
              )}.
            </p>
          )}
          <label className="block text-[11px] uppercase tracking-wide text-steel/70 mb-1">
            Reassign their owned work to
          </label>
          <select
            value={reassignTo}
            onChange={(e) => setReassignTo(e.target.value)}
            className="w-full border border-pebble rounded-lg px-3 py-2 text-sm text-midnight focus:outline-none focus:border-taskora-red"
          >
            <option value="">Me</option>
            {members
              .filter((m) => m.user_id !== removeTarget.userId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email || "Member"}
                </option>
              ))}
          </select>
        </Dialog>
      )}
    </div>
  );
}
