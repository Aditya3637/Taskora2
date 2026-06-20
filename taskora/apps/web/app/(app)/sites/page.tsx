"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Users, Smartphone, FileText } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/ui";
import { WorkDocPanel } from "../programs/_components/WorkDocPanel";

type Site = {
  id: string;
  name: string;
  kind: "building" | "client";
  zone?: string | null;
  city?: string | null;
  code?: string | null;
  tasks: number;
  initiatives: number;
  open: number;
  overdue: number;
  blocked: number;
  next_deadline: string | null;
  health: "ok" | "warn" | "bad";
};

const HEALTH_BAR: Record<Site["health"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-taskora-red",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function SitesPage() {
  const [kind, setKind] = useState<"building" | "client">("building");
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSite, setOpenSite] = useState<Site | null>(null);
  const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";

  const load = useCallback(async (k: "building" | "client") => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/v1/businesses/${bid}/sites?kind=${k}`);
      setSites(Array.isArray(data) ? data : []);
    } catch {
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(kind); }, [kind, load]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-bold text-midnight">Sites</h1>
        <Link
          href="/field"
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-pebble text-[12.5px] font-semibold text-midnight hover:bg-mist"
        >
          <Smartphone className="h-3.5 w-3.5" /> Field update
        </Link>
      </div>
      <p className="text-sm text-steel mb-4">
        Every {kind === "building" ? "building" : "client"} and the work happening at it — across all programmes.
      </p>

      <div className="inline-flex rounded-lg border border-pebble overflow-hidden mb-4">
        <button
          type="button"
          onClick={() => setKind("building")}
          className={cn("inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium",
            kind === "building" ? "bg-midnight text-white" : "text-steel hover:bg-mist")}
        >
          <Building2 className="h-3.5 w-3.5" /> Buildings
        </button>
        <button
          type="button"
          onClick={() => setKind("client")}
          className={cn("inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium border-l border-pebble",
            kind === "client" ? "bg-midnight text-white" : "text-steel hover:bg-mist")}
        >
          <Users className="h-3.5 w-3.5" /> Clients
        </button>
      </div>

      <div className="rounded-xl border border-pebble overflow-hidden bg-white">
        <div className="grid grid-cols-[1fr_140px_120px_90px] gap-3 px-4 h-9 items-center bg-mist/40 text-[11px] uppercase tracking-wide text-steel/70">
          <span>{kind === "building" ? "Building" : "Client"}</span>
          <span>Across</span>
          <span>Next deadline</span>
          <span>Health</span>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-steel">Loading…</p>
        ) : sites.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-steel">No {kind}s yet.</p>
        ) : (
          sites.map((s) => {
            const pct = s.tasks > 0 ? Math.round(((s.tasks - s.open) / s.tasks) * 100) : 0;
            return (
              <div key={s.id} className="grid grid-cols-[1fr_140px_120px_90px] gap-3 px-4 py-2.5 items-center border-t border-pebble/60">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setOpenSite(s)}
                    className="text-[13.5px] font-medium text-midnight truncate flex items-center gap-2 hover:text-taskora-red group"
                  >
                    <span className={cn("h-2 w-2 rounded-full flex-shrink-0", HEALTH_BAR[s.health])} />
                    <span className="truncate">{s.name}</span>
                    <FileText className="h-3.5 w-3.5 text-steel/40 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                  </button>
                  <div className="text-[11.5px] text-steel truncate">
                    {[s.zone, s.city, s.code].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <span className="text-[12.5px] text-steel">
                  {s.initiatives} initiative{s.initiatives === 1 ? "" : "s"} · {s.tasks} task{s.tasks === 1 ? "" : "s"}
                </span>
                <span className={cn("text-[12.5px]", s.overdue > 0 ? "text-taskora-red font-medium" : "text-steel")}>
                  {s.overdue > 0 ? `overdue · ${fmtDate(s.next_deadline)}` : fmtDate(s.next_deadline)}
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-14 rounded-full bg-pebble overflow-hidden">
                    <div className={cn("h-full rounded-full", HEALTH_BAR[s.health])} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {openSite && bid && (
        <WorkDocPanel
          initiativeId={openSite.id}
          initiativeName={openSite.name}
          onClose={() => setOpenSite(null)}
          docsBasePath={`/api/v1/entities/${openSite.id}/docs?business_id=${bid}`}
          headerName={openSite.name}
          headerSub={openSite.kind === "building" ? "Building plan" : "Client plan"}
          backlinksPath={null}
          promotePath={null}
        />
      )}
    </div>
  );
}
