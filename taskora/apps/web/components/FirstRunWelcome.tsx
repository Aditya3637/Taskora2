"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { Dialog } from "@/components/ui";

/**
 * G7 — one-time first-run for a JOINING member (not the owner, who built the
 * workspace). Gated on `/my-role` returning onboarded=false; dismissing marks
 * the member onboarded so it never shows again. Mounted globally in the app
 * layout so it appears wherever the joiner first lands.
 */
export default function FirstRunWelcome() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meId, setMeId] = useState("");
  const [bizId, setBizId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
      if (!bid) return;
      try {
        const [{ data: { user } }, role] = await Promise.all([
          supabase.auth.getUser(),
          apiFetch(`/api/v1/businesses/${bid}/my-role`),
        ]);
        if (cancelled) return;
        if (role && role.role !== "owner" && role.onboarded === false) {
          setMeId(user?.id || "");
          setBizId(bid);
          setOpen(true);
        }
      } catch { /* non-critical — don't block the app on this */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function dismiss() {
    setSaving(true);
    try {
      if (meId && bizId) {
        await apiFetch(`/api/v1/businesses/${bizId}/members/${meId}/onboarded`, {
          method: "PATCH",
          body: JSON.stringify({ onboarded: true }),
        });
      }
    } catch { /* even on failure, don't nag again this session */ }
    setOpen(false);
    setSaving(false);
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) dismiss(); }}
      title="Welcome to the workspace 👋"
      description="Here's where to start — your work shows up across these areas."
      footer={
        <button
          type="button"
          onClick={dismiss}
          disabled={saving}
          className="h-9 rounded-lg bg-midnight px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "…" : "Got it"}
        </button>
      }
    >
      <ul className="space-y-2 text-[13px] text-steel">
        <li>• <b className="text-midnight">My Day &amp; Daily Brief</b> — what needs you today.</li>
        <li>• <b className="text-midnight">Programs &amp; Tasks</b> — the initiatives you&rsquo;re aligned to.</li>
        <li>• <b className="text-midnight">The bell</b> (top-right) — assignments, approvals &amp; mentions land here.</li>
      </ul>
    </Dialog>
  );
}
