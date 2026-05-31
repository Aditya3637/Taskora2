import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Shape of the error apiFetch throws on a non-2xx response. Callers can
 * branch on `status` (e.g. retry on 5xx, redirect on 401) and surface
 * `detail` to the user when present.
 */
export interface ApiError extends Error {
  status?: number;
  detail?: unknown;
}

// Timeout for the Supabase session fetch. supabase-js's getSession()
// acquires a `navigator.locks` mutex; if a prior tab errored mid-fetch
// the lock can stay held, hanging every subsequent call indefinitely
// (the "auth lock wedge" bug — see project memory). A 6s race makes it
// fail loudly so the user gets a real error + reload instead of an
// infinite spinner.
const _SESSION_TIMEOUT_MS = 6000;

async function getSessionWithTimeout(): Promise<{ data: { session: any } }> {
  return Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Session lookup timed out — try reloading the tab.")), _SESSION_TIMEOUT_MS),
    ),
  ]);
}

export async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await getSessionWithTimeout();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: any) => d.detail ?? d.message ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    // FastAPI 422 returns `detail` as a list of {loc,msg} objects — String()
    // on that yields "[object Object]". Flatten to readable text.
    const msg = Array.isArray(detail)
      ? detail.map((e: any) => e?.msg ?? JSON.stringify(e)).join("; ")
      : typeof detail === "object" && detail !== null
        ? JSON.stringify(detail)
        : String(detail);
    const err: ApiError = new Error(msg);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
