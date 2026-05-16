"use client";
import { useRouter } from "next/navigation";
import { wrLinkHref, type QueueTask } from "./types";

export function WarRoomTicker({ queue }: { queue: QueueTask[] }) {
  const router = useRouter();

  // Real headlines from the live queue, worst-first. No data → calm message.
  const items = [...queue]
    .sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue))
    .map((t) => {
      const where = t.initiative_name ? ` (${t.initiative_name})` : "";
      const why =
        t.status === "blocked"
          ? `blocked${t.blocker_reason ? `: ${t.blocker_reason}` : ""}`
          : "pending decision";
      const od = t.days_overdue ? ` · ${t.days_overdue}d overdue` : "";
      return { id: t.id, link: t.link, text: `${t.title}${where} — ${why}${od}` };
    });

  return (
    <div className="bg-gradient-to-r from-[#991B1B] to-taskora-red h-10 flex items-center overflow-hidden flex-shrink-0">
      <div className="animate-marquee whitespace-nowrap text-white text-sm font-medium px-4">
        {items.length === 0 ? (
          <span>✓ No blocked or pending-decision items — you’re clear.</span>
        ) : (
          items.map((it, i) => {
            const href = wrLinkHref(it.link);
            return (
              <span key={it.id}>
                {i > 0 && <span className="mx-3 text-white/50">·</span>}
                <button
                  onClick={() => href && router.push(href)}
                  className="hover:underline"
                  title="Open task"
                >
                  ⚠ {it.text}
                </button>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
