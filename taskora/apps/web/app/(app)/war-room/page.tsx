"use client";
import { useState } from "react";
import { WarRoomTicker } from "@/components/war-room/WarRoomTicker";
import { DecisionQueue } from "@/components/war-room/DecisionQueue";
import { ActiveFocus } from "@/components/war-room/ActiveFocus";
import { BattlefieldPanel } from "@/components/war-room/BattlefieldPanel";

const TABS = [
  { id: "decisions", label: "Decisions" },
  { id: "focus", label: "Focus" },
  { id: "battlefield", label: "Battlefield" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function WarRoomPage() {
  const [activeTab, setActiveTab] = useState<Tab>("focus");

  return (
    <div className="h-[calc(100vh-3.5rem)] md:h-screen flex flex-col bg-mist overflow-hidden">
      <WarRoomTicker />

      {/* Mobile tab bar */}
      <div className="flex md:hidden border-b border-pebble bg-white flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? "text-taskora-red border-b-2 border-taskora-red"
                : "text-steel hover:text-midnight"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile: single panel */}
      <div className="flex-1 overflow-y-auto md:hidden">
        {activeTab === "decisions" && <DecisionQueue />}
        {activeTab === "focus" && <ActiveFocus />}
        {activeTab === "battlefield" && (
          <div className="bg-midnight min-h-full">
            <BattlefieldPanel />
          </div>
        )}
      </div>

      {/* Desktop: 3-panel layout */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <aside className="w-72 lg:w-80 bg-white border-r border-pebble overflow-y-auto flex-shrink-0">
          <DecisionQueue />
        </aside>
        <main className="flex-1 overflow-y-auto min-w-0">
          <ActiveFocus />
        </main>
        <aside className="w-64 lg:w-[300px] bg-midnight overflow-y-auto flex-shrink-0">
          <BattlefieldPanel />
        </aside>
      </div>
    </div>
  );
}
