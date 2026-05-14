"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || (session.expires_at ?? 0) < Math.floor(Date.now() / 1000) + 30) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }
  if (!session) throw new Error("Session expired — please sign in again.");
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
}

type InviteInfo = {
  id: string;
  business_name: string;
  invited_by_name: string;
  role: string;
  status: string;
  expires_at: string;
};

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string;
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    fetch(`${API}/api/v1/invites/${token}`)
      .then(r => r.json())
      .then(data => { setInvite(data); setLoading(false); })
      .catch(() => { setError("Invite not found or expired"); setLoading(false); });
  }, [token]);

  async function respond(action: "accept" | "decline") {
    setActing(true);
    try {
      const res = await apiFetch(`/api/v1/invites/${token}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setDone(action === "accept" ? "accepted" : "declined");
      if (action === "accept") {
        setTimeout(() => router.push("/daily-brief"), 1500);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist">
        <div className="animate-spin w-8 h-8 border-4 border-pebble border-t-midnight rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mist flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
        <p className="text-5xl mb-4">🤝</p>
        <h1 className="text-xl font-bold text-midnight mb-2">Team Invitation</h1>

        {error && !invite && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mt-4 text-sm">{error}</div>
        )}

        {invite && invite.status !== "pending" && (
          <div className="mt-4">
            <p className="text-steel">This invitation has already been <strong>{invite.status}</strong>.</p>
          </div>
        )}

        {invite && invite.status === "pending" && !done && (
          <>
            <p className="text-steel text-sm mb-1">
              <strong className="text-midnight">{invite.invited_by_name}</strong> has invited you to join
            </p>
            <p className="text-2xl font-bold text-midnight mb-1">{invite.business_name}</p>
            <span className="inline-block bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium capitalize mb-6">
              as {invite.role}
            </span>

            {!session ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                <p className="font-medium mb-2">You need to be logged in to accept this invitation.</p>
                <Link href={`/login?redirect=/invite/${token}`}
                  className="inline-block px-4 py-2 bg-midnight text-white rounded-lg font-medium hover:opacity-90">
                  Log In First
                </Link>
              </div>
            ) : (
              <div className="flex gap-3">
                <button onClick={() => respond("decline")} disabled={acting}
                  className="flex-1 h-11 border border-pebble text-steel rounded-lg font-medium hover:text-midnight hover:border-midnight transition-colors disabled:opacity-50">
                  {acting ? "…" : "Decline"}
                </button>
                <button onClick={() => respond("accept")} disabled={acting}
                  className="flex-1 h-11 bg-midnight text-white rounded-lg font-semibold hover:opacity-90 disabled:opacity-50">
                  {acting ? "Joining…" : "Accept Invitation"}
                </button>
              </div>
            )}
          </>
        )}

        {done === "accepted" && (
          <div className="mt-4">
            <p className="text-5xl mb-3">🎉</p>
            <p className="font-bold text-midnight">Welcome to {invite?.business_name}!</p>
            <p className="text-steel text-sm mt-1">Redirecting you to the app…</p>
          </div>
        )}

        {done === "declined" && (
          <div className="mt-4">
            <p className="text-steel">Invitation declined.</p>
            <Link href="/daily-brief" className="text-ocean text-sm underline mt-2 block">Go to app →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
