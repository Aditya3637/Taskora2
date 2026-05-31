"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/workspace/settings",           label: "Team" },
  { href: "/workspace/settings/profile",   label: "Profile" },
  { href: "/workspace/settings/buildings", label: "Buildings" },
  { href: "/workspace/settings/clients",   label: "Clients" },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-pebble mb-8">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            pathname === tab.href
              ? "border-taskora-red text-taskora-red"
              : "border-transparent text-steel hover:text-midnight"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
