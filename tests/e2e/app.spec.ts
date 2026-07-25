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

async function waitForBandGrid(page: import("@playwright/test").Page) {
  await expect(page.locator(".bands-layout")).toBeVisible({
    timeout: 30_000,
  });
}

async function configureApp(
  page: import("@playwright/test").Page,
  path = "/",
) {
  const query = new URL(path, "http://localhost").searchParams;
  await page.goto("/");

  const lattice = query.get("lat");
  if (lattice) {
    await page.getByLabel("Lattice geometry", { exact: true }).selectOption(
      lattice,
    );
  }
  const q = query.get("q");
  if (q) await page.getByLabel("q", { exact: true }).fill(q);
  const p = query.get("p");
  if (p) await page.getByLabel("p", { exact: true }).fill(p);

  const fields = [
    ["t", "#parameter-hoppings"],
    ["alpha", "#parameter-alpha"],
    ["period", "#parameter-period"],
    ["td", "#parameter-theta-denominator"],
    ["tn", "#parameter-theta-numerator"],
    ["bgt", "#parameter-band-gap-threshold"],
  ] as const;
  for (const [parameter, selector] of fields) {
    const value = query.get(parameter);
    const field = page.locator(selector);
    if (value !== null && await field.isEnabled()) {
      await field.fill(value);
      await field.press("Tab");
    }
  }

  const target = query.get("focus") ?? query.get("view");
  const labels: Record<string, RegExp> = {
    butterfly: /Butterfly/,
    wannier: /Wannier/,
    lattice: /Lattice \+ BZ/,
    bands: /Band surfaces/,
  };
  if (target && target !== "workspace" && labels[target]) {
    await page.getByRole("button", { name: labels[target] }).click();
  }
}

test(
  "loads the scientific workspace and updates local state",
  { tag: "@smoke" },
  async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Hofstadter butterfly" }),
    ).toBeVisible();
    await page.getByRole("button", {
      name: "Explain Magnetic flux φ = p/q",
    }).hover();
    await expect(page.locator(".help-tooltip-card")).toContainText(
      "q enlarges the magnetic cell",
    );
    await page.getByRole("button", {
      name: "Explain Hofstadter butterfly",
    }).hover();
    await expect(page.locator(".help-tooltip-card")).toContainText(
      "Γ-point energies",
    );
    await page.getByLabel("Lattice geometry", { exact: true }).selectOption(
      "triangular",
    );
    await expect(
      page.getByLabel("Lattice geometry", { exact: true }),
    ).toHaveValue("triangular");
    await page.getByRole("button", { name: /Lattice \+ BZ/ }).click();
    await expect(
      page.getByRole("heading", { name: "Lattice geometry" }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/\?/);
    await expect(
      page.locator('#parameter-lattice option[value="custom"]'),
    ).toHaveCount(0);
    for (const name of ["LOAD NPZ", "CSV", "NPZ", "PNG", "Art PNG", "Copy link"]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    }
    await expect(page.getByLabel("Topology palette")).toHaveCount(0);
  },
);

