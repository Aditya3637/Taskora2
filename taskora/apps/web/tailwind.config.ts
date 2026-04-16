import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "taskora-red": "#E63946",
        "taskora-red-hover": "#C62828",
        midnight: "#1A1A2E",
        "deep-navy": "#16213E",
        ocean: "#0F3460",
        steel: "#6B7280",
        mist: "#F3F4F6",
        pebble: "#E5E7EB",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
