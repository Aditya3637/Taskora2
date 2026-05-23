// Workspace-locale formatters. Use these instead of hardcoding `en-IN` or
// `toLocaleDateString()` with no options, so the same component renders
// correctly for a US or EU workspace as well as an Indian one.
//
// `formatMoney` picks a sensible locale per currency so the result looks
// idiomatic — INR uses lakhs, USD uses thousands. The caller can override.

const CURRENCY_LOCALE: Record<string, string> = {
  USD: "en-US",
  EUR: "en-IE",
  GBP: "en-GB",
  INR: "en-IN",
  SGD: "en-SG",
  AED: "en-AE",
  AUD: "en-AU",
  CAD: "en-CA",
};

export function formatMoney(
  amount: number,
  currency: string,
  opts?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(amount)) return "";
  const locale = CURRENCY_LOCALE[currency];
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...opts,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to the raw number rather than throw.
    return amount.toString();
  }
}

export function formatDate(
  value: string | Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
  }).format(d);
}

export function formatDateTime(
  value: string | Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return formatDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  });
}

// "$", "€", "₹". Returns the currency code itself if Intl can't resolve a
// symbol (e.g. for an unknown three-letter code).
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