test("the primary navigation remains usable on a mobile viewport", async ({ page }) => {
  await page.goto("/");
  await page.locator(".view-nav").getByRole("button", { name: /Wannier/ }).click();
  await expect(page.getByRole("heading", { name: "Wannier diagram" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("navigation", { name: "Visualization" })).toBeVisible();
  await expect(page.getByText("Private by construction")).toHaveCount(0);
});

test("edits the magnetic flux as one canonical p/q pair", async ({ page }) => {
  await page.goto("/");
  const pInput = page.getByRole("spinbutton", { name: "p", exact: true });
  const qInput = page.getByRole("spinbutton", { name: "q", exact: true });
  await qInput.fill("12");
  await pInput.fill("6");
  await expect(pInput).toHaveValue("6");
  await expect(qInput).toHaveValue("12");
  await qInput.fill("11");
  await expect(qInput).toHaveValue("11");
  await qInput.press("Tab");

  await expect(pInput).toHaveValue("6");
  await expect(qInput).toHaveValue("11");
  await expect(page.getByText("φ = 6/11", { exact: true })).toBeVisible();
});

test(
  "runs the real Pyodide butterfly computation to completion",
  { tag: "@smoke" },
  async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("q", { exact: true }).fill("7");
    await expect(page.locator(".runtime-status")).toContainText(
      "Computed locally in",
      { timeout: 30_000 },
    );
    const plot = page.locator('[data-flux-plot="butterfly"]');
    await expect(plot).toHaveAttribute("data-point-count", "42");
    await expect(plot.locator(".plot-axes")).toContainText("energy E");
    await expect(plot.locator(".plot-axes")).not.toContainText("t₁");
  },
);

test("renders a bounded Wigner–Seitz magnetic Brillouin zone", async ({ page }) => {
  await configureApp(page,
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
  await configureApp(page,
    "/?view=bands&lat=kagome&p=1&q=3&t=1&alpha=1&tn=1&td=3&period=8&samp=17",
  );
  await waitForBandGrid(page);
  await page.getByRole("combobox", { name: "Band" }).selectOption("2");
  await page.getByRole("button", { name: "Berry" }).click();
  await expect(
    page.getByRole("heading", { name: "Bands 2–4 · Berry flux" }),
  ).toBeVisible();
  await expect(page.locator(".chern-badge")).toHaveText("C2–4 = 0");
});

test("keeps cancellation final", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("q", { exact: true }).fill("97");
  await page.getByRole("button", { name: "cancel" }).click({ timeout: 30_000 });
  await expect(page.locator(".runtime-status")).toHaveText(
    "Computation cancelled",
  );
});

test("streams the butterfly progressively and repaints it after a responsive resize", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered by the explicit 900 px resize");
  test.setTimeout(60_000);
  await configureApp(page,
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
  await configureApp(page,
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
  await configureApp(page,
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

test(
  "links a clicked symmetry-cut momentum to the 3D surface marker",
  { tag: "@smoke" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop 3D interaction");
    await page.goto("/");
    await page.getByLabel("q", { exact: true }).fill("5");
    await page.getByRole("button", { name: /Band surfaces/ }).click();
    await waitForBandGrid(page);
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
        page.locator(".momentum-marker .marker-point").getAttribute("cx"),
      )
      .not.toBe(before);
    await expect(page.locator(".surface-panel .surface-hint")).not.toHaveText(
      "k = (0.000, 0.000)",
    );
    await expect(page.getByLabel("energy color scale")).toBeVisible();
  },
);

test("selects thin bands forgivingly and scrubs momentum in real time", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop pointer interaction");
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await waitForBandGrid(page);
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

test("adapts path detail to linked-cut zoom without recomputing bands", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop wheel interaction");
  test.setTimeout(60_000);
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=11&t=1&alpha=1&tn=1&td=2&period=1",
  );
  await expect(page.locator(".adaptive-resolution-row")).toHaveAttribute(
    "data-dispersion-resolution",
    "optimized",
    { timeout: 45_000 },
  );
  const cut = page.getByRole("img", {
    name: "Band energies along the high-symmetry path with density of states",
  });
  const shell = page.locator(".app-shell");
  const requestsBefore = Number(
    await shell.getAttribute("data-band-request-count"),
  );
  const dispersionBefore = Number(
    await shell.getAttribute("data-dispersion-request-count"),
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
  await expect.poll(async () =>
    Number(await shell.getAttribute("data-dispersion-request-count"))
  ).toBeGreaterThan(dispersionBefore);
  await expect(cut).toHaveAttribute(
    "data-path-samples-per-segment",
    "96",
    { timeout: 45_000 },
  );

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
  await configureApp(page,
    "/?view=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=17",
  );
  await waitForBandGrid(page);
  const wilson = page.getByRole("group", {
    name: "Wilson eigenphase versus normalized k2",
  });
  await expect(wilson).toHaveAttribute("data-wilson-points", "21");
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
    "0.750",
  );
  await expect(wilson.locator(".wilson-marker")).toHaveCount(1);
  const rowSlider = page.getByRole("slider", {
    name: "Selected Wilson-loop momentum row",
  });
  await rowSlider.focus();
  await page.keyboard.press("Home");
  await expect(rowSlider).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(rowSlider).toHaveAttribute("aria-valuenow", "20");
});

test("automatically resolves an aliased q=31 Wilson loop", async ({ page }) => {
  test.setTimeout(120_000);
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=31&t=1&alpha=1&tn=1&td=2&period=1&bgt=0.01",
  );
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-band-request-count", "1", {
    timeout: 30_000,
  });
  await page.getByLabel("Band", { exact: true }).selectOption("15");

  const wilson = page.getByRole("group", {
    name: "Wilson eigenphase versus normalized k2",
  });
  await expect(wilson).toHaveAttribute(
    "data-topology-status",
    "resolving",
  );
  await expect(wilson).not.toContainText("winding = C");
  await expect(page.locator(".adaptive-resolution-row")).toHaveAttribute(
    "data-topology-resolution",
    "resolving",
  );
  await expect(
    page.getByRole("button", { name: /Refine (topology|dispersion)/ }),
  ).toHaveCount(0);
  const bandRequests = await shell.getAttribute(
    "data-band-request-count",
  );
  const sweepRequests = await shell.getAttribute(
    "data-sweep-count",
  );

  await expect(page.locator(".runtime-status")).toContainText(
    "Selected-band topology verified",
    { timeout: 90_000 },
  );
  await expect(page.locator(".adaptive-resolution-row")).toHaveAttribute(
    "data-topology-resolution",
    "resolved",
  );
  await expect(wilson).toHaveAttribute("data-wilson-points", "179");
  await expect(wilson).toHaveAttribute("data-topology-source", "adaptive");
  await expect(wilson).toHaveAttribute("data-topology-status", "resolved");
  await expect(wilson).toHaveAttribute("data-berry-chern", "-30");
  await expect(wilson).toHaveAttribute("data-wilson-winding", "-30");
  await expect(wilson).toContainText("winding = C = -30");
  await expect(shell).toHaveAttribute(
    "data-band-request-count",
    bandRequests ?? "0",
  );
  await expect(shell).toHaveAttribute(
    "data-sweep-count",
    sweepRequests ?? "0",
  );
});

