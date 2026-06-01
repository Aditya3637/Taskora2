"use client";

// The old "Onboarding" tab has been split into Profile / Buildings / Clients
// permanent destinations + a Getting Started widget on /daily-brief. This
// route stays alive so any external links/bookmarks still resolve, but it
// just sends people to the Profile page (which is the entry-most equivalent
// of the original onboarding setup).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyOnboardingPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace/settings/profile");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-taskora-red border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
