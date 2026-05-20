"use client";
import { useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSending, setMagicSending] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; }
    const next = searchParams.get("next") ?? "/daily-brief";
    window.location.href = next;
  }

  async function handleMagicLink() {
    setError("");
    setInfo("");
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setMagicSending(true);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: origin ? `${origin}/daily-brief` : undefined },
    });
    setMagicSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo(`Magic link sent to ${email}. Check your inbox.`);
  }

  async function handleForgotPassword() {
    setError("");
    setInfo("");
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setResetSending(true);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin ? `${origin}/reset-password` : undefined,
    });
    setResetSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo(`Password reset link sent to ${email}. Check your inbox.`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mist px-4">
      <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md">
        <h1 className="text-2xl font-bold text-midnight mb-2">Welcome back</h1>
        <p className="text-steel text-sm mb-8">Sign in to your Taskora account.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {info && <p className="text-emerald-700 text-sm">{info}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-taskora-red text-white font-semibold rounded-lg hover:bg-taskora-red-hover disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <div className="text-right">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetSending}
              className="text-xs text-ocean hover:text-ocean/80 font-medium disabled:opacity-50"
            >
              {resetSending ? "Sending…" : "Forgot password?"}
            </button>
          </div>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-pebble" />
          <span className="text-xs text-steel uppercase tracking-wide">or</span>
          <div className="flex-1 h-px bg-pebble" />
        </div>
        <button
          type="button"
          onClick={handleMagicLink}
          disabled={magicSending}
          className="w-full h-12 border border-pebble text-midnight font-semibold rounded-lg hover:bg-mist disabled:opacity-50"
        >
          {magicSending ? "Sending magic link…" : "Sign in with magic link"}
        </button>

        <p className="text-center text-sm text-steel mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-ocean font-medium">Sign up free</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
