import { expect, test } from "@playwright/test";

async function webglInkPixels(page: import("@playwright/test").Page) {
  return page.locator(".plot-stage canvas").evaluate((canvas) => {
    const target = canvas as HTMLCanvasElement;
    const gl =
      target.getContext("webgl2", { preserveDrawingBuffer: true })
      ?? target.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) return { ink: 0, width: 0, height: 0 };
    const pixels = new Uint8Array(
      gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
    );
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const distance =
        Math.abs(pixels[index] - 8)
        + Math.abs(pixels[index + 1] - 17)
        + Math.abs(pixels[index + 2] - 29);
      if (distance > 24 && pixels[index + 3] > 0) ink += 1;
    }
    return {
      ink,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    };
  });
}

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
      name: "triangular real-space lattice with ordinary and magnetic Brillouin zones",
    }),
  ).toBeVisible();
  const geometry = await page.locator(".lattice-svg").evaluate((svg) => {
    const ordinary = svg.querySelector(".bz-boundary")?.getAttribute("d") ?? "";
    const magnetic =
      svg.querySelector(".magnetic-bz-boundary")?.getAttribute("d") ?? "";
    const coordinates = (value: string) =>
      Array.from(value.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
        Number(match[0]),
      );
    return {
      ordinarySegments: (ordinary.match(/[ML]/g) ?? []).length - 1,
      magneticSegments: (magnetic.match(/[ML]/g) ?? []).length - 1,
      ordinaryCoordinates: coordinates(ordinary),
      magneticCoordinates: coordinates(magnetic),
    };
  });
  expect(geometry.ordinarySegments).toBe(6);
  expect(geometry.magneticSegments).toBeGreaterThanOrEqual(4);
  expect(geometry.ordinaryCoordinates).not.toEqual(geometry.magneticCoordinates);
  expect(Math.min(...geometry.magneticCoordinates)).toBeGreaterThanOrEqual(92);
  expect(Math.max(...geometry.magneticCoordinates)).toBeLessThanOrEqual(955);
  await expect(page.getByText("ordinary BZ", { exact: true })).toBeVisible();
  await expect(page.getByText("magnetic BZ (folded ×11)")).toBeVisible();
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

test("streams the butterfly progressively and repaints it after a responsive resize", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered by the explicit 900 px resize");
  test.setTimeout(60_000);
  await page.goto(
    "/?view=butterfly&lat=square&p=1&q=97&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await page.waitForFunction(
    () => {
      const runtime = document.querySelector(".runtime-status")?.textContent ?? "";
      const states = document.querySelector(".result-stats strong")?.textContent ?? "";
      return runtime.includes("%") && /[1-9][\d,]* states/.test(states);
    },
    undefined,
    { timeout: 30_000 },
  );
  const progressive = await webglInkPixels(page);
  expect(progressive.width).toBeGreaterThan(500);
  expect(progressive.ink).toBeGreaterThan(200);

  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const complete = await webglInkPixels(page);
  expect(complete.ink).toBeGreaterThan(progressive.ink);

  await page.setViewportSize({ width: 900, height: 760 });
  await page.waitForTimeout(400);
  const resized = await webglInkPixels(page);
  expect(resized.width).toBeGreaterThan(400);
  expect(resized.ink).toBeGreaterThan(500);
  await expect(page.locator(".flux-marker")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("supports plain-wheel zoom, reset, bounded flux marking, and a Chern legend", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop pointer interaction");
  await page.goto(
    "/?view=butterfly&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  await expect(page.locator(".flux-marker")).toContainText("current φ");
  const initialTicks = await page.locator(".plot-ticks").first().textContent();
  const stage = page.locator(".plot-stage");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.58,
    bounds!.y + bounds!.height * 0.48,
  );
  await page.mouse.wheel(0, -600);
  await expect
    .poll(() => page.locator(".plot-ticks").first().textContent())
    .not.toBe(initialTicks);
  await page.getByRole("button", { name: "reset view" }).click();
  await expect
    .poll(() => page.locator(".plot-ticks").first().textContent())
    .toBe(initialTicks);

  await page.getByRole("button", { name: "Chern", exact: true }).click();
  await expect(
    page.getByLabel("Chern number color scale"),
  ).toContainText("−100+10");
});

test("links a clicked symmetry-cut momentum to the 3D surface marker", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop 3D interaction");
  await page.goto(
    "/?view=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const before = await page.locator(".momentum-marker circle").getAttribute("cx");
  const target = await page
    .locator(".band-lines path.selected-band")
    .evaluate((path) => {
      const values = Array.from(
        (path.getAttribute("d") ?? "").matchAll(/-?\d+(?:\.\d+)?/g),
        (match) => Number(match[0]),
      );
      const pointCount = Math.floor(values.length / 2);
      const index = Math.floor(pointCount * 0.62) * 2;
      const matrix = (path as SVGPathElement).getScreenCTM();
      if (!matrix) throw new Error("Band path has no screen transform");
      const x = values[index];
      const y = values[index + 1];
      return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
      };
    });
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(() => page.locator(".momentum-marker circle").getAttribute("cx"))
    .not.toBe(before);
  await expect(page.locator(".surface-hint")).not.toHaveText(
    "k = (0.000, 0.000)",
  );
  await expect(page.getByLabel("energy color scale")).toBeVisible();
});

test("marks unsupported fast topology as unavailable instead of physical C = 0", async ({
  page,
}) => {
  await page.goto(
    "/?view=butterfly&lat=kagome&p=1&q=11&t=1&alpha=1&tn=1&td=3&period=8&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const topologyButton = page.getByRole("button", {
    name: "Chern unavailable",
  });
  await expect(topologyButton).toBeDisabled();
});
