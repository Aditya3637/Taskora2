"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Bounces a logged-in visitor off the marketing root into the app. Also the
// catch-all for auth-email landings (magic link, email change) when the
// `redirect_to` allow-list at Supabase doesn't match the intended target —
// those flows land here with a freshly-exchanged session.
//
// Special case: a Reset Password email lands here with `#type=recovery&
// access_token=…` in the URL hash (Supabase's implicit flow). We route to
// /reset-password instead of /daily-brief so the user can actually pick a
// new password. We also listen for the PASSWORD_RECOVERY auth event in case
// supabase-js consumes the hash before our hash-sniff runs.
export default function AuthedRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    const isRecovery = () =>
      typeof window !== "undefined" &&
      /(^|[#&])type=recovery(&|$)/.test(window.location.hash);

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        router.replace(isRecovery() ? "/reset-password" : "/daily-brief");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/reset-password");
      } else if (event === "SIGNED_IN") {
        router.replace(isRecovery() ? "/reset-password" : "/daily-brief");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);
  return null;
}
