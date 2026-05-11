"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SettingsTabs from "@/components/SettingsTabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.json().then((d: any) => d.detail ?? `HTTP ${res.status}`).catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

const BUILDINGS_CSV = `Name,Address\nExample Tower A,123 Main Street Mumbai\nExample Complex B,456 Park Avenue Delhi\n`;
const CLIENTS_CSV   = `Name,Contact Email,Contact Phone\nAcme Corp,contact@acme.com,+91 98765 43210\nTech Solutions,info@techsol.com,+91 87654 32109\n`;

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

type OnboardingStatus = {
  business_id: string;
  business_type: "building" | "client";
  workspace_mode: "personal" | "organisation" | null;
  onboarding_completed: boolean;
  step2_done: boolean;
  step2_skipped: boolean;
  step3_done: boolean;
  step3_skipped: boolean;
};

type Assignee = { id: string; name: string };

// ── Section: Workspace mode ──────────────────────────────────────────────────
function WorkspaceModeSection({
  status,
  onChanged,
}: {
  status: OnboardingStatus;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"personal" | "organisation">(status.workspace_mode ?? "personal");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState("");
  const current = status.workspace_mode ?? "personal";

  async function save() {
    if (mode === current) return;
    setSaving(true); setMsg("");
    try {
      await apiFetch("/api/v1/onboarding/step1", { method: "POST", body: JSON.stringify({ workspace_mode: mode }) });
      setMsg("Saved.");
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }

  return (
    <Section title="Workspace type" badge={current ? "Configured" : "Not set"} badgeOk={!!current}>
      <p className="text-sm text-steel mb-4">Choose how your workspace is used.</p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        {[
          { value: "personal"     as const, label: "For yourself",  icon: "👤", desc: "Use named assignees without user accounts" },
          { value: "organisation" as const, label: "For your team", icon: "👥", desc: "Invite colleagues by email" },
        ].map((opt) => (
          <button key={opt.value} type="button"
            onClick={() => setMode(opt.value)}
            className={`text-left p-3 border rounded-xl transition-all ${
              mode === opt.value
                ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                : "border-pebble hover:border-taskora-red/50"
            }`}>
            <div className="text-lg mb-1">{opt.icon}</div>
            <div className="font-semibold text-midnight text-sm">{opt.label}</div>
            <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving || mode === current}
          className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>{msg}</span>}
      </div>
    </Section>
  );
}

// ── Section: Assignees (personal mode) ──────────────────────────────────────
function AssigneesSection({ status, onStepDone }: { status: OnboardingStatus; onStepDone: () => void }) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [input, setInput]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setAssignees(await apiFetch("/api/v1/onboarding/assignees")); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const name = input.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/v1/onboarding/assignees", { method: "POST", body: JSON.stringify({ name }) });
      setAssignees((p) => [...p, res]);
      setInput("");
      inputRef.current?.focus();
      // Mark step2 done if it was skipped
      if (status.step2_skipped) {
        await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false }) });
        onStepDone();
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    setAssignees((p) => p.filter((a) => a.id !== id));
    await apiFetch(`/api/v1/onboarding/assignees/${id}`, { method: "DELETE" }).catch(() => {});
  }

  const badgeOk = status.step2_done && !status.step2_skipped;

  return (
    <Section title="Assignees" badge={badgeOk ? "Complete" : status.step2_skipped ? "Skipped" : "Not started"} badgeOk={badgeOk}>
      <p className="text-sm text-steel mb-3">People you assign tasks to. No email or login needed.</p>
      <div className="flex gap-2 mb-3">
        <input ref={inputRef} type="text" placeholder="e.g. Ravi, Site Supervisor…"
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="flex-1 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
          maxLength={100} />
        <button onClick={add} disabled={saving || !input.trim()}
          className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          + Add
        </button>
      </div>
      {msg && <p className="text-xs text-red-600 mb-2">{msg}</p>}
      {assignees.length > 0 ? (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {assignees.map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-mist rounded-lg px-3 py-2">
              <span className="text-sm text-midnight font-medium">{a.name}</span>
              <button onClick={() => remove(a.id)} className="text-steel hover:text-red-500 text-lg leading-none">&times;</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-steel/60 italic">No assignees yet.</p>
      )}
    </Section>
  );
}

