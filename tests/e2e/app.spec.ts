import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
  await expect(page).toHaveURL(/focus=lattice/);
});

test("the primary navigation remains usable on a mobile viewport", async ({ page }) => {
  await page.goto("/?view=wannier&lat=square&q=7");
  await expect(page.getByRole("heading", { name: "Wannier diagram" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Visualization" })).toBeVisible();
  await expect(page.getByText("Private by construction")).toHaveCount(0);
});

test("edits the magnetic flux as one canonical p/q pair", async ({ page }) => {
  await page.goto(
    "/?focus=lattice&lat=square&p=1&q=12&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  const pInput = page.getByRole("spinbutton", { name: "p", exact: true });
  const qInput = page.getByRole("spinbutton", { name: "q", exact: true });
  await pInput.fill("6");
  await expect(pInput).toHaveValue("6");
  await expect(qInput).toHaveValue("12");
  await expect(page).toHaveURL(/p=1&q=2/);
  await qInput.fill("11");
  await expect(qInput).toHaveValue("11");
  await expect(page).toHaveURL(/p=6&q=11/);
  await qInput.press("Tab");

  await expect(pInput).toHaveValue("6");
  await expect(qInput).toHaveValue("11");
  await expect(page.getByText("φ = 6/11", { exact: true })).toBeVisible();
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

test("repairs a malicious honeycomb angle before running the spectrum", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    "/?view=butterfly&lat=honeycomb&p=1&q=47&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page).toHaveURL(/tn=1&td=3/);
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 45_000 },
  );
  const range = await page.locator(".spectrum-shell").evaluate((element) => ({
    min: Number((element as HTMLElement).dataset.energyMin),
    max: Number((element as HTMLElement).dataset.energyMax),
  }));
  expect(range.min).toBeLessThan(-2.9);
  expect(range.max).toBeGreaterThan(2.9);
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
    page.getByRole("heading", { name: "Bands 2–4 · Berry flux" }),
  ).toBeVisible();
  await expect(page.locator(".chern-badge")).toHaveText("C2–4 = 0");
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

test("renders the Avron gap plane with Hall-conductivity segments", async ({
  page,
}) => {
  await page.goto(
    "/?view=butterfly&lat=square&p=1&q=31&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Gaps", exact: true }).click();
  const plot = page.locator(".spectrum-shell");
  await expect
    .poll(async () => Number(await plot.getAttribute("data-gap-segments")))
    .toBeGreaterThan(0);
  await expect(page.getByLabel("Hall conductivity color scale")).toContainText(
    "tᵣ",
  );
  const rendered = await webglInkPixels(page);
  expect(rendered.ink).toBeGreaterThan(100);
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
  const before = await page
    .locator(".momentum-marker .marker-point")
    .getAttribute("cx");
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
    .poll(() =>
      page.locator(".momentum-marker .marker-point").getAttribute("cx")
    )
    .not.toBe(before);
  await expect(page.locator(".surface-panel .surface-hint")).not.toHaveText(
    "k = (0.000, 0.000)",
  );
  await expect(page.getByLabel("energy color scale")).toBeVisible();
});

test("selects thin bands forgivingly and scrubs momentum in real time", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop pointer interaction");
  await page.goto(
    "/?focus=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const cut = page.getByRole("img", {
    name: "Band energies along the high-symmetry path with density of states",
  });
  const scrubber = page.getByRole("slider", {
    name: "Selected momentum along band",
  });
  await expect(cut).toHaveAttribute("data-band-hit-radius", "18");
  await expect(cut).toHaveAttribute("data-scrubbing", "false");
  await expect(scrubber).toHaveAttribute("aria-valuenow", "0");

  const secondBand = page.locator(
    '.band-lines path[data-band-index="1"]',
  );
  const forgivingTarget = await secondBand.evaluate((path) => {
    const values = Array.from(
      (path.getAttribute("d") ?? "").matchAll(/-?\d+(?:\.\d+)?/g),
      (match) => Number(match[0]),
    );
    const pointCount = Math.floor(values.length / 2);
    const index = Math.floor(pointCount * 0.4) * 2;
    const matrix = (path as SVGPathElement).getScreenCTM();
    if (!matrix) throw new Error("Band path has no screen transform");
    const x = values[index];
    const y = values[index + 1];
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f,
    };
  });
  await page.mouse.click(forgivingTarget.x, forgivingTarget.y + 6);
  await expect(page.getByRole("combobox", { name: "Band" })).toHaveValue("1");

  const dragPoints = await secondBand.evaluate((path) => {
    const values = Array.from(
      (path.getAttribute("d") ?? "").matchAll(/-?\d+(?:\.\d+)?/g),
      (match) => Number(match[0]),
    );
    const pointCount = Math.floor(values.length / 2);
    const matrix = (path as SVGPathElement).getScreenCTM();
    if (!matrix) throw new Error("Band path has no screen transform");
    return [0.18, 0.52, 0.84].map((fraction) => {
      const index = Math.floor((pointCount - 1) * fraction) * 2;
      const x = values[index];
      const y = values[index + 1];
      return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
      };
    });
  });
  const bandRequestsBefore = Number(
    await page.locator(".app-shell").getAttribute("data-band-request-count"),
  );
  const marker = page.locator(".momentum-marker .marker-point");
  await page.mouse.move(dragPoints[0].x, dragPoints[0].y);
  await page.mouse.down();
  await expect(cut).toHaveAttribute("data-scrubbing", "true");
  const startX = Number(await marker.getAttribute("cx"));
  await page.mouse.move(dragPoints[1].x, dragPoints[1].y, { steps: 5 });
  await expect.poll(async () => Number(await marker.getAttribute("cx")))
    .toBeGreaterThan(startX);
  const middleX = Number(await marker.getAttribute("cx"));
  await page.mouse.move(dragPoints[2].x, dragPoints[2].y, { steps: 5 });
  await expect.poll(async () => Number(await marker.getAttribute("cx")))
    .toBeGreaterThan(middleX);
  await page.mouse.up();
  await expect(cut).toHaveAttribute("data-scrubbing", "false");
  expect(
    Number(
      await page.locator(".app-shell").getAttribute("data-band-request-count"),
    ),
  ).toBe(bandRequestsBefore);
});

