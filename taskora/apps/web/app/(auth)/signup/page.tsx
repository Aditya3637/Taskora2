"use client";
import { useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // An invited teammate must land on the invite (to join the existing
  // workspace), NEVER on /onboarding (which creates a brand-new business).
  const inviteToken = searchParams.get("invite");
  const nextParam = searchParams.get("next");
  const postSignup = inviteToken
    ? `/invite/${inviteToken}`
    : nextParam || "/onboarding";
  const loginHref = inviteToken
    ? `/login?next=${encodeURIComponent(`/invite/${inviteToken}`)}`
    : nextParam
    ? `/login?next=${encodeURIComponent(nextParam)}`
    : "/login";

  const [form, setForm] = useState({ name: "", email: "", password: "", company: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { name: form.name, company: form.company } },
    });
    if (authError) { setError(authError.message); setLoading(false); return; }
    router.push(postSignup);
  }

  const fields: { key: keyof typeof form; label: string; type: string; required: boolean }[] = [
    { key: "name", label: "Full Name", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    { key: "password", label: "Password", type: "password", required: true },
    { key: "company", label: "Company (optional)", type: "text", required: false },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-mist px-4">
      <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md">
        <h1 className="text-2xl font-bold text-midnight mb-2">Create your account</h1>
        <p className="text-steel text-sm mb-8">
          {inviteToken
            ? "Create your account to join your team's workspace."
            : "Free for 2 months. No credit card needed."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map(({ key, label, type, required }) => (
            <input
              key={key}
              type={type}
              placeholder={label}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              required={required}
            />
          ))}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-taskora-red text-white font-semibold rounded-lg hover:bg-taskora-red-hover disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>
        <p className="text-center text-sm text-steel mt-6">
          Already have an account?{" "}
          <Link href={loginHref} className="text-ocean font-medium">Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
