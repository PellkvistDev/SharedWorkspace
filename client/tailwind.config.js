/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#ebebed",
          200: "#d2d2d6",
          300: "#a8a8af",
          400: "#76767e",
          500: "#52525a",
          600: "#3a3a40",
          700: "#27272b",
          800: "#1a1a1d",
          900: "#0f0f11",
          950: "#08080a",
        },
      },
    },
  },
  plugins: [],
};
