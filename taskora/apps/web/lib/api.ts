import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
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
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}