test("zooms and pans dense linked bands without recomputing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop wheel interaction");
  test.setTimeout(60_000);
  await page.goto(
    "/?focus=bands&lat=square&p=1&q=11&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 45_000 },
  );
  const cut = page.getByRole("img", {
    name: "Band energies along the high-symmetry path with density of states",
  });
  const shell = page.locator(".app-shell");
  const requestsBefore = Number(
    await shell.getAttribute("data-band-request-count"),
  );
  await expect(cut).toHaveAttribute("data-band-zoom", "1.000");
  await expect(cut).toHaveAttribute("data-zoom-mode", "cursor-centered-2d");
  const bounds = await cut.boundingBox();
  expect(bounds).not.toBeNull();
  const plotCenter = {
    x: bounds!.x + bounds!.width * 0.41,
    y: bounds!.y + bounds!.height * 0.48,
  };
  await page.mouse.move(plotCenter.x, plotCenter.y);
  await page.mouse.wheel(0, -700);
  await expect.poll(async () =>
    Number(await cut.getAttribute("data-band-zoom"))
  ).toBeGreaterThan(2);

  await page.keyboard.down("Shift");
  await page.mouse.move(plotCenter.x, plotCenter.y);
  await page.mouse.down();
  await expect(cut).toHaveAttribute("data-panning", "true");
  await page.mouse.move(plotCenter.x + 70, plotCenter.y + 35, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () =>
    Math.abs(Number(await cut.getAttribute("data-band-pan-x")))
  ).toBeGreaterThan(0.01);
  expect(Number(await shell.getAttribute("data-band-request-count")))
    .toBe(requestsBefore);

  await page.getByRole("button", {
    name: "Reset linked band structure zoom",
  }).click();
  await expect(cut).toHaveAttribute("data-band-zoom", "1.000");
  await expect(cut).toHaveAttribute("data-band-pan-x", "0.000");
  await expect(cut).toHaveAttribute("data-band-pan-y", "0.000");
});

