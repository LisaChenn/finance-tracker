/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Archivo"', "system-ui", "sans-serif"],
      },
      colors: {
        bg: "#050506",
        card: "#08080a",
        panel: "#111114",
        accent: {
          DEFAULT: "#4d8dff",
          soft: "rgba(77, 141, 255, 0.16)",
          text: "#8fb6ff",
        },
        ink: {
          DEFAULT: "#f2f3f5",
          muted: "rgba(242, 243, 245, 0.55)",
          faint: "rgba(242, 243, 245, 0.4)",
          fainter: "rgba(242, 243, 245, 0.36)",
          ghost: "rgba(242, 243, 245, 0.3)",
        },
        line: {
          DEFAULT: "rgba(255, 255, 255, 0.06)",
          strong: "rgba(255, 255, 255, 0.09)",
          soft: "rgba(255, 255, 255, 0.045)",
        },
      },
      boxShadow: {
        card: "0 24px 60px rgba(0, 0, 0, 0.45)",
      },
      borderRadius: {
        xl2: "20px",
      },
      fontSize: {
        "2xs": ["10px", "1"],
        "3xs": ["9.5px", "1"],
      },
      letterSpacing: {
        wider2: "0.14em",
      },
    },
  },
  plugins: [],
};
