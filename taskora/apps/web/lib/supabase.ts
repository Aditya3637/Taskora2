import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * getSession() reads the auth token behind a navigator LockManager lock. When
 * several tabs of the same origin are open the lock can wedge, leaving the
 * promise pending forever and freezing any UI that awaits it (e.g. the
 * "Loading your workspace…" gate). Race it against a timeout so a wedged lock
 * degrades to "no session" instead of hanging the page; callers already treat
 * a null session as a recoverable state.
 */
export async function getSessionSafe(timeoutMs = 4000) {
  try {
    return await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getSession timed out")), timeoutMs),
      ),
    ]);
  } catch {
    return { data: { session: null } };
  }
}
