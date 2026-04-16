"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; }
    router.push("/war-room");
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
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-taskora-red text-white font-semibold rounded-lg hover:bg-taskora-red-hover disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="text-center text-sm text-steel mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-ocean font-medium">Sign up free</Link>
        </p>
      </div>
    </div>
  );
}
