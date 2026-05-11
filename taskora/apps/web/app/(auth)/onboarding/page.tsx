"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
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
  if (!res.ok) {
    const detail = await res.json().then((d: any) => d.detail ?? `HTTP ${res.status}`).catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

// CSV template content
const BUILDINGS_CSV = `Name,Address\nExample Tower A,123 Main Street Mumbai\nExample Complex B,456 Park Avenue Delhi\n`;
const CLIENTS_CSV   = `Name,Contact Email,Contact Phone\nAcme Corp,contact@acme.com,+91 98765 43210\nTech Solutions,info@techsol.com,+91 87654 32109\n`;

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
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

// Step indicator
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${
            i + 1 === current
              ? "w-6 h-2.5 bg-taskora-red"
              : i + 1 < current
              ? "w-2.5 h-2.5 bg-taskora-red/40"
              : "w-2.5 h-2.5 bg-pebble"
          }`}
        />
      ))}
    </div>
  );
}

// ── Step 1: Business info + workspace mode ───────────────────────────────────
function Step1({
  onDone,
}: {
  onDone: (data: { businessName: string; businessType: "building" | "client"; workspaceMode: "personal" | "organisation"; businessId: string }) => void;
}) {
  const [form, setForm] = useState<{
    businessName: string;
    businessType: "building" | "client";
    workspaceMode: "personal" | "organisation";
  }>({ businessName: "", businessType: "building", workspaceMode: "personal" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.businessName.trim()) return;
    setSubmitting(true); setError("");
    try {
      // Ensure user profile exists
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const meta = (user.user_metadata || {}) as { name?: string };
      await supabase.from("users").upsert(
        { id: user.id, name: meta.name || user.email?.split("@")[0] || "User" },
        { onConflict: "id" }
      );
      // Create business
      const biz = await apiFetch("/api/v1/businesses/", {
        method: "POST",
        body: JSON.stringify({ name: form.businessName.trim(), type: form.businessType }),
      });
      // Save workspace mode
      await apiFetch("/api/v1/onboarding/step1", {
        method: "POST",
        body: JSON.stringify({ workspace_mode: form.workspaceMode }),
      });
      // Persist business_id for the session
      localStorage.setItem("business_id", biz.id);
      onDone({ businessName: form.businessName, businessType: form.businessType, workspaceMode: form.workspaceMode, businessId: biz.id });
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-midnight mb-1">Set up your workspace</h1>
        <p className="text-steel text-sm">This takes about 2 minutes.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-midnight mb-1.5">Workspace name</label>
        <input
          type="text"
          placeholder="e.g. Acme Builders"
          value={form.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          className="w-full h-11 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel/60 focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/15"
          required maxLength={100}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-midnight mb-2">What do you manage?</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: "building" as const, label: "Buildings", desc: "Real estate, construction, facilities" },
            { value: "client"   as const, label: "Clients",   desc: "Agencies, services, consultancies" },
          ].map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => setForm({ ...form, businessType: opt.value })}
              className={`text-left p-4 border rounded-xl transition-all ${
                form.businessType === opt.value
                  ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                  : "border-pebble hover:border-taskora-red/50"
              }`}>
              <div className="font-semibold text-midnight text-sm">{opt.label}</div>
              <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-midnight mb-2">How will you use this?</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: "personal"      as const, label: "For yourself",   icon: "👤", desc: "Track work with named assignees, no logins needed" },
            { value: "organisation"  as const, label: "For your team",  icon: "👥", desc: "Invite colleagues with email to collaborate" },
          ].map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => setForm({ ...form, workspaceMode: opt.value })}
              className={`text-left p-4 border rounded-xl transition-all ${
                form.workspaceMode === opt.value
                  ? "border-taskora-red bg-red-50 ring-1 ring-taskora-red/20"
                  : "border-pebble hover:border-taskora-red/50"
              }`}>
              <div className="text-xl mb-1">{opt.icon}</div>
              <div className="font-semibold text-midnight text-sm">{opt.label}</div>
              <div className="text-xs text-steel mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <button type="submit" disabled={submitting}
        className="w-full h-11 bg-taskora-red text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
        {submitting ? "Setting up…" : "Continue →"}
      </button>
    </form>
  );
}

// ── Step 2: People ───────────────────────────────────────────────────────────
function Step2Personal({
  businessId,
  onContinue,
  onSkip,
}: {
  businessId: string;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function addName() {
    const name = input.trim();
    if (!name) return;
    setSaving(true); setError("");
    try {
      const res = await apiFetch("/api/v1/onboarding/assignees", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNames((prev) => [...prev, res]);
      setInput("");
      inputRef.current?.focus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeName(id: string) {
    setNames((prev) => prev.filter((n) => n.id !== id));
    await apiFetch(`/api/v1/onboarding/assignees/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleContinue() {
    await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false }) }).catch(() => {});
    onContinue();
  }

  async function handleSkip() {
    await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: true }) }).catch(() => {});
    onSkip();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-midnight mb-1">Add people to assign work to</h2>
        <p className="text-steel text-sm">Just their names — no email or account needed. You can always add more in Settings.</p>
      </div>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="e.g. Ravi, Site Supervisor…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } }}
          className="flex-1 h-10 px-3 border border-pebble rounded-lg text-sm text-midnight placeholder:text-steel/60 focus:outline-none focus:border-taskora-red"
          maxLength={100}
        />
        <button onClick={addName} disabled={saving || !input.trim()}
          className="h-10 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          + Add
        </button>
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      {names.length > 0 && (
        <div className="space-y-2">
          {names.map((n) => (
            <div key={n.id} className="flex items-center justify-between bg-mist rounded-lg px-3 py-2">
              <span className="text-sm text-midnight font-medium">{n.name}</span>
              <button onClick={() => removeName(n.id)} className="text-steel hover:text-red-500 text-lg leading-none ml-2">&times;</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={handleSkip}
          className="flex-1 h-10 border border-pebble text-steel text-sm rounded-lg hover:bg-mist">
          Skip for now
        </button>
        <button onClick={handleContinue}
          className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
          Continue →
        </button>
      </div>
    </div>
  );
}

function Step2Org({
  businessId,
  onContinue,
  onSkip,
}: {
  businessId: string;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [invited, setInvited] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function sendInvite() {
    const e = email.trim();
    if (!e) return;
    setSending(true); setError("");
    try {
      await apiFetch("/api/v1/invites/", {
        method: "POST",
        body: JSON.stringify({ email: e, role, business_id: businessId }),
      });
      setInvited((prev) => [...prev, e]);
      setEmail("");
    } catch (err: any) {
      setError(err.message ?? "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  async function handleContinue() {
    await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: false }) }).catch(() => {});
    onContinue();
  }

  async function handleSkip() {
    await apiFetch("/api/v1/onboarding/step2/done", { method: "POST", body: JSON.stringify({ skipped: true }) }).catch(() => {});
    onSkip();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-midnight mb-1">Invite your team</h2>
        <p className="text-steel text-sm">Send invite links to colleagues. You can always do this later in Settings.</p>
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendInvite(); } }}
          className="flex-1 h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="h-10 px-2 border border-pebble rounded-lg text-sm focus:outline-none bg-white text-midnight">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={sendInvite} disabled={sending || !email.trim()}
          className="h-10 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
          Invite
        </button>
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      {invited.length > 0 && (
        <div className="space-y-1.5">
          {invited.map((e) => (
            <div key={e} className="flex items-center gap-2 text-sm text-steel bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <span className="text-green-600">✓</span> Invite sent to <span className="font-medium text-midnight">{e}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={handleSkip}
          className="flex-1 h-10 border border-pebble text-steel text-sm rounded-lg hover:bg-mist">
          Skip for now
        </button>
        <button onClick={handleContinue}
          className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Import entities ──────────────────────────────────────────────────
function Step3({
  businessId,
  businessType,
  onFinish,
  onSkip,
}: {
  businessId: string;
  businessType: "building" | "client";
  onFinish: () => void;
  onSkip: () => void;
}) {
  const label = businessType === "building" ? "Buildings" : "Clients";
  const csvTemplate = businessType === "building" ? BUILDINGS_CSV : CLIENTS_CSV;
  const csvFilename = businessType === "building" ? "buildings_template.csv" : "clients_template.csv";

  const [manualInput, setManualInput] = useState("");
  const [manualList, setManualList] = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsed" | "error">("idle");
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function addManual() {
    const name = manualInput.trim();
    if (!name || manualList.includes(name)) return;
    setManualList((prev) => [...prev, name]);
    setManualInput("");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        const valid = rows.filter((r) => r.name || r["name"]);
        if (valid.length === 0) { setUploadError("No valid rows found. Check the template format."); setUploadStatus("error"); return; }
        setUploadCount(valid.length);
        setUploadStatus("parsed");
        // Store rows in a ref for later submission
        (fileRef as any)._parsed = rows;
      } catch {
        setUploadError("Could not parse file. Please use the downloaded template.");
        setUploadStatus("error");
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true); setImportMsg("");
    try {
      const parsedRows: Record<string, string>[] = (fileRef as any)._parsed ?? [];
      const manualRows = manualList.map((name) => ({ name }));

      if (businessType === "building") {
        const items = [
          ...parsedRows.map((r) => ({ name: r.name ?? r["name"] ?? "", address: r.address ?? r["address"] ?? undefined })),
          ...manualRows,
        ].filter((r) => r.name.trim());
        if (items.length > 0) {
          const res = await apiFetch(`/api/v1/businesses/${businessId}/buildings/bulk`, {
            method: "POST",
            body: JSON.stringify({ items }),
          });
          setImportMsg(`${res.inserted} building${res.inserted !== 1 ? "s" : ""} imported.`);
        }
      } else {
        const items = [
          ...parsedRows.map((r) => ({
            name: r.name ?? r["name"] ?? "",
            contact_email: r["contact email"] || r["contact_email"] || undefined,
            contact_phone: r["contact phone"] || r["contact_phone"] || undefined,
          })),
          ...manualRows,
        ].filter((r) => r.name.trim());
        if (items.length > 0) {
          const res = await apiFetch(`/api/v1/businesses/${businessId}/clients/bulk`, {
            method: "POST",
            body: JSON.stringify({ items }),
          });
          setImportMsg(`${res.inserted} client${res.inserted !== 1 ? "s" : ""} imported.`);
        }
      }

      await apiFetch("/api/v1/onboarding/step3/done", { method: "POST", body: JSON.stringify({ skipped: false }) });
      setTimeout(onFinish, 800);
    } catch (err: any) {
      setImportMsg(`Error: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleSkip() {
    await apiFetch("/api/v1/onboarding/step3/done", { method: "POST", body: JSON.stringify({ skipped: true }) }).catch(() => {});
    onSkip();
  }

  const hasData = uploadStatus === "parsed" || manualList.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-midnight mb-1">Add your {label}</h2>
        <p className="text-steel text-sm">Import a list or add them manually. You can do this later from Settings → Onboarding too.</p>
      </div>

      {/* CSV upload */}
      <div className="border border-pebble rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-midnight">Import from CSV / Excel</p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => downloadCSV(csvTemplate, csvFilename)}
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
              : uploadStatus === "error"
              ? "✕ Parse error"
              : "↑ Upload CSV"}
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      {/* Manual add */}
      <div>
        <p className="text-sm font-medium text-midnight mb-2">Or add manually</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={`${label.slice(0, -1)} name…`}
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
            className="flex-1 h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
            maxLength={100}
          />
          <button onClick={addManual} disabled={!manualInput.trim()}
            className="h-10 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40">
            + Add
          </button>
        </div>
        {manualList.length > 0 && (
          <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto">
            {manualList.map((name) => (
              <div key={name} className="flex items-center justify-between bg-mist rounded-lg px-3 py-1.5">
                <span className="text-sm text-midnight">{name}</span>
                <button onClick={() => setManualList((p) => p.filter((n) => n !== name))}
                  className="text-steel hover:text-red-500 text-lg leading-none ml-2">&times;</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {importMsg && (
        <p className={`text-sm font-medium ${importMsg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
          {importMsg}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={handleSkip}
          className="flex-1 h-10 border border-pebble text-steel text-sm rounded-lg hover:bg-mist">
          Skip for now
        </button>
        <button onClick={hasData ? handleImport : onFinish} disabled={importing}
          className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
          {importing ? "Importing…" : hasData ? "Import & Finish" : "Finish Setup"}
        </button>
      </div>
    </div>
  );
}

// ── Done screen ──────────────────────────────────────────────────────────────
function DoneScreen() {
  const router = useRouter();
  useEffect(() => { const t = setTimeout(() => router.push("/war-room"), 2000); return () => clearTimeout(t); }, [router]);
  return (
    <div className="text-center py-6 space-y-4">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto text-3xl">✓</div>
      <h2 className="text-xl font-bold text-midnight">You're all set!</h2>
      <p className="text-steel text-sm">Taking you to your War Room…</p>
    </div>
  );
}

// ── Main wizard ──────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | "done">(1);
  const [bizData, setBizData] = useState<{
    businessName: string;
    businessType: "building" | "client";
    workspaceMode: "personal" | "organisation";
    businessId: string;
  } | null>(null);
  const [checking, setChecking] = useState(true);

  // If user already has a completed onboarding, redirect them
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { router.replace("/login"); return; }
        const res = await apiFetch("/api/v1/onboarding/status");
        if (res?.onboarding_completed) {
          router.replace("/war-room");
          return;
        }
        // Resume mid-flow if they have a business
        if (res?.business_id) {
          localStorage.setItem("business_id", res.business_id);
          setBizData({
            businessName: "",
            businessType: res.business_type ?? "building",
            workspaceMode: res.workspace_mode ?? "personal",
            businessId: res.business_id,
          });
          if (!res.workspace_mode) { setStep(1); }
          else if (!res.step2_done) { setStep(2); }
          else if (!res.step3_done) { setStep(3); }
          else { router.replace("/war-room"); }
        }
      } catch { /* first-time user, no business yet */ }
      finally { setChecking(false); }
    })();
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist">
        <div className="w-7 h-7 border-2 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mist flex items-center justify-center px-4 py-12">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg p-8">
        {step !== "done" && <StepDots current={step as number} total={3} />}

        {step === 1 && (
          <Step1
            onDone={(data) => {
              setBizData(data);
              setStep(2);
            }}
          />
        )}

        {step === 2 && bizData && (
          bizData.workspaceMode === "personal" ? (
            <Step2Personal
              businessId={bizData.businessId}
              onContinue={() => setStep(3)}
              onSkip={() => setStep(3)}
            />
          ) : (
            <Step2Org
              businessId={bizData.businessId}
              onContinue={() => setStep(3)}
              onSkip={() => setStep(3)}
            />
          )
        )}

        {step === 3 && bizData && (
          <Step3
            businessId={bizData.businessId}
            businessType={bizData.businessType}
            onFinish={() => setStep("done")}
            onSkip={() => setStep("done")}
          />
        )}

        {step === "done" && <DoneScreen />}
      </div>
    </div>
  );
}
