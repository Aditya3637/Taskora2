"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn, useToast } from "@/components/ui";

type Counts = { overdue: number; pending: number; blocked: number; due_week: number };
type Nudge = {
  user_id: string;
  user_name: string;
  phone_number: string | null;
  message: string;
  wa_link: string;
  counts: Counts;
};

function stuck(c: Counts): number {
  return c.overdue + c.pending + c.blocked;
}

export default function NudgesPage() {
  const { toast } = useToast();
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    setLoading(true);
    try {
      const data = await apiFetch("/api/v1/whatsapp/digest", {
        method: "POST",
        body: JSON.stringify({ business_id: bid }),
      });
      const all: Nudge[] = Array.isArray(data?.messages) ? data.messages : [];
      // Only people with stuck work, worst first.
      const withStuck = all
        .filter((n) => stuck(n.counts) > 0)
        .sort((a, b) => stuck(b.counts) - stuck(a.counts));
      setNudges(withStuck);
      setActiveId(withStuck[0]?.user_id ?? null);
    } catch {
      setNudges([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = nudges.find((n) => n.user_id === activeId) ?? null;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Paste it into WhatsApp.", variant: "success" });
    } catch {
      toast({ title: "Couldn’t copy", variant: "error" });
    }
  }

  function summary(c: Counts): string {
    const parts: string[] = [];
    if (c.overdue) parts.push(`${c.overdue} overdue`);
    if (c.blocked) parts.push(`${c.blocked} blocked`);
    if (c.pending) parts.push(`${c.pending} awaiting decision`);
    return parts.join(" · ") || "all clear";
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <h1 className="text-xl font-bold text-midnight mb-1">Nudges</h1>
      <p className="text-sm text-steel mb-4">
        Per-person follow-ups for what&rsquo;s overdue, blocked or awaiting a decision — formatted to copy straight into WhatsApp.
      </p>

      {loading ? (
        <p className="text-sm text-steel py-10 text-center">Loading…</p>
      ) : nudges.length === 0 ? (
        <div className="rounded-xl border border-pebble bg-white px-4 py-12 text-center">
          <p className="text-[15px] font-semibold text-midnight">Nobody&rsquo;s stuck 🎉</p>
          <p className="text-[12.5px] text-steel mt-1">No overdue, blocked or pending-decision work right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
          {/* Left: people with stuck work */}
          <div className="rounded-xl border border-pebble bg-white overflow-hidden h-fit">
            <div className="px-3 py-2 text-[10.5px] uppercase tracking-wide text-steel/70 border-b border-pebble">
              Stuck · {nudges.length}
            </div>
            {nudges.map((n) => (
              <button
                key={n.user_id}
                type="button"
                onClick={() => setActiveId(n.user_id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-t border-pebble/60 first:border-t-0 transition-colors",
                  n.user_id === activeId ? "bg-mist" : "hover:bg-mist/50",
                )}
              >
                <div className="text-[13px] font-medium text-midnight truncate">{n.user_name}</div>
                <div className={cn("text-[11.5px]", n.counts.overdue > 0 ? "text-taskora-red" : "text-steel")}>
                  {summary(n.counts)}
                </div>
              </button>
            ))}
          </div>

          {/* Right: the message */}
          <div className="rounded-xl border border-pebble bg-white p-4">
            {active && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-midnight">{active.user_name}</div>
                    <div className="text-[11.5px] text-steel">{summary(active.counts)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(active.message)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-pebble text-[12.5px] font-semibold text-midnight hover:bg-mist"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </button>
                  <a
                    href={active.wa_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#25D366] text-white text-[12.5px] font-semibold hover:opacity-90"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-xl bg-[#F7FBF5] border border-pebble/70 p-4 text-[13px] leading-relaxed text-[#1f2a22] font-sans">
                  {active.message}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
