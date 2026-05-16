"use client";
import { initials, type PersonSummary } from "./types";

function pushTone(score: number): string {
  if (score >= 10) return "bg-red-50 text-red-700 border-red-200";
  if (score >= 4) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-mist text-steel border-pebble";
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
            {person.role ?? "member"} · leads {person.initiatives_led} ·{" "}
            {person.programs_touched} program
            {person.programs_touched === 1 ? "" : "s"}
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
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
    </button>
  );
}
