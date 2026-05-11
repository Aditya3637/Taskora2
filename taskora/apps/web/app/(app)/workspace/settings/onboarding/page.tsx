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

const BUILDINGS_CSV = `Building Name,Zone,City,Building Code,Area\nTower A,North Zone,Mumbai,BLD001,1200 sqft\nTower B,South Zone,Delhi,BLD002,800 sqft\n`;
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
  business_name: string | null;
  business_type: "building" | "client";
  workspace_mode: "personal" | "organisation" | null;
  onboarding_completed: boolean;
  step2_done: boolean;
  step2_skipped: boolean;
  step3_done: boolean;
  step3_skipped: boolean;
};

type Assignee = { id: string; name: string };

// ── Section: Workspace identity (name + type) ───────────────────────────────
function WorkspaceInfoSection({ status, onChanged }: { status: OnboardingStatus; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(status.business_name ?? "");
  const [type, setType]       = useState<"building" | "client">(status.business_type ?? "building");
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState("");

  async function save() {
    if (!name.trim()) return;
    setSaving(true); setMsg("");
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    try {
      await apiFetch(`/api/v1/businesses/${bizId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), type }),
      });
      setMsg("Saved.");
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }

  function cancel() {
    setName(status.business_name ?? "");
    setType(status.business_type ?? "building");
    setEditing(false);
    setMsg("");
  }

  return (
    <Section title="Workspace" badge="Configured" badgeOk={true}>
      {!editing ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-midnight text-base">{status.business_name ?? "—"}</p>
            <p className="text-xs text-steel mt-0.5">
              {status.business_type === "client" ? "Client workspace" : "Building workspace"}
            </p>
          </div>
          <button onClick={() => setEditing(true)}
            className="h-8 px-3 text-xs border border-pebble rounded-lg text-steel hover:bg-mist transition-colors">
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-steel font-medium mb-1">Workspace name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
              maxLength={100} />
          </div>
          <div>
            <label className="block text-xs text-steel font-medium mb-2">What do you manage?</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "building" as const, label: "Buildings", desc: "Real estate, construction, facilities" },
                { value: "client"   as const, label: "Clients",   desc: "Agencies, services, consultancies" },
              ].map((opt) => (
                <button key={opt.value} type="button" onClick={() => setType(opt.value)}
                  className={`text-left p-3 border rounded-xl transition-all ${
                    type === opt.value
                      ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                      : "border-pebble hover:border-taskora-red/50"
                  }`}>
                  <div className="font-semibold text-midnight text-sm">{opt.label}</div>
                  <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving || !name.trim()}
              className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button onClick={cancel}
              className="h-9 px-3 border border-pebble text-steel text-sm rounded-lg hover:bg-mist">
              Cancel
            </button>
            {msg && <span className={`text-sm ${msg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>{msg}</span>}
          </div>
        </div>
      )}
    </Section>
  );
}

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
      const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
      await apiFetch("/api/v1/onboarding/step1", { method: "POST", body: JSON.stringify({ workspace_mode: mode, business_id: bizId || undefined }) });
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
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    try { setAssignees(await apiFetch(`/api/v1/onboarding/assignees${bizId ? `?business_id=${bizId}` : ""}`)); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const name = input.trim();
    if (!name) return;
    setSaving(true);
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    try {
      const res = await apiFetch("/api/v1/onboarding/assignees", { method: "POST", body: JSON.stringify({ name, business_id: bizId || undefined }) });
      setAssignees((p) => [...p, res]);
      setInput("");
      inputRef.current?.focus();
      if (status.step2_skipped) {
        await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false, business_id: bizId || undefined }) });
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
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    try {
      await apiFetch("/api/v1/invites/", { method: "POST", body: JSON.stringify({ email: e, role, business_id: bizId }) });
      setSent((p) => [...p, e]);
      setEmail("");
      if (status.step2_skipped) {
        await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false, business_id: bizId || undefined }) });
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

type ManualBuilding = { name: string; zone: string; city: string; code: string; area: string };
type ManualClient = { name: string; contact_email: string; contact_phone: string };

