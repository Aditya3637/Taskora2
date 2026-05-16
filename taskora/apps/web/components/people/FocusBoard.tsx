"use client";
import Link from "next/link";
import { wrLinkHref, type QueueTask } from "@/components/war-room/types";
import { initials, type FocusResp, type PersonCounts } from "./types";

const COUNTER_PILLS: { key: keyof PersonCounts; label: string; tone: string }[] = [
  { key: "open", label: "open", tone: "bg-mist text-steel" },
  { key: "overdue", label: "overdue", tone: "bg-red-50 text-red-700" },
  { key: "blocked", label: "blocked", tone: "bg-amber-50 text-amber-700" },
  { key: "pending_decision", label: "to decide", tone: "bg-purple-50 text-purple-700" },
  { key: "awaiting_their_approval", label: "await appr.", tone: "bg-sky-50 text-ocean" },
  { key: "stale", label: "stale", tone: "bg-mist text-steel/70" },
];

function TaskCard({ task }: { task: QueueTask }) {
  const href = wrLinkHref(task.link);
  const body = (
    <div className="bg-white rounded-lg border border-pebble hover:border-steel transition-colors p-3">
      <p className="text-midnight text-[13px] font-medium leading-snug mb-1.5">
        {task.title}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {task.role_of_person && task.role_of_person !== "primary" && (
          <span className="px-1.5 py-0.5 rounded-full bg-mist text-steel capitalize">
            {task.role_of_person}
          </span>
        )}
        {!!task.days_overdue && task.days_overdue > 0 && (
          <span className="text-red-700 font-semibold">
            {task.days_overdue}d overdue
          </span>
        )}
        {!!task.pending_approvers?.length && (
          <span className="text-ocean">
            ⛳ {task.pending_approvers.join(", ")}
          </span>
        )}
      </div>
      {task.last_comment?.snippet && (
        <p className="mt-1.5 text-[11px] text-steel/80 line-clamp-2">
          “{task.last_comment.snippet}”
        </p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function FocusBoard({
  focus,
  onBack,
}: {
  focus: FocusResp;
  onBack: () => void;
}) {
  const { person, counts, columns } = focus;
  const colLabel = Object.fromEntries(columns.map((c) => [c.key, c.label]));

  return (
    <div className="h-full flex flex-col bg-mist overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-pebble px-4 py-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-steel hover:text-midnight mb-2"
        >
          ← All people
        </button>
        <div className="flex items-center gap-3">
          {person.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={person.avatar_url}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-mist text-steel grid place-items-center text-sm font-semibold">
              {initials(person.name)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-midnight font-semibold text-lg truncate">
              {person.name || "Unnamed"}
            </h1>
            <p className="text-[11px] text-steel">{person.role ?? "member"}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {COUNTER_PILLS.map((p) =>
              counts[p.key] > 0 ? (
                <span
                  key={p.key}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.tone}`}
                >
                  {counts[p.key]} {p.label}
                </span>
              ) : null
            )}
          </div>
        </div>
      </div>

      {/* Program ▸ Initiative swimlanes */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {focus.programs.length === 0 && (
          <p className="text-steel text-sm text-center py-12">
            No work on this person right now.
          </p>
        )}
        {focus.programs.map((pg) => (
          <section key={pg.program_id ?? pg.program_name}>
            <h2 className="text-[12px] font-semibold text-steel uppercase tracking-wide mb-3">
              🗂 {pg.program_name}
            </h2>
            <div className="space-y-4">
              {pg.initiatives.map((ini) => {
                const byCol = new Map<string, QueueTask[]>();
                for (const t of ini.tasks) {
                  const k = t.column ?? "todo";
                  byCol.set(k, [...(byCol.get(k) ?? []), t]);
                }
                const cols = columns.filter((c) => byCol.get(c.key)?.length);
                return (
                  <div
                    key={ini.initiative_id ?? ini.name}
                    className="bg-white/60 rounded-xl border border-pebble p-3"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-midnight font-medium text-sm truncate">
                        {ini.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mist text-steel capitalize">
                        {ini.role_of_person}
                      </span>
                      <span className="text-[11px] text-steel ml-auto">
                        {ini.completion_pct}% done
                      </span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-1">
                      {cols.map((c) => (
                        <div
                          key={c.key}
                          className="w-60 flex-shrink-0"
                        >
                          <p className="text-[11px] font-semibold text-steel mb-2">
                            {colLabel[c.key]}{" "}
                            <span className="text-steel/50">
                              {byCol.get(c.key)!.length}
                            </span>
                          </p>
                          <div className="space-y-2">
                            {byCol.get(c.key)!.map((t) => (
                              <TaskCard key={t.id} task={t} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
