"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  currencySymbol,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

// Default to INR until the workspace fetch resolves, so we don't pop
// "USD"-formatted numbers on first paint for the install base.
const DEFAULT_CURRENCY = "INR";

type Workspace = { currency: string; timeZone: string | undefined };

// Module-level cache + in-flight de-dup so every consumer in a page
// shares one /businesses/my call.
let cached: Workspace | null = null;
let inflight: Promise<Workspace | null> | null = null;

async function load(): Promise<Workspace | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const res = await fetch(`${API}/api/v1/businesses/my`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return null;
      const biz = await res.json();
      cached = {
        currency: biz?.currency || DEFAULT_CURRENCY,
        timeZone: biz?.time_zone || undefined,
      };
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Returns workspace-bound formatters. Until the workspace fetch resolves
// the formatters use the default currency and the browser's time zone.
export function useWorkspaceFormat() {
  const [ws, setWs] = useState<Workspace | null>(cached);

  useEffect(() => {
    if (!ws) load().then(setWs);
  }, [ws]);

  return useMemo(() => {
    const currency = ws?.currency || DEFAULT_CURRENCY;
    const timeZone = ws?.timeZone;
    return {
      currency,
      timeZone,
      currencySymbol: currencySymbol(currency),
      formatMoney: (amount: number, opts?: Intl.NumberFormatOptions) =>
        formatMoney(amount, currency, opts),
      formatDate: (value: string | Date, opts?: Intl.DateTimeFormatOptions) =>
        formatDate(value, { timeZone, ...opts }),
      formatDateTime: (
        value: string | Date,
        opts?: Intl.DateTimeFormatOptions,
      ) => formatDateTime(value, { timeZone, ...opts }),
    };
  }, [ws]);
}
