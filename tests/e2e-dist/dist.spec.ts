import { expect, test } from "@playwright/test";

// Cold-starts the production artifact at its deployed base path: the worker
// must locate the Pyodide runtime and the HofstadterTools wheel from
// BASE_URL-relative asset URLs and complete a real computation.
test("the built site boots Python and computes under the deployed base path", async ({
  page,
}) => {
  const missingAssets: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404) {
      missingAssets.push(response.url());
    }
  });
  await page.goto("");
  await page.getByLabel("q", { exact: true }).fill("7");
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally in",
    { timeout: 45_000 },
  );
  await expect(
    page.locator('[data-flux-plot="butterfly"]'),
  ).toHaveAttribute("data-point-count", "42");
  expect(missingAssets).toEqual([]);
});
