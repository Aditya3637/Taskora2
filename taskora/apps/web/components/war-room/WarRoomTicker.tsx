"use client";

export function WarRoomTicker() {
  return (
    <div className="bg-gradient-to-r from-[#991B1B] to-taskora-red h-10 flex items-center overflow-hidden">
      <div className="animate-marquee whitespace-nowrap text-white text-sm font-medium px-4">
        ⚠ 3 decisions overdue · Tower A blocked on PO approval · Palm Heights delivery pending decision · Sector 49 crane access escalated
      </div>
    </div>
  );
}
