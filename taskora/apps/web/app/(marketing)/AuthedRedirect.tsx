"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Bounces a logged-in visitor off the marketing root into the app. This is
// also the catch-all for auth-email landings (magic link, email change) —
// Supabase's default Site URL is `https://taskora.deftai.in`, so those flows
// land here with a freshly-exchanged session and we route them to
// /daily-brief. Reset Password sends to /reset-password explicitly.
export default function AuthedRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) router.replace("/daily-brief");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
