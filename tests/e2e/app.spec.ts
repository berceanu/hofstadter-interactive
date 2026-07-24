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