// ── Section: Team invites (org mode) ─────────────────────────────────────────
function TeamInvitesSection({ status, onStepDone }: { status: OnboardingStatus; onStepDone: () => void }) {
  const [email, setEmail]   = useState("");
  const [role, setRole]     = useState("member");
  const [sent, setSent]     = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError]   = useState("");

  async function send() {
    const e = email.trim();
    if (!e) return;
    setSending(true); setError("");
    try {
      const biz = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
      await apiFetch("/api/v1/invites/", { method: "POST", body: JSON.stringify({ email: e, role, business_id: biz }) });
      setSent((p) => [...p, e]);
      setEmail("");
      if (status.step2_skipped) {
        await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false }) });
        onStepDone();
      }
    } catch (err: any) { setError(err.message); }
    finally { setSending(false); }
  }

  const badgeOk = status.step2_done && !status.step2_skipped;

  return (
    <Section title="Team invites" badge={badgeOk ? "Complete" : status.step2_skipped ? "Skipped" : "Not started"} badgeOk={badgeOk}>
      <p className="text-sm text-steel mb-3">Invite colleagues by email. Existing invites are managed under the Team tab.</p>
      <div className="flex gap-2 flex-wrap">
        <input type="email" placeholder="colleague@company.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          className="flex-1 min-w-48 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="h-9 px-2 border border-pebble rounded-lg text-sm bg-white">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={send} disabled={sending || !email.trim()}
          className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          {sending ? "Sending…" : "Invite"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {sent.length > 0 && (
        <div className="mt-3 space-y-1">
          {sent.map((e) => (
            <div key={e} className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-1.5">
              <span>✓</span> Invite sent to <span className="font-medium">{e}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Section: Entity import ────────────────────────────────────────────────────
function EntityImportSection({ status, onStepDone }: { status: OnboardingStatus; onStepDone: () => void }) {
  const label      = status.business_type === "client" ? "Clients" : "Buildings";
  const csvContent = status.business_type === "client" ? CLIENTS_CSV : BUILDINGS_CSV;
  const csvFile    = status.business_type === "client" ? "clients_template.csv" : "buildings_template.csv";

  const [manualInput, setManualInput]   = useState("");
  const [manualList, setManualList]     = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsed" | "error">("idle");
  const [uploadCount, setUploadCount]   = useState(0);
  const [uploadError, setUploadError]   = useState("");
  const [importing, setImporting]       = useState(false);
  const [msg, setMsg]                   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const badgeOk = status.step3_done && !status.step3_skipped;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        const valid = rows.filter((r) => r.name);
        if (!valid.length) { setUploadError("No valid rows found. Check the template."); setUploadStatus("error"); return; }
        setUploadCount(valid.length);
        setUploadStatus("parsed");
        (fileRef as any)._parsed = rows;
      } catch { setUploadError("Could not parse file."); setUploadStatus("error"); }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true); setMsg("");
    try {
      const biz = status.business_id;
      const parsed: Record<string, string>[] = (fileRef as any)._parsed ?? [];
      const manual = manualList.map((name) => ({ name }));

      if (status.business_type === "building") {
        const items = [
          ...parsed.map((r) => ({ name: r.name ?? "", address: r.address ?? undefined })),
          ...manual,
        ].filter((r) => r.name.trim());
        if (items.length) {
          const res = await apiFetch(`/api/v1/businesses/${biz}/buildings/bulk`, {
            method: "POST", body: JSON.stringify({ items }),
          });
          setMsg(`${res.inserted} ${res.inserted === 1 ? "building" : "buildings"} imported.`);
        }
      } else {
        const items = [
          ...parsed.map((r) => ({
            name: r.name ?? "",
            contact_email: r["contact email"] || r.contact_email || undefined,
            contact_phone: r["contact phone"] || r.contact_phone || undefined,
          })),
          ...manual,
        ].filter((r) => r.name.trim());
        if (items.length) {
          const res = await apiFetch(`/api/v1/businesses/${biz}/clients/bulk`, {
            method: "POST", body: JSON.stringify({ items }),
          });
          setMsg(`${res.inserted} ${res.inserted === 1 ? "client" : "clients"} imported.`);
        }
      }

      await apiFetch("/api/v1/onboarding/step3/done", { method: "POST", body: JSON.stringify({ skipped: false }) });
      onStepDone();
      setManualList([]);
      setUploadStatus("idle");
      setUploadCount(0);
    } catch (e: any) { setMsg(`Error: ${e.message}`); }
    finally { setImporting(false); }
  }

  const hasData = uploadStatus === "parsed" || manualList.length > 0;

  return (
    <Section title={`${label} list`} badge={badgeOk ? "Complete" : status.step3_skipped ? "Skipped" : "Not started"} badgeOk={badgeOk}>
      <p className="text-sm text-steel mb-4">Import your {label.toLowerCase()} list via CSV or add them manually. Importing again will add to the existing list.</p>

      {/* CSV */}
      <div className="border border-pebble rounded-xl p-4 space-y-3 mb-4">
        <p className="text-sm font-medium text-midnight">Import from CSV / Excel</p>
        <div className="flex gap-3 flex-wrap">
          <button type="button" onClick={() => downloadCSV(csvContent, csvFile)}
            className="h-9 px-3 text-xs border border-pebble rounded-lg text-steel hover:bg-mist flex items-center gap-1.5">
            ↓ Download template
          </button>
          <label className={`h-9 px-3 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
            uploadStatus === "parsed"
              ? "bg-green-50 border border-green-200 text-green-700"
              : uploadStatus === "error"
              ? "bg-red-50 border border-red-200 text-red-600"
              : "border border-taskora-red/60 text-taskora-red hover:bg-red-50"
          }`}>
            {uploadStatus === "parsed"
              ? `✓ ${uploadCount} ${label.toLowerCase()} ready`
              : uploadStatus === "error" ? "✕ Parse error" : "↑ Upload CSV"}
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </label>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {/* Manual */}
      <p className="text-sm font-medium text-midnight mb-2">Or add manually</p>
      <div className="flex gap-2 mb-2">
        <input type="text" placeholder={`${label.slice(0, -1)} name…`}
          value={manualInput} onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (manualInput.trim()) { setManualList((p) => p.includes(manualInput.trim()) ? p : [...p, manualInput.trim()]); setManualInput(""); } } }}
          className="flex-1 h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
          maxLength={100} />
        <button disabled={!manualInput.trim()}
          onClick={() => { const n = manualInput.trim(); if (n) { setManualList((p) => p.includes(n) ? p : [...p, n]); setManualInput(""); } }}
          className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          + Add
        </button>
      </div>
      {manualList.length > 0 && (
        <div className="space-y-1 mb-4 max-h-36 overflow-y-auto">
          {manualList.map((n) => (
            <div key={n} className="flex items-center justify-between bg-mist rounded-lg px-3 py-1.5">
              <span className="text-sm text-midnight">{n}</span>
              <button onClick={() => setManualList((p) => p.filter((x) => x !== n))} className="text-steel hover:text-red-500 text-lg leading-none">&times;</button>
            </div>
          ))}
        </div>
      )}

      {msg && <p className={`text-sm mb-3 ${msg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>{msg}</p>}

      <button onClick={handleImport} disabled={importing || !hasData}
        className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
        {importing ? "Importing…" : `Import ${label}`}
      </button>
    </Section>
  );
}

// ── Reusable section card ─────────────────────────────────────────────────────
function Section({
  title, badge, badgeOk, children,
}: {
  title: string;
  badge: string;
  badgeOk: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-pebble flex items-center justify-between">
        <h2 className="font-semibold text-midnight">{title}</h2>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
          badgeOk
            ? "bg-green-50 text-green-700 border-green-200"
            : badge === "Skipped"
            ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-gray-50 text-gray-500 border-gray-200"
        }`}>
          {badge}
        </span>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SettingsOnboardingPage() {
  const router = useRouter();
  const [status, setStatus]   = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const reload = useCallback(async () => {
    try {
      const s = await apiFetch("/api/v1/onboarding/status");
      setStatus(s);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Check admin/owner access
        const biz = await apiFetch("/api/v1/businesses/my");
        if (!biz?.id) throw new Error("No business");
        const role = await apiFetch(`/api/v1/businesses/${biz.id}/my-role`);
        if (role?.role === "member") { router.replace("/daily-brief"); return; }
        await reload();
      } catch (e: any) {
        if (e.message.includes("403")) { router.replace("/daily-brief"); return; }
        setError(e.message);
      } finally { setLoading(false); }
    })();
  }, [router, reload]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-taskora-red border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-midnight">Workspace Settings</h1>
        <p className="text-sm text-steel mt-1">Configure your workspace setup and import data.</p>
      </div>

      <SettingsTabs />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status && (
        <>
          <WorkspaceModeSection status={status} onChanged={reload} />

          {status.workspace_mode === "personal" && (
            <AssigneesSection status={status} onStepDone={reload} />
          )}

          {status.workspace_mode === "organisation" && (
            <TeamInvitesSection status={status} onStepDone={reload} />
          )}

          {!status.workspace_mode && (
            <div className="bg-mist rounded-xl p-5 text-sm text-steel text-center">
              Save your workspace type above to unlock the people and import sections.
            </div>
          )}

          <EntityImportSection status={status} onStepDone={reload} />
        </>
      )}
    </div>
  );
}
