import { chromium } from "@playwright/test";

const baseURL = process.env.HH_BENCHMARK_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const started = performance.now();
await page.goto(
  `${baseURL}/?view=butterfly&lat=square&p=1&q=97&t=1&alpha=1&period=1&samp=17`,
);
await page.locator(".runtime-status").waitFor({ state: "visible" });
await page.locator(".phase-computing").waitFor({
  state: "visible",
  timeout: 60_000,
});
const computeStarted = performance.now();
await page.waitForFunction(() => {
  const value = document.querySelector(".result-stats strong")?.textContent ?? "";
  return !value.trim().startsWith("0");
});
const firstRenderSeconds = (performance.now() - computeStarted) / 1000;
await page.locator(".phase-complete").waitFor({
  state: "visible",
  timeout: 60_000,
});
const status = await page.locator(".runtime-status").innerText();
const match = status.match(/Computed locally in ([\d.]+) s/);
const result = {
  workload: "square q=97 butterfly",
  first_meaningful_render_seconds: Number(firstRenderSeconds.toFixed(3)),
  browser_compute_seconds: match ? Number(match[1]) : null,
  runtime_and_compute_seconds: Number(
    ((performance.now() - started) / 1000).toFixed(3),
  ),
  user_agent: await page.evaluate(() => navigator.userAgent),
  target_seconds: 10,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