test("automatically refines q=31 dispersion without detaching the lifted symmetry path", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop 3D refinement");
  test.setTimeout(120_000);
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=31&t=1&alpha=1&tn=1&td=2&period=1&bgt=0.01",
  );
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-band-request-count", "1", {
    timeout: 30_000,
  });
  await page.getByLabel("Band", { exact: true }).selectOption("14");
  const cut = page.getByRole("img", {
    name: "Band energies along the high-symmetry path with density of states",
  });
  const scene = page.locator(".surface-canvas");
  const bandRequests = await shell.getAttribute("data-band-request-count");
  const sweepRequests = await shell.getAttribute("data-sweep-count");
  await expect(shell).toHaveAttribute("data-dispersion-request-count", "1");
  await expect(page.locator(".adaptive-resolution-row")).toHaveAttribute(
    "data-dispersion-resolution",
    "optimized",
    { timeout: 90_000 },
  );
  await expect(cut).toHaveAttribute("data-dispersion-source", "refined");
  await expect(cut).toHaveAttribute("data-path-points", "497");
  await expect(cut).toHaveAttribute("data-path-samples-per-segment", "124");
  await expect(scene).toHaveAttribute("data-surface-samples", "125");
  await expect(scene).toHaveAttribute("data-dispersion-source", "refined");
  await expect(scene).toHaveAttribute("data-path-points", "497");
  await expect(scene).toHaveAttribute(
    "data-lifted-path-energy-source",
    "display-surface",
  );
  await expect(page.locator(".surface-note")).toContainText(
    "adaptive energy detail",
  );
  await expect(
    page.getByRole("button", { name: /Refine (topology|dispersion)/ }),
  ).toHaveCount(0);
  await expect(shell).toHaveAttribute(
    "data-band-request-count",
    bandRequests ?? "0",
  );
  await expect(shell).toHaveAttribute(
    "data-sweep-count",
    sweepRequests ?? "0",
  );
});

test("links property-table hover and selection to the band group", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await configureApp(page,
    "/?view=bands&lat=square&p=1&q=4&t=1&alpha=1&tn=1&td=2&period=1&samp=11&bgt=0.01",
  );
  await waitForBandGrid(page);
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
  await configureApp(page,
    "/?view=bands&lat=square&p=1&q=5&t=1&alpha=1&tn=1&td=2&period=1&samp=11",
  );
  await waitForBandGrid(page);
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
  await expect(scene).toHaveAttribute(
    "data-lifted-path-energy-source",
    "display-surface",
  );
  await expect(scene).toHaveAttribute("data-symmetry-path", "visible");
  await page.getByRole("button", { name: "Γ path" }).click();
  await expect(scene).toHaveAttribute("data-symmetry-path", "hidden");
  await page.getByRole("button", { name: "Γ path" }).click();
  await expect(scene).toHaveAttribute("data-symmetry-path", "visible");

  await page.getByRole("button", { name: /Lattice \+ BZ/ }).click();
  await expect(page.locator(".runtime-status")).toContainText(
    "Lattice geometry ready",
    { timeout: 30_000 },
  );
  await expect(page.locator(".symmetry-points")).toContainText("ΓXMY");
});

test("drags the linked coprime flux cursor without launching another sweep", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "wide single-workspace interaction");
  test.setTimeout(60_000);
  await configureApp(page,
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

  await expect(page.getByLabel("p", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("q", { exact: true })).toHaveValue("7");
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
  await configureApp(page,
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
  await configureApp(page,
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
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=4&t=1&alpha=1&tn=1&td=2&period=1&samp=7&bgt=0.01",
  );
  await waitForBandGrid(page);
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

test("marks unsupported fast topology as unavailable instead of physical C = 0", async ({
  page,
}) => {
  await configureApp(page,
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

test("morphs the selected energy sheet into an educational BZ torus", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await configureApp(page,
    "/?focus=bands&lat=square&p=1&q=3&t=1&alpha=1&tn=1&td=2&period=1&samp=7",
  );
  await waitForBandGrid(page);
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
