import { expect, test } from "@playwright/test";

test("loads the scientific workspace and keeps state in the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hofstadter butterfly" })).toBeVisible();
  await page.getByLabel("Lattice geometry").selectOption("triangular");
  await expect(page).toHaveURL(/lat=triangular/);
  await page.getByRole("button", { name: /Lattice \+ BZ/ }).click();
  await expect(page.getByRole("heading", { name: "Lattice geometry" })).toBeVisible();
  await expect(page).toHaveURL(/view=lattice/);
});

test("the primary navigation remains usable on a mobile viewport", async ({ page }) => {
  await page.goto("/?view=wannier&lat=square&q=7");
  await expect(page.getByRole("heading", { name: "Wannier diagram" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Visualization" })).toBeVisible();
  await expect(page.getByText("Private by construction")).toBeVisible();
});

test("runs the real Pyodide butterfly computation to completion", async ({ page }) => {
  await page.goto("/?view=butterfly&lat=square&p=1&q=7&t=1&tn=1&td=2&period=1&samp=7");
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally in",
    { timeout: 30_000 },
  );
  await expect(page.getByText(/states$/)).toContainText("42 states");
});

test("normalizes invalid scientific parameters before computation", async ({ page }) => {
  await page.goto(
    "/?view=lattice&lat=bravais&p=10&q=3&t=1&alpha=-4&tn=180&td=0&period=0&samp=32",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Lattice geometry ready",
    { timeout: 30_000 },
  );
  await expect(page).toHaveURL(/p=2&q=3/);
  await expect(page).toHaveURL(/alpha=0.1/);
  await expect(page).toHaveURL(/tn=1&td=2/);
  await expect(page).toHaveURL(/period=1&samp=31/);
  await expect(page.locator(".runtime-status")).not.toContainText("Traceback");
});

test("renders a bounded Wigner–Seitz magnetic Brillouin zone", async ({ page }) => {
  await page.goto(
    "/?view=lattice&lat=triangular&p=1&q=11&t=1&alpha=1&tn=1&td=3&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Lattice geometry ready",
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("img", {
      name: "triangular real-space lattice and magnetic Brillouin zone",
    }),
  ).toBeVisible();
  const geometry = await page.locator(".lattice-svg").evaluate((svg) => {
    const zone = svg.querySelector(".bz-boundary")?.getAttribute("d") ?? "";
    const magnetic = svg
      .querySelector(".magnetic-inset .magnetic-cell")
      ?.getAttribute("d") ?? "";
    const coordinates = Array.from(magnetic.matchAll(/-?\d+(?:\.\d+)?/g)).map(
      (match) => Number(match[0]),
    );
    return {
      zoneSegments: (zone.match(/[ML]/g) ?? []).length - 1,
      magneticCoordinates: coordinates,
    };
  });
  expect(geometry.zoneSegments).toBe(6);
  expect(Math.min(...geometry.magneticCoordinates)).toBeGreaterThanOrEqual(92);
  expect(Math.max(...geometry.magneticCoordinates)).toBeLessThanOrEqual(462);
});

test("uses gauge-invariant Chern groups for touching bands", async ({ page }) => {
  await page.goto(
    "/?view=bands&lat=kagome&p=1&q=3&t=1&alpha=1&tn=1&td=3&period=8&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  await page.getByRole("combobox", { name: "Band" }).selectOption("2");
  await page.getByRole("button", { name: "Berry" }).click();
  await expect(
    page.getByRole("heading", { name: "Bands 3–5 · Berry flux" }),
  ).toBeVisible();
  await expect(page.locator(".chern-badge")).toHaveText("C3–5 = 0");
});

test("keeps cancellation final and exports computed artifacts", async ({ page }) => {
  await page.goto(
    "/?view=butterfly&lat=square&p=1&q=97&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await page.getByRole("button", { name: "cancel" }).click({ timeout: 30_000 });
  await expect(page.locator(".runtime-status")).toHaveText(
    "Computation cancelled",
  );

  await page.goto(
    "/?view=butterfly&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  for (const [label, extension] of [
    ["CSV", "csv"],
    ["NPZ", "npz"],
    ["PNG", "png"],
  ] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `hofstadter-square-q7-butterfly.${extension}`,
    );
  }
});
