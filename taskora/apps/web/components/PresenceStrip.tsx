"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Peer = { user_id: string; name: string };

/**
 * Realtime presence (deck differentiator): shows who else is viewing the same
 * page right now via a Supabase Realtime presence channel keyed by pathname.
 * Best-effort — if Realtime isn't reachable it simply renders nothing. No
 * backend/table needed (presence state lives in the channel).
 */
export default function PresenceStrip() {
  const pathname = usePathname();
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user || cancelled) return;
      const me: Peer = {
        user_id: user.id,
        name: (user.user_metadata?.name as string) || user.email?.split("@")[0] || "Someone",
      };
      const room = `presence:${pathname}`;
      channel = supabase.channel(room, { config: { presence: { key: me.user_id } } });

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState() as Record<string, Peer[]>;
          const seen = new Map<string, Peer>();
          for (const list of Object.values(state)) {
            for (const p of list) if (p.user_id && p.user_id !== me.user_id) seen.set(p.user_id, p);
          }
          if (!cancelled) setPeers(Array.from(seen.values()));
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") await channel!.track(me);
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      setPeers([]);
    };
  }, [pathname]);

  if (peers.length === 0) return null;

  return (
    <div className="hidden md:flex fixed top-3 right-16 z-[110] items-center -space-x-1.5" aria-label="People viewing this page">
      {peers.slice(0, 4).map((p) => (
        <span
          key={p.user_id}
          title={`${p.name} is viewing this page`}
          className="h-7 w-7 rounded-full bg-ocean text-white text-[11px] font-semibold flex items-center justify-center ring-2 ring-white shadow-sm"
        >
          {p.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {peers.length > 4 && (
        <span className="h-7 w-7 rounded-full bg-steel text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
          +{peers.length - 4}
        </span>
      )}
    </div>
  );
}
