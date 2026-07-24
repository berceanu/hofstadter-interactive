import { defineConfig, devices } from "@playwright/test";

// Serves the production build (dist/) at the deployed base path so CI
// exercises the artifact it ships — the dev server runs at "/" while the
// deployed site composes its Pyodide and wheel URLs from
// "/hofstadter-interactive/", and only this configuration covers that.
export default defineConfig({
  testDir: "./tests/e2e-dist",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4174/hofstadter-interactive/",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/hofstadter-interactive/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium-dist", use: { ...devices["Desktop Chrome"] } },
  ],
});
