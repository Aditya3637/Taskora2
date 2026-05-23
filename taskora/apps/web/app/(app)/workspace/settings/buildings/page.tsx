"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  FileSpreadsheet,
  Download,
  Upload,
  Plus,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import SettingsTabs from "@/components/SettingsTabs";

type Building = {
  id: string;
  name: string;
  zone?: string | null;
  city?: string | null;
  code?: string | null;
  area?: string | null;
};

const BUILDINGS_CSV = `Building Name,Zone,City,Building Code,Area
Tower A,North Zone,Mumbai,BLD001,1200 sqft
Tower B,South Zone,Delhi,BLD002,800 sqft
`;

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
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

type FormState = { name: string; zone: string; city: string; code: string; area: string };
const EMPTY_FORM: FormState = { name: "", zone: "", city: "", code: "", area: "" };

export default function BuildingsPage() {
  const [businessId, setBusinessId] = useState("");
  const [myRole, setMyRole] = useState<string>("");
  const [items, setItems] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Manual-add form is a less-frequent path than CSV import. Keep it folded
  // by default so the page reads compact, expand on demand.
  const [showManual, setShowManual] = useState(false);

  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsed" | "error">("idle");
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const parsedRef = useRef<Record<string, string>[] | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const biz = await apiFetch("/api/v1/businesses/my");
      const role = await apiFetch(`/api/v1/businesses/${biz.id}/my-role`);
      // Members get a read-only view; admins/owners get import/add/remove controls.
      setMyRole(role?.role ?? "");
      setBusinessId(biz.id);
      const data = await apiFetch(`/api/v1/businesses/${biz.id}/buildings`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load buildings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        const valid = rows.filter((r) => r["building name"] || r["name"]);
        if (!valid.length) {
          setUploadError("No valid rows found. Check the template.");
          setUploadStatus("error");
          return;
        }
        setUploadCount(valid.length);
        setUploadStatus("parsed");
        parsedRef.current = rows;
      } catch {
        setUploadError("Could not parse file.");
        setUploadStatus("error");
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!parsedRef.current || !businessId) return;
    setImporting(true);
    try {
      const buildingItems = parsedRef.current
        .map((r) => ({
          name: r["building name"] || r["name"] || "",
          zone: r["zone"] || undefined,
          city: r["city"] || undefined,
          code: r["building code"] || r["code"] || undefined,
          area: r["area"] || undefined,
        }))
        .filter((r) => r.name.trim());

      if (!buildingItems.length) {
        showToast("No valid rows to import.");
        return;
      }
      const res = await apiFetch(`/api/v1/businesses/${businessId}/buildings/bulk`, {
        method: "POST",
        body: JSON.stringify({ items: buildingItems }),
      });
      showToast(`${res.inserted} building${res.inserted === 1 ? "" : "s"} imported.`);
      parsedRef.current = null;
      setUploadStatus("idle");
      setUploadCount(0);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleAdd() {
    if (!form.name.trim() || !businessId) return;
    setAdding(true);
    try {
      await apiFetch(`/api/v1/businesses/${businessId}/buildings/bulk`, {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              name: form.name.trim(),
              zone: form.zone || undefined,
              city: form.city || undefined,
              code: form.code || undefined,
              area: form.area || undefined,
            },
          ],
        }),
      });
      setForm(EMPTY_FORM);
      showToast("Building added.");
      await load();
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}"?\n\nIt will be deactivated; existing tasks that reference it stay intact.`)) {
      return;
    }
    try {
      await apiFetch(`/api/v1/businesses/${businessId}/buildings/${id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((b) => b.id !== id));
      showToast("Building removed.");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  const filtered = items.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (b.name || "").toLowerCase().includes(q) ||
      (b.code || "").toLowerCase().includes(q) ||
      (b.city || "").toLowerCase().includes(q) ||
      (b.zone || "").toLowerCase().includes(q)
    );
  });

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

  const isAdmin = myRole === "owner" || myRole === "admin";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-midnight text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-midnight">Workspace Settings</h1>
        <p className="text-sm text-steel mt-1">Buildings under this workspace.</p>
      </div>
      <SettingsTabs />

      {/* Add buildings — admins/owners only. CSV is the primary path; manual
          is a one-off escape hatch tucked behind a click. */}
      {isAdmin && (
      <section className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-pebble flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-taskora-red/10 text-taskora-red flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-midnight leading-tight">Add buildings</h2>
            <p className="text-xs text-steel mt-0.5">
              CSV is fastest for 10+ buildings. Add one at a time below.
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* ── Primary: CSV import ─────────────────────────────────── */}
          <div className="relative rounded-xl border border-pebble bg-gradient-to-br from-mist/60 via-white to-white p-5">
            <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-taskora-red/10 text-taskora-red rounded-full">
              Recommended
            </span>
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-white border border-pebble flex items-center justify-center flex-shrink-0 shadow-sm">
                <FileSpreadsheet className="w-5 h-5 text-taskora-red" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-midnight">Import from CSV</p>
                <p className="text-xs text-steel mt-0.5">
                  Download the template, fill it in, and drop it here.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadCSV(BUILDINGS_CSV, "buildings_template.csv")}
                    className="h-9 px-3 text-xs font-medium border border-pebble rounded-lg text-steel bg-white hover:bg-mist hover:text-midnight flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Template
                  </button>

                  <label
                    className={`h-9 px-3.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                      uploadStatus === "parsed"
                        ? "bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                        : uploadStatus === "error"
                        ? "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
                        : "bg-taskora-red text-white hover:opacity-90"
                    }`}
                  >
                    {uploadStatus === "parsed" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {uploadCount} ready
                      </>
                    ) : uploadStatus === "error" ? (
                      <>
                        <AlertCircle className="w-3.5 h-3.5" />
                        Parse error — try again
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        Upload CSV
                      </>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                      onChange={handleFile}
                    />
                  </label>

                  {uploadStatus === "parsed" && (
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="h-9 px-4 bg-midnight text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {importing ? "Importing…" : `Import ${uploadCount}`}
                    </button>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {uploadError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Divider ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-pebble" />
            <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-steel/50">or</span>
            <div className="flex-1 h-px bg-pebble" />
          </div>

          {/* ── Secondary: manual add — dashed CTA, expands inline ──── */}
          {!showManual ? (
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="w-full flex items-center justify-center gap-2 h-11 border border-dashed border-pebble rounded-xl text-sm font-medium text-steel hover:border-taskora-red hover:text-taskora-red hover:bg-red-50/40 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add a building manually
            </button>
          ) : (
            <div className="rounded-xl border border-pebble bg-mist/30 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-midnight">New building</p>
                <button
                  type="button"
                  onClick={() => { setShowManual(false); setForm(EMPTY_FORM); }}
                  className="text-steel hover:text-midnight transition-colors"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Building name *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
                maxLength={200}
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Zone"
                  value={form.zone}
                  onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                  className="h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
                />
                <input
                  type="text"
                  placeholder="City"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Building code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  className="h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
                />
                <input
                  type="text"
                  placeholder="Area (e.g. 1200 sqft)"
                  value={form.area}
                  onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                  className="h-10 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={!form.name.trim() || adding}
                className="w-full h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-opacity"
              >
                {adding ? (
                  "Saving…"
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Add building
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </section>
      )}

      {/* List */}
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-midnight">
                Buildings{" "}
                <span className="text-steel font-normal text-sm ml-1">({items.length})</span>
              </h2>
              <p className="text-xs text-steel mt-1">
                Active buildings in this workspace.
              </p>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, city, zone…"
              className="h-9 w-64 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red flex-shrink-0"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-steel/70">
            {items.length === 0
              ? isAdmin
                ? "No buildings yet. Add some above."
                : "No buildings yet. Ask an admin to add some."
              : `No buildings match “${search}”.`}
          </div>
        ) : (
          <div className="divide-y divide-pebble/50">
            {filtered.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-6 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-midnight text-sm truncate">{b.name}</p>
                  <p className="text-[11px] text-steel/70 truncate">
                    {[b.code, b.zone, b.city, b.area].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(b.id, b.name)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium flex-shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
