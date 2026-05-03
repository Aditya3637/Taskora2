"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Status = "loading" | "no-session" | "ready" | "submitting" | "error";

type SessionUser = {
  id: string;
  email: string | null;
  name: string;
};

const TYPES: { value: "building" | "client"; label: string; hint: string }[] = [
  { value: "building", label: "Buildings", hint: "Real estate, construction, facilities" },
  { value: "client", label: "Clients", hint: "Agencies, services, consultancies" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [form, setForm] = useState<{
    businessName: string;
    businessType: "building" | "client";
  }>({ businessName: "", businessType: "building" });
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !data.user) {
        setStatus("no-session");
        return;
      }
      const meta = (data.user.user_metadata || {}) as {
        name?: string;
        company?: string;
      };
      setUser({
        id: data.user.id,
        email: data.user.email ?? null,
        name: meta.name || data.user.email?.split("@")[0] || "there",
      });
      setForm((f) => ({ ...f, businessName: meta.company || "" }));
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setStatus("submitting");
    setError("");

    const { error: profileError } = await supabase
      .from("users")
      .upsert({ id: user.id, name: user.name }, { onConflict: "id" });
    if (profileError) {
      setError(`Could not save profile: ${profileError.message}`);
      setStatus("error");
      return;
    }

    const { error: bizError } = await supabase
      .from("businesses")
      .insert({
        name: form.businessName.trim(),
        type: form.businessType,
        owner_id: user.id,
      });
    if (bizError) {
      setError(`Could not create business: ${bizError.message}`);
      setStatus("error");
      return;
    }

    router.push("/war-room");
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist">
        <p className="text-steel">Loading…</p>
      </div>
    );
  }

  if (status === "no-session") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mist px-4">
        <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-midnight mb-3">Confirm your email</h1>
          <p className="text-steel text-sm mb-6">
            We sent a confirmation link to your inbox. Click it, then come back and log in.
          </p>
          <Link
            href="/login"
            className="inline-block w-full bg-taskora-red text-white font-semibold rounded-lg hover:bg-taskora-red-hover py-3"
          >
            Go to Login
          </Link>
          <p className="text-xs text-steel mt-4">
            Tip: for local testing you can disable email confirmations in Supabase →
            Authentication → Providers → Email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mist px-4 py-12">
      <div className="bg-white rounded-2xl shadow p-10 w-full max-w-md">
        <h1 className="text-2xl font-bold text-midnight mb-2">
          Welcome, {user?.name}
        </h1>
        <p className="text-steel text-sm mb-8">
          One quick step. Tell us about your business so we can set up your workspace.
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-steel mb-2">Business name</label>
            <input
              type="text"
              placeholder="e.g. Acme Builders"
              value={form.businessName}
              onChange={(e) =>
                setForm({ ...form, businessName: e.target.value })
              }
              className="w-full h-12 px-4 border border-pebble rounded-lg text-midnight placeholder:text-steel focus:outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              required
              maxLength={100}
            />
          </div>
          <div>
            <label className="block text-sm text-steel mb-2">
              What do you manage?
            </label>
            <div className="grid grid-cols-2 gap-3">
              {TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, businessType: opt.value })
                  }
                  className={`text-left p-4 border rounded-lg transition-colors ${
                    form.businessType === opt.value
                      ? "border-taskora-red bg-red-50"
                      : "border-pebble hover:border-taskora-red"
                  }`}
                >
                  <div className="font-semibold text-midnight">
                    {opt.label}
                  </div>
                  <div className="text-xs text-steel mt-1">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full h-12 bg-taskora-red text-white font-semibold rounded-lg hover:bg-taskora-red-hover disabled:opacity-50"
          >
            {status === "submitting" ? "Setting up…" : "Continue to War Room"}
          </button>
        </form>
      </div>
    </div>
  );
}
