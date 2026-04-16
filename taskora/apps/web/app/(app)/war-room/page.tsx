import { WarRoomTicker } from "@/components/war-room/WarRoomTicker";
import { DecisionQueue } from "@/components/war-room/DecisionQueue";
import { ActiveFocus } from "@/components/war-room/ActiveFocus";
import { BattlefieldPanel } from "@/components/war-room/BattlefieldPanel";

export default function WarRoomPage() {
  return (
    <div className="h-screen flex flex-col bg-mist overflow-hidden">
      <WarRoomTicker />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-white border-r border-pebble overflow-y-auto flex-shrink-0">
          <DecisionQueue />
        </aside>
        <main className="flex-1 overflow-y-auto">
          <ActiveFocus />
        </main>
        <aside className="w-[300px] bg-midnight overflow-y-auto flex-shrink-0">
          <BattlefieldPanel />
        </aside>
      </div>
    </div>
  );
}
