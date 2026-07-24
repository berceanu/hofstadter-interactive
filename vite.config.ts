import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const repositoryBase = process.env.VITE_BASE_PATH ?? "/hofstadter-interactive/";

export default defineConfig({
  base: process.env.NODE_ENV === "development" ? "/" : repositoryBase,
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./web/src/test/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    css: true,
  },
});
