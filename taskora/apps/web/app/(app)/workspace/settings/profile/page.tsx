"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Briefcase,
  Globe,
  Calendar as CalendarIcon,
  Users,
  User,
  Pencil,
  Check,
  Lock,
  FolderKanban,
  Shield,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import SettingsTabs from "@/components/SettingsTabs";

type Profile = {
  id: string;
  name: string | null;
  type: "building" | "client" | null;
  workspace_mode: "personal" | "organisation" | null;
  logo_url: string | null;
  time_zone: string | null;
  currency: string | null;
  fiscal_year_start_month: number | null;
  company_name: string | null;
  domain: string | null;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD"];

const COMMON_TZS = [
  "Asia/Kolkata", "Asia/Singapore", "Asia/Dubai", "Asia/Tokyo",
  "Europe/London", "Europe/Berlin", "Europe/Paris",
  "America/New_York", "America/Los_Angeles", "America/Chicago",
  "Australia/Sydney", "UTC",
];

// Keep in sync with the same list on the Team page — these are consumer
// providers where the email domain doesn't represent an "organisation".
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "mac.com",
  "msn.com", "aol.com",
  "protonmail.com", "proton.me",
  "rediffmail.com",
]);

function emailDomain(email: string): string {
  const at = email.toLowerCase().lastIndexOf("@");
  return at === -1 ? "" : email.toLowerCase().slice(at + 1);
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function WorkspaceProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myRole, setMyRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Mode-lockdown signals
  const [assigneeCount, setAssigneeCount] = useState(0);
  const [nonOwnerMemberCount, setNonOwnerMemberCount] = useState(0);

  // Owner email — used to auto-derive a sensible default domain so the user
  // doesn't have to type it manually. Skipped for consumer email providers.
  const [ownerEmail, setOwnerEmail] = useState<string>("");

  // Live stats shown in the hero so the workspace feels like a real entity
  // with weight, not just a row of fields.
  const [memberCount, setMemberCount] = useState(0);
  const [programCount, setProgramCount] = useState(0);
  const [entityCount, setEntityCount] = useState(0);

  // Section-level edit state — each card flips into a form on Edit.
  const [editIdentity, setEditIdentity] = useState(false);
  const [editType, setEditType] = useState(false);
  const [editLocale, setEditLocale] = useState(false);

  // Form mirrors for each section
  const [iName, setIName] = useState("");
  const [iCompany, setICompany] = useState("");
  const [iDomain, setIDomain] = useState("");
  const [iLogo, setILogo] = useState("");
  const [iType, setIType] = useState<"building" | "client">("building");

  const [tMode, setTMode] = useState<"personal" | "organisation">("personal");

  const [lTimeZone, setLTimeZone] = useState("");
  const [lCurrency, setLCurrency] = useState("");
  const [lFyStart, setLFyStart] = useState<number | "">("");

  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const hydrateForm = useCallback((p: Profile) => {
    setIName(p.name ?? "");
    setICompany(p.company_name ?? "");
    setIDomain(p.domain ?? "");
    setILogo(p.logo_url ?? "");
    setIType(p.type ?? "building");
    setTMode(p.workspace_mode ?? "personal");
    setLTimeZone(p.time_zone ?? "");
    setLCurrency(p.currency ?? "");
    setLFyStart(p.fiscal_year_start_month ?? "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const biz = await apiFetch("/api/v1/businesses/my");
      const role = await apiFetch(`/api/v1/businesses/${biz.id}/my-role`);
      // Members get a read-only view (Edit buttons hidden); admins/owners get full edit.
      setMyRole(role?.role ?? "");
      // Parallel: members + assignees (for mode lockdown), plus programs and
      // buildings/clients counts for the hero stat chips.
      const entityPath = biz.type === "client" ? "clients" : "buildings";
      const [members, assignees, programs, entities] = await Promise.all([
        apiFetch(`/api/v1/businesses/${biz.id}/members`).catch(() => []),
        apiFetch(`/api/v1/onboarding/assignees?business_id=${biz.id}`).catch(() => []),
        apiFetch(`/api/v1/programs?business_id=${biz.id}`).catch(() => []),
        apiFetch(`/api/v1/businesses/${biz.id}/${entityPath}`).catch(() => []),
      ]);
      setProfile(biz);
      hydrateForm(biz);
      setMemberCount(Array.isArray(members) ? members.length : 0);
      setNonOwnerMemberCount(
        Array.isArray(members) ? members.filter((m: any) => m.role !== "owner").length : 0
      );
      setAssigneeCount(Array.isArray(assignees) ? assignees.length : 0);
      setProgramCount(Array.isArray(programs) ? programs.length : 0);
      setEntityCount(Array.isArray(entities) ? entities.length : 0);
      const owner = Array.isArray(members)
        ? members.find((m: any) => m.role === "owner")
        : null;
      setOwnerEmail((owner?.email ?? "").toLowerCase());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load workspace.");
    } finally {
      setLoading(false);
    }
  }, [hydrateForm]);

  useEffect(() => {
    load();
  }, [load]);

  const currentMode = profile?.workspace_mode ?? null;
  const modeLocked =
    !!currentMode &&
    ((currentMode === "personal" && assigneeCount > 0) ||
      (currentMode === "organisation" && nonOwnerMemberCount > 0));

  // Domain: explicit value wins; otherwise fall back to the owner's email
  // domain (ignoring consumer providers). `effectiveDomain` is what we show
  // in display mode and pre-fill into the Edit form so the user can confirm.
  const ownerEmailDomain = ownerEmail ? emailDomain(ownerEmail) : "";
  const autoDomain =
    ownerEmailDomain && !CONSUMER_EMAIL_DOMAINS.has(ownerEmailDomain)
      ? ownerEmailDomain
      : "";
  const effectiveDomain = (profile?.domain || autoDomain || "").toLowerCase();
  const domainIsAuto = !profile?.domain && !!autoDomain;

  async function save(payload: Record<string, unknown>, closeKey: "identity" | "type" | "locale") {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await apiFetch(`/api/v1/businesses/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setProfile((p) => (p ? { ...p, ...updated } : p));
      if (closeKey === "identity") setEditIdentity(false);
      if (closeKey === "type") setEditType(false);
      if (closeKey === "locale") setEditLocale(false);
      showToast("Saved.");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openEditIdentity() {
    if (profile) {
      hydrateForm(profile);
      // Pre-fill with the auto-derived domain so the user can just hit Save
      // instead of typing it out.
      if (!profile.domain && autoDomain) setIDomain(autoDomain);
    }
    setEditIdentity(true);
  }

  function cancelIdentity() {
    if (profile) hydrateForm(profile);
    setEditIdentity(false);
  }
  function cancelType() {
    if (profile) setTMode(profile.workspace_mode ?? "personal");
    setEditType(false);
  }
  function cancelLocale() {
    if (profile) {
      setLTimeZone(profile.time_zone ?? "");
      setLCurrency(profile.currency ?? "");
      setLFyStart(profile.fiscal_year_start_month ?? "");
    }
    setEditLocale(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-taskora-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-red-600 text-sm">{error || "Workspace not found."}</p>
      </div>
    );
  }

  const isAdmin = myRole === "owner" || myRole === "admin";

  const typeMeta =
    profile.type === "client"
      ? { label: "Clients", icon: Briefcase }
      : { label: "Buildings", icon: Building2 };
  const TypeIcon = typeMeta.icon;
  const modeMeta =
    profile.workspace_mode === "organisation"
      ? { label: "For your team", icon: Users, desc: "Invite colleagues by email" }
      : profile.workspace_mode === "personal"
      ? { label: "For yourself", icon: User, desc: "Use named assignees without user accounts" }
      : null;
  const ModeIcon = modeMeta?.icon;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-midnight text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-midnight">Workspace Settings</h1>
        <p className="text-sm text-steel mt-1">
          Everything in Taskora is scoped to a workspace. Edit this
          workspace&apos;s identity, mode, and locale.
        </p>
      </div>
      <SettingsTabs />

      {/* ── Identity hero card ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        {!editIdentity ? (
          <>
            {/* Hero — workspace identity. Eyebrow + big name + inline subtitle
                + stat chips make this read as a self-contained "thing", not a
                row of form fields. */}
            <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-taskora-red/[0.04] via-white to-ocean/[0.04] border-b border-pebble/60">
              <div className="flex items-start gap-5">
                {profile.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.logo_url}
                    alt="Workspace logo"
                    className="w-20 h-20 rounded-2xl object-cover border border-pebble flex-shrink-0 bg-white shadow-sm"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-taskora-red to-taskora-red/70 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-sm">
                    {initials(profile.name)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-taskora-red/70 mb-1">
                        Workspace name
                      </p>
                      <h2 className="text-2xl font-bold text-midnight truncate leading-tight">
                        {profile.name || "Untitled workspace"}
                      </h2>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={openEditIdentity}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-pebble bg-white text-steel hover:bg-mist hover:text-midnight transition-colors flex-shrink-0 shadow-sm"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Stat chips — what's actually IN this workspace. Makes the
                  hero feel substantive even on a fresh workspace. */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatChip
                  icon={TypeIcon}
                  label={typeMeta.label}
                  value={entityCount}
                />
                <StatChip
                  icon={Users}
                  label="Members"
                  value={memberCount}
                />
                <StatChip
                  icon={FolderKanban}
                  label="Programs"
                  value={programCount}
                />
                <StatChip
                  icon={Shield}
                  label="Your role"
                  text={myRole || "—"}
                />
              </div>
            </div>

            {/* Labelled identity rows — always visible so empty fields read as
                affordances ("Add…") instead of mysterious gaps. */}
            <div className="divide-y divide-pebble/40">
              <IdentityRow
                icon={Briefcase}
                label="Company name"
                value={profile.company_name}
                emptyHint="Add your legal/organisation name"
                onEdit={isAdmin ? openEditIdentity : undefined}
              />
              <IdentityRow
                icon={Globe}
                label="Domain"
                value={effectiveDomain ? `@${effectiveDomain}` : null}
                badge={
                  domainIsAuto
                    ? "auto from your email"
                    : profile.domain
                    ? "explicit"
                    : null
                }
                emptyHint="Add your organisation domain"
                onEdit={isAdmin ? openEditIdentity : undefined}
              />
              <IdentityRow
                icon={TypeIcon}
                label="Manages"
                value={typeMeta.label}
                onEdit={isAdmin ? openEditIdentity : undefined}
              />
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-pebble flex items-center justify-between">
              <h2 className="font-semibold text-midnight">Edit identity</h2>
              <span className="text-xs text-steel/60">Workspace, company, domain, logo</span>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-steel mb-1">
                  Workspace name
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-steel/70">
                    <Lock className="w-2.5 h-2.5" />
                    Locked
                  </span>
                </label>
                <input
                  type="text"
                  value={iName}
                  readOnly
                  disabled
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm bg-mist/60 text-steel cursor-not-allowed"
                />
                <p className="text-[11px] text-steel/60 mt-1">
                  The workspace name is set once at creation. Programs, tasks
                  and members are scoped to it, so renaming would break the
                  identity. Contact support if you really need to change it.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-steel mb-1">
                    Company name
                  </label>
                  <input
                    type="text"
                    value={iCompany}
                    onChange={(e) => setICompany(e.target.value)}
                    maxLength={200}
                    placeholder="SmartWorks Pvt Ltd"
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-steel mb-1">
                    Domain
                  </label>
                  <input
                    type="text"
                    value={iDomain}
                    onChange={(e) => setIDomain(e.target.value.toLowerCase())}
                    maxLength={200}
                    placeholder="sworks.co.in"
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
                  />
                  <p className="text-[11px] text-steel/60 mt-1">
                    Invites to other domains will ask for confirmation.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-steel mb-1">
                  Logo URL <span className="text-steel/60">(optional)</span>
                </label>
                <input
                  type="url"
                  value={iLogo}
                  onChange={(e) => setILogo(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-steel mb-2">
                  What do you manage?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "building" as const, label: "Buildings", icon: Building2, desc: "Real estate, construction, facilities" },
                    { value: "client"   as const, label: "Clients",   icon: Briefcase, desc: "Agencies, services, consultancies" },
                  ].map((opt) => {
                    const OptIcon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setIType(opt.value)}
                        className={`text-left p-3 border rounded-xl transition-all ${
                          iType === opt.value
                            ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                            : "border-pebble hover:border-taskora-red/50"
                        }`}
                      >
                        <OptIcon className="w-4 h-4 text-midnight mb-1.5" />
                        <div className="font-semibold text-midnight text-sm">{opt.label}</div>
                        <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-pebble bg-mist/40 flex items-center justify-end gap-2">
              <button
                onClick={cancelIdentity}
                className="h-9 px-4 border border-pebble text-sm text-steel rounded-lg hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  save(
                    {
                      // Workspace name is intentionally NOT sent — it's
                      // immutable post-creation. See the locked input above.
                      type: iType,
                      logo_url: iLogo.trim() || null,
                      company_name: iCompany.trim() || null,
                      domain: iDomain.trim() || null,
                    },
                    "identity"
                  )
                }
                disabled={saving}
                className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Workspace type ───────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-midnight flex items-center gap-2">
              <Users className="w-4 h-4 text-steel" />
              Workspace type
            </h3>
            <p className="text-xs text-steel mt-0.5">
              How this workspace is used.
              {modeLocked && (
                <span className="inline-flex items-center gap-1 ml-1 text-amber-700">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
            </p>
          </div>
          {isAdmin && !editType && !modeLocked && (
            <button
              onClick={() => setEditType(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-pebble text-steel hover:bg-mist hover:text-midnight transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
        </div>
        {!editType ? (
          <div className="px-6 py-5">
            {modeMeta && ModeIcon ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-mist border border-pebble flex items-center justify-center flex-shrink-0">
                  <ModeIcon className="w-5 h-5 text-midnight" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-midnight text-sm">{modeMeta.label}</p>
                  <p className="text-xs text-steel mt-0.5">{modeMeta.desc}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-steel/70 italic">Not set yet.</p>
            )}
            {modeLocked && (
              <p className="text-xs text-amber-700 mt-3">
                Locked because this workspace already has{" "}
                {currentMode === "personal"
                  ? `${assigneeCount} named assignee${assigneeCount === 1 ? "" : "s"}`
                  : `${nonOwnerMemberCount} other member${nonOwnerMemberCount === 1 ? "" : "s"}`}
                . Remove that data first or contact support for a migration.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="px-6 py-5 grid grid-cols-2 gap-3 max-w-xl">
              {[
                { value: "personal"     as const, label: "For yourself",  icon: User, desc: "Use named assignees without user accounts" },
                { value: "organisation" as const, label: "For your team", icon: Users, desc: "Invite colleagues by email" },
              ].map((opt) => {
                const OptIcon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !modeLocked && setTMode(opt.value)}
                    disabled={modeLocked && opt.value !== currentMode}
                    className={`text-left p-3 border rounded-xl transition-all ${
                      tMode === opt.value
                        ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                        : "border-pebble hover:border-taskora-red/50"
                    } ${modeLocked && opt.value !== currentMode ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <OptIcon className="w-4 h-4 text-midnight mb-1.5" />
                    <div className="font-semibold text-midnight text-sm">{opt.label}</div>
                    <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            <div className="px-6 py-3 border-t border-pebble bg-mist/40 flex items-center justify-end gap-2">
              <button
                onClick={cancelType}
                className="h-9 px-4 border border-pebble text-sm text-steel rounded-lg hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={() => save({ workspace_mode: tMode }, "type")}
                disabled={saving || modeLocked}
                className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Locale ───────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-midnight flex items-center gap-2">
              <Globe className="w-4 h-4 text-steel" />
              Locale
            </h3>
            <p className="text-xs text-steel mt-0.5">
              Time zone, currency, and fiscal-year start.
            </p>
          </div>
          {isAdmin && !editLocale && (
            <button
              onClick={() => setEditLocale(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-pebble text-steel hover:bg-mist hover:text-midnight transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
        </div>
        {!editLocale ? (
          <div className="px-6 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <LocaleDisplay
                icon={Globe}
                label="Time zone"
                value={profile.time_zone}
              />
              <LocaleDisplay
                icon={Check}
                label="Currency"
                value={profile.currency}
              />
              <LocaleDisplay
                icon={CalendarIcon}
                label="Fiscal year starts"
                value={
                  profile.fiscal_year_start_month
                    ? MONTHS[profile.fiscal_year_start_month - 1]
                    : null
                }
              />
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-steel mb-1">Time zone</label>
                <input
                  list="tz-list"
                  value={lTimeZone}
                  onChange={(e) => setLTimeZone(e.target.value)}
                  placeholder="Asia/Kolkata"
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
                />
                <datalist id="tz-list">
                  {COMMON_TZS.map((tz) => <option key={tz} value={tz} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-steel mb-1">Currency</label>
                <select
                  value={lCurrency}
                  onChange={(e) => setLCurrency(e.target.value)}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red"
                >
                  <option value="">—</option>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-steel mb-1">
                  Fiscal year starts
                </label>
                <select
                  value={lFyStart}
                  onChange={(e) => setLFyStart(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red"
                >
                  <option value="">—</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-pebble bg-mist/40 flex items-center justify-end gap-2">
              <button
                onClick={cancelLocale}
                className="h-9 px-4 border border-pebble text-sm text-steel rounded-lg hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  save(
                    {
                      time_zone: lTimeZone.trim() || null,
                      currency: lCurrency.trim() || null,
                      fiscal_year_start_month: lFyStart === "" ? null : Number(lFyStart),
                    },
                    "locale"
                  )
                }
                disabled={saving}
                className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Danger zone — only the owner can delete the workspace. Cascades
          through every child table via FK ON DELETE CASCADE. Two-step
          confirm (button → modal with name-echo) so a stray click can't
          destroy the workspace. */}
      {myRole === "owner" && profile && (
        <DangerZone profile={profile} />
      )}
    </div>
  );
}

function DangerZone({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const wsName = profile.name ?? "";
  async function doDelete() {
    if (typed !== wsName) {
      setErr("Workspace name doesn't match.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await apiFetch(
        `/api/v1/businesses/${profile.id}?confirm_name=${encodeURIComponent(wsName)}`,
        { method: "DELETE" },
      );
      // Clear cached workspace and route to /login — the user has lost
      // their context. Layout will auto-resolve a new active workspace
      // (one of their other memberships) on next sign-in.
      if (typeof window !== "undefined") {
        localStorage.removeItem("business_id");
        // Force the layout to re-pick on the next page load.
        window.location.href = "/daily-brief";
      } else {
        router.push("/daily-brief");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete workspace.");
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-red-200 rounded-2xl shadow-sm">
      <header className="px-6 py-4 border-b border-red-200">
        <h2 className="text-base font-bold text-red-700">Danger zone</h2>
        <p className="text-xs text-steel mt-0.5">
          Deleting this workspace permanently removes every initiative, task,
          subtask, comment, attachment, building, client, member, invite, and
          billing record under it. This cannot be undone.
        </p>
      </header>
      <div className="px-6 py-4">
        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => {
              setConfirmOpen(true);
              setTyped("");
              setErr("");
            }}
            className="h-9 px-4 border border-red-300 text-red-700 text-sm font-semibold rounded-lg hover:bg-red-50"
          >
            Delete this workspace
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-midnight">
              Type <span className="font-bold">{wsName}</span> to confirm.
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              placeholder={wsName}
              className="w-full max-w-sm border border-pebble rounded px-3 py-1.5 text-sm focus:outline-none focus:border-red-400"
              autoFocus
            />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="h-9 px-4 border border-pebble text-steel text-sm font-semibold rounded-lg hover:bg-mist"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={busy || typed !== wsName}
                className="h-9 px-4 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  text?: string;
}) {
  return (
    <div className="bg-white border border-pebble rounded-xl px-3 py-2.5 flex items-center gap-2.5 shadow-sm">
      <div className="w-8 h-8 rounded-lg bg-mist flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-steel" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-steel/60 font-semibold">
          {label}
        </p>
        <p className="text-base font-bold text-midnight truncate capitalize">
          {value !== undefined ? value : text ?? "—"}
        </p>
      </div>
    </div>
  );
}

function IdentityRow({
  icon: Icon,
  label,
  value,
  badge,
  emptyHint,
  onEdit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  badge?: string | null;
  emptyHint?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="px-6 py-2.5 flex items-center gap-3">
      <Icon className="w-4 h-4 text-steel/70 flex-shrink-0" />
      <div className="text-[11px] uppercase tracking-wide text-steel/60 font-medium w-32 flex-shrink-0">
        {label}
      </div>
      <div className="flex-1 min-w-0">
        {value ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-midnight truncate">{value}</span>
            {badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-mist text-steel/70 border border-pebble flex-shrink-0">
                {badge}
              </span>
            )}
          </div>
        ) : onEdit ? (
          <button
            onClick={onEdit}
            className="text-sm text-taskora-red hover:underline truncate"
          >
            {emptyHint ?? "Add value"}
          </button>
        ) : (
          <span className="text-sm text-steel/50 italic truncate">Not set</span>
        )}
      </div>
    </div>
  );
}

function LocaleDisplay({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-steel/70 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-steel/60 font-medium">
          {label}
        </p>
        <p className="text-sm text-midnight mt-0.5 truncate">
          {value || <span className="text-steel/50 italic font-normal">Not set</span>}
        </p>
      </div>
    </div>
  );
}
