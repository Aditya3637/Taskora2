import type { Config } from "tailwindcss";

/**
 * Design tokens for Taskora. The naming layers two systems:
 *
 *   1. Semantic tokens (`bg-surface`, `text-fg`, `border-line`) — the
 *      preferred API for new code. Map cleanly to a future dark mode by
 *      swapping the CSS variables in globals.css.
 *   2. Legacy brand tokens (`taskora-red`, `midnight`, `mist`, `pebble`,
 *      `steel`) — kept for existing pages still being migrated. Do not
 *      remove without sweeping the codebase.
 *
 * Brand scale (`brand-50` … `brand-950`) is derived from the original
 * #E63946 with proper tonal steps so we can use the same hue across
 * subtle (bg-brand-50), default (bg-brand-500), hover (bg-brand-600),
 * and emphatic (bg-brand-700) states without ad-hoc opacity tricks.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Semantic surfaces (drive light/dark by swapping CSS vars) ──
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
        "fg-subtle": "rgb(var(--fg-subtle) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",

        // ── Sidebar / dark chrome ──
        chrome: "rgb(var(--chrome) / <alpha-value>)",
        "chrome-2": "rgb(var(--chrome-2) / <alpha-value>)",
        "chrome-fg": "rgb(var(--chrome-fg) / <alpha-value>)",
        "chrome-fg-muted": "rgb(var(--chrome-fg-muted) / <alpha-value>)",
        "chrome-line": "rgb(var(--chrome-line) / <alpha-value>)",

        // ── Brand scale (derived from #E63946) ──
        brand: {
          50: "#FEF2F3",
          100: "#FCE4E6",
          200: "#FACDD0",
          300: "#F5A1A8",
          400: "#EE6F79",
          500: "#E63946",
          600: "#D02434",
          700: "#AE1C2A",
          800: "#8B1822",
          900: "#71171F",
          950: "#3D080E",
        },

        // ── Semantic state colors ──
        success: {
          50: "#F0FDF4",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        warn: {
          50: "#FFFBEB",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
        },
        danger: {
          50: "#FEF2F2",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
        },
        info: {
          50: "#EFF6FF",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
        },

        // ── Legacy tokens (DO NOT REMOVE — wide existing usage) ──
        "taskora-red": "#E63946",
        "taskora-red-hover": "#C62828",
        midnight: "#0E0E12",
        "deep-navy": "#16213E",
        ocean: "#0F3460",
        steel: "#6B7280",
        mist: "#FAFAFA",
        pebble: "#ECECEE",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Plus Jakarta Sans", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Tightened display sizes with the line-heights designers actually want.
        "display-2xl": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "700" }],
        "display-xl":  ["3.5rem", { lineHeight: "1.08", letterSpacing: "-0.022em", fontWeight: "700" }],
        "display-lg":  ["2.5rem", { lineHeight: "1.12", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md":  ["2rem",   { lineHeight: "1.18", letterSpacing: "-0.018em", fontWeight: "700" }],
        "display-sm":  ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "600" }],
      },
      letterSpacing: {
        tightest: "-0.03em",
        "tighter-1": "-0.012em",
      },
      borderRadius: {
        xs: "0.25rem",
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.625rem",
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        // Layered, low-opacity. Always combines a near-zero spread with a
        // longer-distance shadow so cards lift without smudging.
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
        md: "0 2px 4px -1px rgb(0 0 0 / 0.04), 0 4px 8px -2px rgb(0 0 0 / 0.06)",
        lg: "0 4px 6px -1px rgb(0 0 0 / 0.04), 0 10px 20px -4px rgb(0 0 0 / 0.08)",
        xl: "0 8px 12px -2px rgb(0 0 0 / 0.05), 0 24px 40px -8px rgb(0 0 0 / 0.12)",
        // Inner "well" surfaces (editor backgrounds, inputs).
        well: "inset 0 1px 2px 0 rgb(0 0 0 / 0.04)",
        // Focus ring (used by our Tailwind plugin alternative — raw boxShadow).
        ring: "0 0 0 3px rgb(230 57 70 / 0.18)",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        DEFAULT: "180ms",
        slow: "280ms",
      },
      keyframes: {
        marquee:    { from: { transform: "translateX(100vw)" }, to: { transform: "translateX(-100%)" } },
        "fade-in":  { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up":  { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        shimmer:    { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-soft": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.6" } },
      },
      animation: {
        marquee: "marquee 20s linear infinite",
        "fade-in":  "fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-up":  "fade-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer:    "shimmer 1.6s linear infinite",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
