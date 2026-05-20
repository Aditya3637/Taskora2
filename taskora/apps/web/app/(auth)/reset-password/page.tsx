"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Landing for the Reset Password email. Supabase verifies the token and
// redirects here with ?code=… (PKCE flow); @supabase/ssr's createBrowserClient
// auto-exchanges that code for a recovery session before this component
// mounts. We just confirm a session is present and let the user set a new
// password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Give the SSR client a tick to finish the code-for-session exchange
      // before we read the session. The exchange happens on first mount.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setHasSession(!!data.session);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setDone(true);
    // Land them in the app instead of bouncing back to /login — they're
    // already authenticated from the recovery session.
    setTimeout(() => router.push("/daily-brief"), 1200);
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist px-4">
        <p className="text-steel text-sm">Loading…</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist px-4">
        <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md text-center">
          <p className="text-5xl mb-4">⌛</p>
          <h1 className="text-2xl font-bold text-midnight mb-2">Link expired</h1>
          <p className="text-steel text-sm">
            This reset link is invalid or has expired. Request a new one from
            the login page.
          </p>
          <Link
            href="/login"
            className="inline-block mt-6 text-ocean font-medium underline underline-offset-2"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist px-4">
        <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md text-center">
          <p className="text-5xl mb-4">✅</p>
          <h1 className="text-2xl font-bold text-midnight mb-2">Password updated</h1>
          <p className="text-steel text-sm">Taking you to your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mist px-4">
      <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md">
        <h1 className="text-2xl font-bold text-midnight mb-2">Set a new password</h1>
        <p className="text-steel text-sm mb-8">
          Pick a new password for your Taskora account.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            autoComplete="new-password"
            required
            minLength={8}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-ocean text-white font-semibold rounded-lg hover:bg-ocean/90 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
