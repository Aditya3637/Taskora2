"use client";

// "Getting Started" widget — shows up at the top of /daily-brief until the
// three workspace-setup checks all pass. Replaces the old amber reminder
// banner and routes into the new Profile / Buildings / Clients tabs.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const DISMISS_KEY = "taskora_getting_started_dismissed_at";
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // re-show after 24 h

async function apiFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Status = {
  business_id: string;
  business_name: string | null;
  business_type: "building" | "client" | null;
  workspace_mode: "personal" | "organisation" | null;
  onboarding_completed: boolean;
  step2_done: boolean;
  step2_skipped: boolean;
  step3_done: boolean;
  step3_skipped: boolean;
};

type CheckItem = {
  key: string;
  label: string;
  done: boolean;
  href: string;
};

export default function OnboardingBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw) {
      const ts = Number(raw);
      if (Date.now() - ts < DISMISS_TTL_MS) {
        setDismissed(true);
        return;
      }
    }
    apiFetch("/api/v1/onboarding/status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  if (dismissed || !status) return null;

  // Three checks. Each maps to the new permanent destination it lives in.
  const entityLabel = status.business_type === "client" ? "clients" : "buildings";
  const entityHref =
    status.business_type === "client"
      ? "/workspace/settings/clients"
      : "/workspace/settings/buildings";
  const peopleLabel = status.workspace_mode === "organisation" ? "team" : "assignees";

  const items: CheckItem[] = [
    {
      key: "identity",
      label: "Name your workspace and pick what you manage",
      done: Boolean(status.business_name && status.business_type),
      href: "/workspace/settings/profile",
    },
    {
      key: "people",
      label: status.workspace_mode
        ? `Add your ${peopleLabel}`
        : "Choose how you'll use this workspace, then add people",
      done: status.step2_done && !status.step2_skipped && !!status.workspace_mode,
      href: status.workspace_mode === "organisation" || !status.workspace_mode
        ? "/workspace/settings"
        : "/workspace/settings",
    },
    {
      key: "entities",
      label: `Import your ${entityLabel}`,
      done: status.step3_done && !status.step3_skipped,
      href: entityHref,
    },
  ];

  const allDone = items.every((i) => i.done);
  if (allDone) return null;

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="bg-white border border-pebble rounded-2xl shadow-sm overflow-hidden mb-6">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-pebble/60">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-midnight">Getting started</p>
          <p className="text-xs text-steel mt-0.5">
            {doneCount} of {items.length} steps complete — finish setup for the best experience.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-steel/60 hover:text-steel text-lg leading-none flex-shrink-0"
          title="Hide for today"
          aria-label="Hide for today"
        >
          &times;
        </button>
      </div>
      <ul className="divide-y divide-pebble/40">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center gap-3 px-5 py-2.5"
          >
            {it.done ? (
              <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
              </span>
            ) : (
              <span className="w-5 h-5 rounded-full border border-pebble flex-shrink-0" />
            )}
            <span
              className={`flex-1 text-sm truncate ${
                it.done ? "text-steel/60 line-through" : "text-midnight"
              }`}
            >
              {it.label}
            </span>
            {!it.done && (
              <Link
                href={it.href}
                className="text-xs font-semibold text-taskora-red hover:underline flex-shrink-0"
              >
                Set up →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