test("plots branch-safe Wilson phases and links a k2 row to the surface", async ({
  page,
}) => {
  await page.goto(
    "/?view=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const wilson = page.getByRole("img", {
    name: "Wilson eigenphase versus normalized k2",
  });
  await expect(wilson).toHaveAttribute("data-wilson-points", "11");
  await expect(wilson).toContainText("winding = C = 1");
  const bounds = await wilson.boundingBox();
  expect(bounds).not.toBeNull();
  await wilson.click({
    position: {
      x: bounds!.width * 0.74,
      y: bounds!.height * 0.55,
    },
  });
  await expect(page.locator(".surface-panel .surface-hint")).toContainText(
    "0.700",
  );
  await expect(wilson.locator(".wilson-marker")).toHaveCount(1);
});

test("links property-table hover and selection to the band group", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    "/?view=bands&lat=square&p=1&q=4&t=1&alpha=1&tn=1&td=2&period=1&samp=11&bgt=0.01",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const table = page.getByRole("table", { name: "Band property table" });
  await expect(table).toBeVisible();
  const bandSelect = page.getByRole("combobox", { name: "Band" });
  await expect(bandSelect).toHaveValue("0");
  await expect(bandSelect.locator('option[value="0"]')).toContainText("0 · C=");
  await expect(
    page.getByRole("heading", { name: "Band 0 · E(k)" }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "band index" }))
    .toBeVisible();
  await expect(table.getByRole("columnheader", { name: "group index" }))
    .toBeVisible();
  const touchingGroup = table.getByRole("row", { name: /1–2/ });
  await touchingGroup.hover();
  await expect(page.locator(".band-lines path.selected-band")).toHaveCount(2);
  await touchingGroup.click();
  await expect(bandSelect).toHaveValue("1");
  await expect(bandSelect.locator('option[value="1"]')).toContainText(
    "1 · group 1–2",
  );
});

test("links symmetry points, both BZ outlines, and the lifted 3D path", async ({
  page,
}) => {
  await page.goto(
    "/?view=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const scene = page.locator(".surface-canvas");
  await expect(scene).toHaveAttribute("data-symmetry-points", "4");
  expect(Number(await scene.getAttribute("data-mbz-vertices"))).toBeGreaterThan(
    4,
  );
  expect(
    Number(await scene.getAttribute("data-ordinary-bz-vertices")),
  ).toBeGreaterThan(4);
  expect(Number(await scene.getAttribute("data-path-points"))).toBeGreaterThan(
    40,
  );

  await page.getByRole("button", { name: /Lattice \+ BZ/ }).click();
  await expect(page.locator(".runtime-status")).toContainText(
    "Lattice geometry ready",
    { timeout: 30_000 },
  );
  await expect(page.locator(".symmetry-points")).toContainText("ΓXMY");
});

test("drags the shared coprime flux cursor without launching another sweep", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "wide single-workspace interaction");
  test.setTimeout(60_000);
  await page.goto(
    "/?focus=workspace&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const shell = page.locator(".app-shell");
  const sweepCount = Number(await shell.getAttribute("data-sweep-count"));
  const bandCount = Number(
    await shell.getAttribute("data-band-request-count"),
  );
  const butterfly = page.locator('[data-flux-plot="butterfly"]');
  const stage = butterfly.locator(".plot-stage");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height * 0.5;
  await page.mouse.move(bounds!.x + bounds!.width / 7, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * (3 / 7), y, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(page).toHaveURL(/p=3&q=7/);
  await expect(butterfly).toHaveAttribute("data-current-numerator", "3");
  await expect
    .poll(
      async () =>
        Number(await shell.getAttribute("data-band-request-count")),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(bandCount);
  expect(Number(await shell.getAttribute("data-sweep-count"))).toBe(
    sweepCount,
  );

  const beforeButterflyTicks = await butterfly
    .locator(".plot-ticks")
    .textContent();
  const wannierTicks = page
    .locator('[data-flux-plot="wannier"]')
    .locator(".plot-ticks");
  const beforeWannierTicks = await wannierTicks.textContent();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.55,
    bounds!.y + bounds!.height * 0.45,
  );
  await page.mouse.wheel(0, -500);
  await expect
    .poll(() => butterfly.locator(".plot-ticks").textContent())
    .not.toBe(beforeButterflyTicks);
  await expect
    .poll(() => wannierTicks.textContent())
    .not.toBe(beforeWannierTicks);
  expect(Number(await shell.getAttribute("data-sweep-count"))).toBe(
    sweepCount,
  );
});

test("keeps stale workspace plots visible and dimmed during replacement", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "wide single-workspace behavior");
  test.setTimeout(60_000);
  await page.goto(
    "/?focus=workspace&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const plot = page.locator('[data-flux-plot="butterfly"]');
  const oldEnergyMaximum = await plot.getAttribute("data-energy-max");
  await page.getByLabel("q", { exact: true }).fill("47");
  await expect(plot).toHaveAttribute("data-recomputing", "true", {
    timeout: 10_000,
  });
  await expect(plot.locator(".recompute-chip")).toContainText("recomputing");
  await expect(plot.locator("canvas")).toBeVisible();
  await expect(plot).toHaveAttribute("data-energy-max", oldEnergyMaximum!);
  await expect(plot).toHaveAttribute("data-recomputing", "false", {
    timeout: 45_000,
  });
});

