"use client";
import {
  initials,
  relativeTime,
  type PersonInitiative,
  type PersonSummary,
  type SpotlightTask,
} from "./types";

function pushTone(score: number): string {
  if (score >= 10) return "bg-red-50 text-red-700 border-red-200";
  if (score >= 4) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-mist text-steel border-pebble";
}

const SEGMENTS: { key: keyof PersonSummary["workload"]; cls: string }[] = [
  { key: "overdue", cls: "bg-red-400" },
  { key: "blocked", cls: "bg-amber-400" },
  { key: "pending_decision", cls: "bg-purple-400" },
  { key: "open", cls: "bg-steel/30" },
  { key: "done", cls: "bg-emerald-400" },
];

function WorkloadBar({ w }: { w: PersonSummary["workload"] }) {
  const total = SEGMENTS.reduce((n, s) => n + w[s.key], 0);
  if (!total)
    return <div className="h-1.5 rounded-full bg-mist" aria-hidden />;
  return (
    <div
      className="h-1.5 rounded-full bg-mist overflow-hidden flex"
      aria-hidden
    >
      {SEGMENTS.map((s) =>
        w[s.key] > 0 ? (
          <div
            key={s.key}
            className={s.cls}
            style={{ flexGrow: w[s.key], minWidth: 3 }}
          />
        ) : null
      )}
    </div>
  );
}

function spotlightReason(t: SpotlightTask): { text: string; cls: string } {
  if (t.days_overdue > 0)
    return { text: `${t.days_overdue}d overdue`, cls: "text-red-700" };
  if (t.column === "blocked") return { text: "blocked", cls: "text-amber-700" };
  if (t.column === "needs_decision")
    return { text: "to decide", cls: "text-purple-700" };
  if (t.column === "awaiting_approval")
    return { text: "approval", cls: "text-ocean" };
  if (t.column === "in_progress")
    return { text: "in progress", cls: "text-steel" };
  return { text: "to do", cls: "text-steel" };
}

function InitiativeRow({ i }: { i: PersonInitiative }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-midnight truncate flex-1 min-w-0">
        {i.name}
        {i.leads && (
          <span className="text-ocean ml-1" title="Leads this initiative">
            ●
          </span>
        )}
      </span>
      <span className="w-12 h-1 rounded-full bg-mist overflow-hidden flex-shrink-0">
        <span
          className="block h-full bg-ocean"
          style={{ width: `${i.completion_pct}%` }}
        />
      </span>
      <span className="text-steel tabular-nums w-8 text-right flex-shrink-0">
        {i.completion_pct}%
      </span>
      <span className="w-10 text-right flex-shrink-0 font-semibold">
        {i.overdue > 0 && <span className="text-red-700">{i.overdue}!</span>}
        {i.blocked > 0 && (
          <span className="text-amber-700 ml-1">{i.blocked}■</span>
        )}
      </span>
    </div>
  );
}

export function PersonCard({
  person,
  onOpen,
}: {
  person: PersonSummary;
  onOpen: (id: string) => void;
}) {
  const c = person.counts;
  const stat = (label: string, n: number, tone: string) =>
    n > 0 ? (
      <span className={tone}>
        {n} {label}
      </span>
    ) : null;

  return (
    <button
      onClick={() => onOpen(person.user_id)}
      className="text-left w-full bg-white rounded-xl border border-pebble hover:border-steel hover:shadow-md transition-all p-4 flex flex-col gap-3"
    >
      {/* Zone 1 — identity + workload */}
      <div className="flex items-start gap-3">
        {person.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.avatar_url}
            alt=""
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-mist text-steel grid place-items-center text-xs font-semibold flex-shrink-0">
            {initials(person.name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-midnight font-semibold text-sm truncate">
            {person.name || "Unnamed"}
          </p>
          <p className="text-[11px] text-steel truncate">
            {person.role ?? "member"} · {relativeTime(person.last_active)} ·
            leads {person.initiatives_led}
          </p>
        </div>
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${pushTone(
            person.push_score
          )}`}
          title="Push score — how much this person needs attention"
        >
          {person.push_score}
        </span>
      </div>

      <div className="space-y-1.5">
        <WorkloadBar w={person.workload} />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          <span className="text-steel">{c.open} open</span>
          {stat("overdue", c.overdue, "text-red-700 font-semibold")}
          {stat("blocked", c.blocked, "text-amber-700 font-semibold")}
          {stat("to decide", c.pending_decision, "text-purple-700 font-semibold")}
          {stat(
            "await appr.",
            c.awaiting_their_approval,
            "text-ocean font-semibold"
          )}
          {stat("stale", c.stale, "text-steel/70")}
        </div>
      </div>

      {/* Zone 2 — on now */}
      {person.spotlight.length > 0 && (
        <div className="border-t border-pebble pt-2.5">
          <p className="text-[10px] font-semibold text-steel/70 uppercase tracking-wide mb-1.5">
            On now
          </p>
          <ul className="space-y-1">
            {person.spotlight.map((t) => {
              const r = spotlightReason(t);
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span className="text-steel/40">•</span>
                  <span className="text-midnight truncate flex-1 min-w-0">
                    {t.title}
                  </span>
                  <span
                    className={`${r.cls} font-medium flex-shrink-0 text-[11px]`}
                  >
                    {r.text}
                  </span>
                  {t.initiative_name && (
                    <span className="text-steel/60 truncate max-w-[5.5rem] flex-shrink-0 text-[11px]">
                      {t.initiative_name}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Zone 3 — initiatives */}
      {person.initiatives.length > 0 && (
        <div className="border-t border-pebble pt-2.5">
          <p className="text-[10px] font-semibold text-steel/70 uppercase tracking-wide mb-1.5">
            Initiatives
          </p>
          <div className="space-y-1.5">
            {person.initiatives.map((i) => (
              <InitiativeRow key={i.initiative_id} i={i} />
            ))}
          </div>
        </div>
      )}
    </button>
  );
}