const EMPTY_BUILDING: ManualBuilding = { name: "", zone: "", city: "", code: "", area: "" };
const EMPTY_CLIENT: ManualClient = { name: "", contact_email: "", contact_phone: "" };

// ── Section: Entity import ────────────────────────────────────────────────────
function EntityImportSection({ status, onStepDone }: { status: OnboardingStatus; onStepDone: () => void }) {
  const [activeTab, setActiveTab] = useState<"buildings" | "clients">("buildings");

  const [buildingForm, setBuildingForm] = useState<ManualBuilding>(EMPTY_BUILDING);
  const [manualBuildings, setManualBuildings] = useState<ManualBuilding[]>([]);
  const [bUploadStatus, setBUploadStatus] = useState<"idle" | "parsed" | "error">("idle");
  const [bUploadCount, setBUploadCount] = useState(0);
  const [bUploadError, setBUploadError] = useState("");
  const bFileRef = useRef<HTMLInputElement>(null);

  const [clientForm, setClientForm] = useState<ManualClient>(EMPTY_CLIENT);
  const [manualClients, setManualClients] = useState<ManualClient[]>([]);
  const [cUploadStatus, setCUploadStatus] = useState<"idle" | "parsed" | "error">("idle");
  const [cUploadCount, setCUploadCount] = useState(0);
  const [cUploadError, setCUploadError] = useState("");
  const cFileRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [msg, setMsg]             = useState("");

  const badgeOk = status.step3_done && !status.step3_skipped;

  function handleBuildingFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBUploadError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        const valid = rows.filter((r) => r["building name"] || r["name"]);
        if (!valid.length) { setBUploadError("No valid rows found. Check the template."); setBUploadStatus("error"); return; }
        setBUploadCount(valid.length);
        setBUploadStatus("parsed");
        (bFileRef as any)._parsed = rows;
      } catch { setBUploadError("Could not parse file."); setBUploadStatus("error"); }
    };
    reader.readAsText(file);
  }

  function handleClientFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCUploadError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        const valid = rows.filter((r) => r.name);
        if (!valid.length) { setCUploadError("No valid rows found. Check the template."); setCUploadStatus("error"); return; }
        setCUploadCount(valid.length);
        setCUploadStatus("parsed");
        (cFileRef as any)._parsed = rows;
      } catch { setCUploadError("Could not parse file."); setCUploadStatus("error"); }
    };
    reader.readAsText(file);
  }

  function addBuilding() {
    if (!buildingForm.name.trim()) return;
    setManualBuildings((p) => [...p, { ...buildingForm }]);
    setBuildingForm(EMPTY_BUILDING);
  }

  function addClient() {
    if (!clientForm.name.trim()) return;
    setManualClients((p) => [...p, { ...clientForm }]);
    setClientForm(EMPTY_CLIENT);
  }

  async function handleImport() {
    setImporting(true); setMsg("");
    const msgs: string[] = [];
    try {
      const biz = status.business_id;

      const bParsed: Record<string, string>[] = (bFileRef as any)._parsed ?? [];
      const buildingItems = [
        ...bParsed.map((r) => ({
          name: r["building name"] || r["name"] || "",
          zone: r["zone"] || undefined,
          city: r["city"] || undefined,
          code: r["building code"] || r["code"] || undefined,
          area: r["area"] || undefined,
        })),
        ...manualBuildings.map((b) => ({
          name: b.name,
          zone: b.zone || undefined,
          city: b.city || undefined,
          code: b.code || undefined,
          area: b.area || undefined,
        })),
      ].filter((r) => r.name.trim());

      if (buildingItems.length) {
        const res = await apiFetch(`/api/v1/businesses/${biz}/buildings/bulk`, {
          method: "POST", body: JSON.stringify({ items: buildingItems }),
        });
        msgs.push(`${res.inserted} ${res.inserted === 1 ? "building" : "buildings"} imported`);
      }

      const cParsed: Record<string, string>[] = (cFileRef as any)._parsed ?? [];
      const clientItems = [
        ...cParsed.map((r) => ({
          name: r.name ?? "",
          contact_email: r["contact email"] || r.contact_email || undefined,
          contact_phone: r["contact phone"] || r.contact_phone || undefined,
        })),
        ...manualClients.map((c) => ({
          name: c.name,
          contact_email: c.contact_email || undefined,
          contact_phone: c.contact_phone || undefined,
        })),
      ].filter((r) => r.name.trim());

      if (clientItems.length) {
        const res = await apiFetch(`/api/v1/businesses/${biz}/clients/bulk`, {
          method: "POST", body: JSON.stringify({ items: clientItems }),
        });
        msgs.push(`${res.inserted} ${res.inserted === 1 ? "client" : "clients"} imported`);
      }

      await apiFetch("/api/v1/onboarding/step3/done", { method: "POST", body: JSON.stringify({ skipped: false, business_id: biz }) });
      onStepDone();
      setManualBuildings([]); setManualClients([]);
      setBUploadStatus("idle"); setBUploadCount(0);
      setCUploadStatus("idle"); setCUploadCount(0);
      setMsg(msgs.length > 0 ? msgs.join(" · ") + "." : "Done!");
    } catch (e: any) { setMsg(`Error: ${e.message}`); }
    finally { setImporting(false); }
  }

  const hasData = bUploadStatus === "parsed" || manualBuildings.length > 0 || cUploadStatus === "parsed" || manualClients.length > 0;

  return (
    <Section title="Buildings & Clients" badge={badgeOk ? "Complete" : status.step3_skipped ? "Skipped" : "Not started"} badgeOk={badgeOk}>
      <p className="text-sm text-steel mb-4">Import your buildings and clients via CSV or add manually. Importing again adds to the existing list.</p>

      {/* Tabs */}
      <div className="flex border-b border-pebble mb-4">
        {(["buildings", "clients"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-taskora-red text-taskora-red"
                : "border-transparent text-steel hover:text-midnight"
            }`}>
            {tab}
            {tab === "buildings" && (manualBuildings.length > 0 || bUploadStatus === "parsed") && (
              <span className="ml-1.5 text-xs bg-taskora-red/10 text-taskora-red rounded-full px-1.5 py-0.5">
                {manualBuildings.length + (bUploadStatus === "parsed" ? bUploadCount : 0)}
              </span>
            )}
            {tab === "clients" && (manualClients.length > 0 || cUploadStatus === "parsed") && (
              <span className="ml-1.5 text-xs bg-taskora-red/10 text-taskora-red rounded-full px-1.5 py-0.5">
                {manualClients.length + (cUploadStatus === "parsed" ? cUploadCount : 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "buildings" && (
        <div className="space-y-3">
          <div className="border border-pebble rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-midnight">Import from CSV / Excel</p>
            <div className="flex gap-3 flex-wrap">
              <button type="button" onClick={() => downloadCSV(BUILDINGS_CSV, "buildings_template.csv")}
                className="h-9 px-3 text-xs border border-pebble rounded-lg text-steel hover:bg-mist flex items-center gap-1.5">
                ↓ Download template
              </button>
              <label className={`h-9 px-3 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                bUploadStatus === "parsed" ? "bg-green-50 border border-green-200 text-green-700"
                  : bUploadStatus === "error" ? "bg-red-50 border border-red-200 text-red-600"
                  : "border border-taskora-red/60 text-taskora-red hover:bg-red-50"
              }`}>
                {bUploadStatus === "parsed" ? `✓ ${bUploadCount} buildings ready`
                  : bUploadStatus === "error" ? "✕ Parse error" : "↑ Upload CSV"}
                <input ref={bFileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleBuildingFile} />
              </label>
            </div>
            {bUploadError && <p className="text-xs text-red-600">{bUploadError}</p>}
          </div>
          <div className="border border-pebble rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-midnight">Add manually</p>
            <input type="text" placeholder="Building Name *" value={buildingForm.name}
              onChange={(e) => setBuildingForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" maxLength={200} />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="Zone" value={buildingForm.zone}
                onChange={(e) => setBuildingForm((f) => ({ ...f, zone: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
              <input type="text" placeholder="City" value={buildingForm.city}
                onChange={(e) => setBuildingForm((f) => ({ ...f, city: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="Building Code" value={buildingForm.code}
                onChange={(e) => setBuildingForm((f) => ({ ...f, code: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
              <input type="text" placeholder="Area (e.g. 1200 sqft)" value={buildingForm.area}
                onChange={(e) => setBuildingForm((f) => ({ ...f, area: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
            </div>
            <button onClick={addBuilding} disabled={!buildingForm.name.trim()}
              className="w-full h-9 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              + Add Building
            </button>
          </div>
          {manualBuildings.length > 0 && (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {manualBuildings.map((b, i) => (
                <div key={i} className="flex items-center justify-between bg-mist rounded-lg px-3 py-1.5">
                  <div className="min-w-0">
                    <span className="text-sm text-midnight font-medium">{b.name}</span>
                    {(b.zone || b.city || b.code) && (
                      <span className="text-xs text-steel ml-2">{[b.zone, b.city, b.code].filter(Boolean).join(" · ")}</span>
                    )}
                  </div>
                  <button onClick={() => setManualBuildings((p) => p.filter((_, j) => j !== i))}
                    className="text-steel hover:text-red-500 text-lg leading-none ml-2 flex-shrink-0">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "clients" && (
        <div className="space-y-3">
          <div className="border border-pebble rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-midnight">Import from CSV / Excel</p>
            <div className="flex gap-3 flex-wrap">
              <button type="button" onClick={() => downloadCSV(CLIENTS_CSV, "clients_template.csv")}
                className="h-9 px-3 text-xs border border-pebble rounded-lg text-steel hover:bg-mist flex items-center gap-1.5">
                ↓ Download template
              </button>
              <label className={`h-9 px-3 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                cUploadStatus === "parsed" ? "bg-green-50 border border-green-200 text-green-700"
                  : cUploadStatus === "error" ? "bg-red-50 border border-red-200 text-red-600"
                  : "border border-taskora-red/60 text-taskora-red hover:bg-red-50"
              }`}>
                {cUploadStatus === "parsed" ? `✓ ${cUploadCount} clients ready`
                  : cUploadStatus === "error" ? "✕ Parse error" : "↑ Upload CSV"}
                <input ref={cFileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleClientFile} />
              </label>
            </div>
            {cUploadError && <p className="text-xs text-red-600">{cUploadError}</p>}
          </div>
          <div className="border border-pebble rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-midnight">Add manually</p>
            <input type="text" placeholder="Client name *" value={clientForm.name}
              onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" maxLength={200} />
            <div className="grid grid-cols-2 gap-2">
              <input type="email" placeholder="Contact email" value={clientForm.contact_email}
                onChange={(e) => setClientForm((f) => ({ ...f, contact_email: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
              <input type="text" placeholder="Contact phone" value={clientForm.contact_phone}
                onChange={(e) => setClientForm((f) => ({ ...f, contact_phone: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red" />
            </div>
            <button onClick={addClient} disabled={!clientForm.name.trim()}
              className="w-full h-9 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
              + Add Client
            </button>
          </div>
          {manualClients.length > 0 && (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {manualClients.map((c, i) => (
                <div key={i} className="flex items-center justify-between bg-mist rounded-lg px-3 py-1.5">
                  <div className="min-w-0">
                    <span className="text-sm text-midnight font-medium">{c.name}</span>
                    {c.contact_email && <span className="text-xs text-steel ml-2">{c.contact_email}</span>}
                  </div>
                  <button onClick={() => setManualClients((p) => p.filter((_, j) => j !== i))}
                    className="text-steel hover:text-red-500 text-lg leading-none ml-2 flex-shrink-0">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className={`text-sm mt-3 ${msg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>{msg}</p>}

      <button onClick={handleImport} disabled={importing || !hasData}
        className="mt-4 h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
        {importing ? "Importing…" : "Import"}
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
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    try {
      const s = await apiFetch(`/api/v1/onboarding/status${bizId ? `?business_id=${bizId}` : ""}`);
      setStatus(s);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
        if (!bizId) { setError("No workspace selected. Please sign in again."); setLoading(false); return; }
        const role = await apiFetch(`/api/v1/businesses/${bizId}/my-role`);
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
          <WorkspaceInfoSection status={status} onChanged={reload} />
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
