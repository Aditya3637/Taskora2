"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const DISMISS_KEY = "taskora_onboarding_banner_dismissed_at";
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
  step2_skipped: boolean;
  step3_skipped: boolean;
  onboarding_completed: boolean;
  workspace_mode: "personal" | "organisation" | null;
  business_type: "building" | "client" | null;
};

export default function OnboardingBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check dismiss cooldown
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw) {
      const ts = Number(raw);
      if (Date.now() - ts < DISMISS_TTL_MS) { setDismissed(true); return; }
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
  if (status.onboarding_completed && !status.step2_skipped && !status.step3_skipped) return null;

  const entityLabel = status.business_type === "client" ? "clients" : "buildings";
  const peopleLabel = status.workspace_mode === "personal" ? "assignees" : "team members";

  const items: string[] = [];
  if (status.step2_skipped) items.push(`Add your ${peopleLabel}`);
  if (status.step3_skipped) items.push(`Import your ${entityLabel} list`);

  if (items.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800 mb-1">
          Complete your workspace setup for the best experience
        </p>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-amber-700">
              <span className="text-amber-400">○</span>
              {item} —{" "}
              <Link
                href="/workspace/settings/onboarding"
                className="underline underline-offset-2 hover:text-amber-900 font-medium"
              >
                Complete in Settings
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <button
        onClick={dismiss}
        className="text-amber-500 hover:text-amber-800 text-xl leading-none flex-shrink-0 mt-0.5"
        title="Dismiss for today"
      >
        &times;
      </button>
    </div>
  );
}