test("falls back from the workspace to tabs below 1100px", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(
    "/?focus=workspace&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".single-workspace")).toHaveCount(0);
  await expect(page.locator(".focused-workspace")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hofstadter butterfly" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Visualization" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Workspace/ })).toBeHidden();
});

test("loads quantum geometry only after the user asks for it", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    "/?focus=bands&lat=square&p=1&q=4&t=1&alpha=1&tn=1&td=2&period=1&samp=7&bgt=0.01",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-geometry-request-count", "0");
  await page.getByRole("button", { name: "gxx", exact: true }).click();
  await expect(shell).toHaveAttribute("data-geometry-request-count", "1");
  await expect(page.locator(".runtime-status")).toContainText(
    "Quantum geometry ready",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("heading", { name: /gₓₓ\(k\)/ })).toBeVisible();
  await expect(page.getByLabel("gxx color scale")).toBeVisible();

  await page.getByRole("button", { name: "quantum geometry" }).click();
  await expect(page.getByText("runs 2 extra grid diagonalizations")).toBeVisible();
  const table = page.getByRole("table", { name: "Band property table" });
  await expect(table).toContainText("av_gxx");
  await expect(table).toContainText("⟨T⟩");
  await expect(shell).toHaveAttribute("data-geometry-request-count", "1");
});

test("exports a clean three-times-scale art PNG", async ({ page }) => {
  await page.goto(
    "/?focus=butterfly&lat=honeycomb&p=1&q=7&t=1&alpha=1&tn=1&td=3&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Gaps", exact: true }).click();
  await page.getByLabel("transparent", { exact: true }).check();
  const stage = page.locator(".plot-stage");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Art PNG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "butterfly_honeycomb_q_7_plane_art.png",
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.readUInt32BE(16)).toBe(Math.round(bounds!.width * 3));
  expect(bytes.readUInt32BE(20)).toBe(Math.round(bounds!.height * 3));
  expect(bytes[25]).toBe(6);
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

