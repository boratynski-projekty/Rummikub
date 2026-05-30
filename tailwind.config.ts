import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pomaranczowy: "#f08a24",
        czerwony: "#d8232a",
        blekitny: "#1ba0d7",
        czarny: "#1a1a1a",
        felt: "#0e6b3f",
        "felt-d": "#0a5532",
        kosc: "#f5efe1",
        panel: "#242424",
        panel2: "#2e2e2e",
        line: "#3a3a3a",
        muted: "#9aabaa",
      },
      keyframes: {
        wiggle: { "0%,100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-9deg)" }, "75%": { transform: "rotate(9deg)" } },
        pulsebar: { "0%,100%": { opacity: "0.5", transform: "scaleY(0.85)" }, "50%": { opacity: "1", transform: "scaleY(1)" } },
      },
      animation: { wiggle: "wiggle 1s ease-in-out infinite", pulsebar: "pulsebar .8s ease-in-out infinite" },
    },
  },
  plugins: [],
};
export default config;
