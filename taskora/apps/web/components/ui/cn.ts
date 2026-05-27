/**
 * Tiny className joiner. Filters falsy entries so callers can write
 *   cn("base", active && "bg-brand-500", disabled && "opacity-50")
 * without ternaries everywhere. No clsx/tailwind-merge dependency to
 * keep the bundle lean; if conflicting classes become a problem we can
 * upgrade later.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
