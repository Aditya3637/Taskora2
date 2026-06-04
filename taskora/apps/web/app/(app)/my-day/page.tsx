"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { PageHeader, EmptyState, Spinner, Badge } from "@/components/ui";
import { Sun, CheckSquare, Stamp, Send, ListChecks, ArrowUpRight } from "lucide-react";

// ── shapes (mirror routers/my_day.py) ────────────────────────────────────
type Task = {
  id: string; title: string; status: string; priority?: string;
  due_date?: string | null; overdue: boolean;
  initiative_id?: string | null; initiative_name?: string;
};
type Approval = {
  id: string; title: string; status: string; priority?: string;
  due_date?: string | null; approval_state: string;
  initiative_id?: string | null; initiative_name?: string;
};
type Delegation = {
  id: string; content: string; sender_id?: string; sender_name?: string;
  source_page_id?: string | null; created_at?: string;
};
type Checklist = {
  id: string; content: string; due_date?: string | null; overdue: boolean;
  status: string; source_page_id?: string | null;
};
type MyDay = {
  user_id: string; business_id: string; generated_at: string;
  tasks: Task[]; approvals: Approval[];
  delegations: Delegation[]; checklist: Checklist[];
  counts: {
    tasks: number; overdue_tasks: number; approvals: number;
    delegations: number; checklist: number;
  };
};

function fmtDue(d?: string | null): string {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function MyDayPage() {
  const router = useRouter();
  const [data, setData] = useState<MyDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Prefer the cached active workspace, but a stale localStorage id 403s with
    // "Not a member" — so reconcile via /businesses/my on the first failure and
    // retry once. (See taskora2-business-id-cache.)
    const cached = typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
    const fetchDay = (bid: string) => apiFetch(`/api/v1/my-day?business_id=${bid}`);
    try {
      let bid = cached;
      try {
        if (!bid) throw new Error("no-cached-workspace");
        setData(await fetchDay(bid));
        return;
      } catch {
        const biz = await apiFetch("/api/v1/businesses/my");
        bid = biz?.id;
        if (!bid) { setError("No active workspace selected."); return; }
        if (typeof window !== "undefined") localStorage.setItem("business_id", bid);
        setData(await fetchDay(bid));
      }
    } catch (e: any) {
      setError(e?.detail || `Failed to load My Day${e?.status ? ` (HTTP ${e.status})` : ""}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-sm text-danger-600">{error}</p>
        <button onClick={load} className="mt-3 px-3 py-1 border border-pebble text-ocean text-xs font-semibold rounded-lg hover:bg-mist">
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  const totalItems =
    data.tasks.length + data.approvals.length +
    data.delegations.length + data.checklist.length;
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-fade-up">
      <PageHeader
        eyebrow={todayLabel}
        title={
          <span className="inline-flex items-center gap-2">
            <Sun className="w-6 h-6 text-amber-500" /> My day
          </span>
        }
        description="Everything on you right now — your tasks, approvals waiting on you, delegations, and checklist. Nothing to hunt for."
        meta={
          totalItems > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {data.counts.overdue_tasks > 0 && (
                <Badge tone="danger">{data.counts.overdue_tasks} overdue</Badge>
              )}
              {data.counts.approvals > 0 && (
                <Badge tone="warn">{data.counts.approvals} to approve</Badge>
              )}
              {data.counts.delegations > 0 && (
                <Badge tone="info">{data.counts.delegations} delegated</Badge>
              )}
            </div>
          ) : null
        }
      />

      {totalItems === 0 ? (
        <div className="py-12">
          <EmptyState
            icon={<Sun className="w-7 h-7" />}
            title="You're all clear."
            description="No open tasks, approvals, delegations, or checklist items need you right now."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* 1. Tasks */}
          <Section
            icon={<CheckSquare className="w-4 h-4" />}
            title="My tasks"
            count={data.tasks.length}
            empty="No open tasks assigned to you."
            items={data.tasks}
            render={(t: Task) => (
              <Row
                key={t.id}
                onClick={() => router.push(`/tasks?task=${t.id}`)}
                title={t.title}
                meta={
                  <>
                    {t.initiative_name && (
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); if (t.initiative_id) router.push(`/tasks?initiative=${t.initiative_id}`); }}
                        className="text-ocean hover:underline"
                      >
                        {t.initiative_name}
                      </span>
                    )}
                    {t.due_date && (
                      <span className={t.overdue ? "text-danger-600 font-medium" : "text-fg-subtle"}>
                        {t.overdue ? "Overdue " : "Due "}{fmtDue(t.due_date)}
                      </span>
                    )}
                  </>
                }
                trailing={t.overdue ? <Badge tone="danger">overdue</Badge> : undefined}
              />
            )}
          />

          {/* 2. Approvals */}
          <Section
            icon={<Stamp className="w-4 h-4" />}
            title="Waiting on your approval"
            count={data.approvals.length}
            empty="Nothing awaiting your approval."
            items={data.approvals}
            render={(a: Approval) => (
              <Row
                key={a.id}
                onClick={() => router.push(`/tasks?task=${a.id}`)}
                title={a.title}
                meta={a.initiative_name && <span className="text-ocean">{a.initiative_name}</span>}
                trailing={<Badge tone="warn">approve</Badge>}
              />
            )}
          />

          {/* 3. Delegations */}
          <Section
            icon={<Send className="w-4 h-4" />}
            title="Delegated to you"
            count={data.delegations.length}
            empty="No pending delegations."
            items={data.delegations}
            render={(d: Delegation) => (
              <Row
                key={d.id}
                onClick={() => router.push("/notebook")}
                title={d.content}
                meta={d.sender_name && <span className="text-fg-subtle">from {d.sender_name}</span>}
                trailing={<Badge tone="info">inbox</Badge>}
              />
            )}
          />

          {/* 4. Checklist */}
          <Section
            icon={<ListChecks className="w-4 h-4" />}
            title="My checklist"
            count={data.checklist.length}
            empty="Nothing due soon on your checklist."
            items={data.checklist}
            render={(c: Checklist) => (
              <Row
                key={c.id}
                onClick={() => router.push("/notebook")}
                title={c.content}
                meta={
                  c.due_date && (
                    <span className={c.overdue ? "text-danger-600 font-medium" : "text-fg-subtle"}>
                      {c.overdue ? "Overdue " : "Due "}{fmtDue(c.due_date)}
                    </span>
                  )
                }
                trailing={c.overdue ? <Badge tone="danger">overdue</Badge> : undefined}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

// ── presentational helpers ────────────────────────────────────────────────
function Section<T>({
  icon, title, count, empty, items, render,
}: {
  icon: React.ReactNode; title: string; count: number; empty: string;
  items: T[]; render: (item: T) => React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-fg-muted">{icon}</span>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {count > 0 && <span className="text-xs text-fg-subtle">{count}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-subtle px-1 py-2">{empty}</p>
      ) : (
        <div className="rounded-xl border border-pebble divide-y divide-pebble overflow-hidden">
          {items.map(render)}
        </div>
      )}
    </section>
  );
}

function Row({
  title, meta, trailing, onClick,
}: {
  title: string; meta?: React.ReactNode; trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-mist transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg truncate">{title}</div>
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs mt-0.5">{meta}</div>}
      </div>
      {trailing}
      <ArrowUpRight className="w-3.5 h-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}