test("switches among the Avron, jet, and red-blue topology palettes", async ({
  page,
}) => {
  await page.goto(
    "/?focus=butterfly&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const palette = page.getByLabel("Topology palette");
  await expect(palette).toHaveValue("avron");
  await page.getByRole("button", { name: "Chern", exact: true }).click();
  await palette.selectOption("jet");
  await expect(palette).toHaveValue("jet");
  await expect(page.getByLabel("Chern number color scale").locator("i"))
    .toHaveAttribute("style", /rgb\(0, 0, 128\)/);
  await palette.selectOption("red-blue");
  await expect(palette).toHaveValue("red-blue");
  await expect(page.getByLabel("Chern number color scale").locator("i"))
    .toHaveAttribute("style", /rgb\(8, 48, 107\)/);
});

test("morphs the selected energy sheet into an educational BZ torus", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(
    "/?focus=bands&lat=square&p=1&q=3&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Band grid complete",
    { timeout: 30_000 },
  );
  const scene = page.locator(".surface-canvas");
  const toggle = page.getByRole("button", { name: "BZ torus" });
  const contours = page.getByRole("button", { name: "Contours" });
  await expect(scene).toHaveAttribute("data-surface-topology", "sheet");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(contours).toHaveAttribute("aria-pressed", "true");
  await expect(scene).toHaveAttribute("data-contours", "projected");
  await expect(scene).toHaveAttribute("data-contour-levels", "7");
  await expect(scene).toHaveAttribute("data-contour-projection", "heatmap");
  await expect(scene).toHaveAttribute("data-contour-stroke", "ribbon");
  await expect.poll(async () =>
    Number(await scene.getAttribute("data-contour-segments"))
  ).toBeGreaterThan(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(scene).toHaveAttribute("data-surface-topology", "torus");
  await expect(scene).toHaveAttribute("data-contours", "wrapped");
  await expect(scene).toHaveAttribute("data-contour-projection", "hidden");
  await expect(scene).toHaveAttribute("data-contour-stroke", "line");
  await expect(scene).toHaveAttribute("data-dispersion-relief", "0.56");
  await expect(scene).toHaveAttribute("data-reference-torus", "visible");
  await expect(scene).toHaveAttribute("data-marker-visibility", "always");
  await expect(scene).toHaveAttribute("data-marker-tracking", "halo-reticle");
  await expect(page.getByText(/radial relief \+ contours = normalized E\(k\)/))
    .toBeVisible();
  await page.getByRole("button", { name: "Berry", exact: true }).click();
  await expect(page.getByText(/color \+ contours = Berry flux/))
    .toBeVisible();
  await contours.click();
  await expect(contours).toHaveAttribute("aria-pressed", "false");
  await expect(scene).toHaveAttribute("data-contours", "hidden");
  await expect(scene).toHaveAttribute("data-contour-segments", "0");
  expect(pageErrors).toEqual([]);
});

test("loads a custom basis through the upstream generic lattice path", async ({
  page,
}) => {
  await page.goto(
    "/?focus=lattice&lat=custom&p=1&q=3&t=1&alpha=1&tn=1&td=3&period=1&samp=7&basis=0%3A0%3B0.5%3A0.25",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Lattice geometry ready",
    { timeout: 30_000 },
  );
  await expect(page.getByLabel("Lattice geometry")).toHaveValue("custom");
  await expect(page.getByLabel("Custom basis sites")).toHaveValue(
    "0, 0\n0.5, 0.25",
  );
  await expect(page.getByText("2-site primitive cell")).toBeVisible();
  await expect(page).toHaveURL(/basis=0%3A0%3B0.5%3A0.25/);

  await page.getByRole("button", { name: /Butterfly/ }).click();
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("button", { name: "Chern unavailable" }),
  ).toBeDisabled();
});

test("restores an exported NPZ without launching a replacement sweep", async ({
  page,
}) => {
  await page.goto(
    "/?focus=butterfly&lat=square&p=1&q=7&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "NPZ", exact: true }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();

  await page.goto(
    "/?focus=butterfly&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await expect(page.locator(".runtime-status")).toContainText(
    "Computed locally",
    { timeout: 30_000 },
  );
  const shell = page.locator(".app-shell");
  const sweepCount = await shell.getAttribute("data-sweep-count");
  const archiveBase64 = (await readFile(archivePath!)).toString("base64");
  await page.evaluate((encoded) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [bytes],
        "hofstadter-square-q7-butterfly.npz",
        { type: "application/octet-stream" },
      ),
    );
    (window as Window & { __npzTransfer?: DataTransfer }).__npzTransfer =
      transfer;
    document.querySelector(".app-shell")?.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        dataTransfer: transfer,
      }),
    );
  }, archiveBase64);
  await expect(page.locator(".npz-drop-overlay")).toBeVisible();
  await page.evaluate(() => {
    const transfer = (
      window as Window & { __npzTransfer?: DataTransfer }
    ).__npzTransfer;
    document.querySelector(".app-shell")?.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        dataTransfer: transfer ?? null,
      }),
    );
  });
  await expect(page.locator(".npz-import-toast")).toContainText(
    "Loaded 42 states and 36 gaps",
  );
  await expect(page).toHaveURL(/p=1&q=7/);
  await expect(
    page.locator('[data-flux-plot="butterfly"]'),
  ).toHaveAttribute("data-point-count", "42");
  await expect(shell).toHaveAttribute("data-sweep-count", sweepCount!);
});
