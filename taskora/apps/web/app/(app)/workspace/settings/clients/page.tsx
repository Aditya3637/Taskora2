"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import SettingsTabs from "@/components/SettingsTabs";

type Client = {
  id: string;
  name: string;
  code?: string | null;
  contact_info?: { email?: string; phone?: string } | null;
};

const CLIENTS_CSV = `Name,Client Code,Contact Email,Contact Phone
Acme Corp,CLI001,contact@acme.com,+91 98765 43210
Tech Solutions,CLI002,info@techsol.com,+91 87654 32109
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

type FormState = { name: string; code: string; contact_email: string; contact_phone: string };
const EMPTY_FORM: FormState = { name: "", code: "", contact_email: "", contact_phone: "" };

export default function ClientsPage() {
  const [businessId, setBusinessId] = useState("");
  const [myRole, setMyRole] = useState<string>("");
  const [items, setItems] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

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
      const data = await apiFetch(`/api/v1/businesses/${biz.id}/clients`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load clients.");
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
        const valid = rows.filter((r) => r.name);
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
      const clientItems = parsedRef.current
        .map((r) => ({
          name: r.name ?? "",
          code: r["client code"] || r["code"] || undefined,
          contact_email: r["contact email"] || r.contact_email || undefined,
          contact_phone: r["contact phone"] || r.contact_phone || undefined,
        }))
        .filter((r) => r.name.trim());

      if (!clientItems.length) {
        showToast("No valid rows to import.");
        return;
      }
      const res = await apiFetch(`/api/v1/businesses/${businessId}/clients/bulk`, {
        method: "POST",
        body: JSON.stringify({ items: clientItems }),
      });
      showToast(`${res.inserted} client${res.inserted === 1 ? "" : "s"} imported.`);
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
      await apiFetch(`/api/v1/businesses/${businessId}/clients/bulk`, {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              name: form.name.trim(),
              code: form.code || undefined,
              contact_email: form.contact_email || undefined,
              contact_phone: form.contact_phone || undefined,
            },
          ],
        }),
      });
      setForm(EMPTY_FORM);
      showToast("Client added.");
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
      await apiFetch(`/api/v1/businesses/${businessId}/clients/${id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((c) => c.id !== id));
      showToast("Client removed.");
    } catch (e: any) {
      showToast(`Error: ${e.message}`);
    }
  }

  const filtered = items.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.code || "").toLowerCase().includes(q) ||
      (c.contact_info?.email || "").toLowerCase().includes(q)
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
        <p className="text-sm text-steel mt-1">Clients under this workspace.</p>
      </div>
      <SettingsTabs />

      {/* Import + manual add — admins/owners only */}
      {isAdmin && (
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <h2 className="font-semibold text-midnight">Add clients</h2>
          <p className="text-xs text-steel mt-1">
            Bulk import a CSV or add one at a time.
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="border border-pebble rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-midnight">Import from CSV</p>
            <div className="flex gap-3 flex-wrap items-center">
              <button
                type="button"
                onClick={() => downloadCSV(CLIENTS_CSV, "clients_template.csv")}
                className="h-9 px-3 text-xs border border-pebble rounded-lg text-steel hover:bg-mist flex items-center gap-1.5"
              >
                ↓ Download template
              </button>
              <label
                className={`h-9 px-3 text-xs rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                  uploadStatus === "parsed"
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : uploadStatus === "error"
                    ? "bg-red-50 border border-red-200 text-red-600"
                    : "border border-taskora-red/60 text-taskora-red hover:bg-red-50"
                }`}
              >
                {uploadStatus === "parsed"
                  ? `✓ ${uploadCount} clients ready`
                  : uploadStatus === "error"
                  ? "✕ Parse error"
                  : "↑ Upload CSV"}
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
                  className="h-9 px-4 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              )}
            </div>
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
          </div>

          <div className="border border-pebble rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-midnight">Add manually</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Client Name *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
                maxLength={200}
              />
              <input
                type="text"
                placeholder="Client Code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="email"
                placeholder="Contact email"
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
              />
              <input
                type="text"
                placeholder="Contact phone"
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                className="h-9 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!form.name.trim() || adding}
              className="w-full h-9 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {adding ? "Saving…" : "+ Add Client"}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* List */}
      <div className="bg-white rounded-2xl border border-pebble shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-pebble">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-midnight">
                Clients{" "}
                <span className="text-steel font-normal text-sm ml-1">({items.length})</span>
              </h2>
              <p className="text-xs text-steel mt-1">
                Active clients in this workspace.
              </p>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, email…"
              className="h-9 w-64 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red flex-shrink-0"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-steel/70">
            {items.length === 0
              ? isAdmin
                ? "No clients yet. Add some above."
                : "No clients yet. Ask an admin to add some."
              : `No clients match “${search}”.`}
          </div>
        ) : (
          <div className="divide-y divide-pebble/50">
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-6 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-midnight text-sm truncate">{c.name}</p>
                  <p className="text-[11px] text-steel/70 truncate">
                    {[c.code, c.contact_info?.email, c.contact_info?.phone]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(c.id, c.name)}
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
