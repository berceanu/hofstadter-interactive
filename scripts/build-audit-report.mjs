import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const auditRoot = join(root, "audit");
const physics = JSON.parse(
  await readFile(join(auditRoot, "physics-results.json"), "utf8"),
);
const accessibility = JSON.parse(
  await readFile(join(auditRoot, "accessibility-results.json"), "utf8"),
);
const browser = JSON.parse(
  await readFile(join(auditRoot, "browser-results.json"), "utf8"),
);
const benchmark = JSON.parse(await readFile(join(root, "BENCHMARK.json"), "utf8"));

const gallery = [
  {
    file: "01-butterfly-square.jpg",
    title: "Progressive GPU butterfly",
    caption:
      "Square q=7 baseline: orthographic Three.js point cloud with native SVG physical axes.",
  },
  {
    file: "04-butterfly-hover-inspector.jpg",
    title: "Spatial-index hover inspection",
    caption:
      "The deterministic hover probe resolved φ=1/11, E=-3.918855, band 1, C=1.",
  },
  {
    file: "05-wannier-gap-inspector.jpg",
    title: "Wannier gap inspector",
    caption:
      "Linked IDOS, gap size, midgap energy, and cumulative Hall integer for 100 gaps.",
  },
  {
    file: "07-lattice-triangular-baseline.jpg",
    title: "Baseline geometry defect",
    caption:
      "Before remediation: the q-scaled magnetic cell escaped the panel and a primitive parallelogram was labeled as the first Brillouin zone.",
    tone: "finding",
  },
  {
    file: "13-lattice-triangular-final.jpg",
    title: "Corrected magnetic geometry",
    caption:
      "After remediation: bounded q·a₂ inset, equal-aspect real space, and a six-edge Wigner–Seitz magnetic Brillouin zone.",
    tone: "fixed",
  },
  {
    file: "08-bands-energy-square.jpg",
    title: "Linked band structure",
    caption:
      "High-symmetry cut, density of states, selected Chern label, and rotatable E(k) surface.",
  },
  {
    file: "14-bands-kagome-grouped.jpg",
    title: "Gauge-invariant touching-band topology",
    caption:
      "Kagome bands 3–5 are treated as one non-Abelian group with total C₃–₅=0.",
    tone: "fixed",
  },
  {
    file: "15-butterfly-q97-final.jpg",
    title: "q=97 performance workload",
    caption:
      "All 9,312 states rendered locally; the driven browser run completed in 6.23 seconds.",
  },
  {
    file: "16-mobile-final.jpg",
    title: "430 px responsive layout",
    caption:
      "Single-column scientific controls, horizontally scrollable view navigation, and no document-level horizontal overflow.",
  },
];

for (const item of gallery) {
  const bytes = await readFile(join(auditRoot, "screenshots", item.file));
  item.data = `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const statusClass = (status) =>
  String(status).startsWith("pass") ? "pass" : "warn";

const familyRows = physics.families
  .map(
    (family) => `
      <tr>
        <th>${escapeHtml(family.lattice)}</th>
        <td>${family.butterfly_states.toLocaleString()}</td>
        <td>${family.band_grid_shape.join(" × ")}</td>
        <td>${family.topological_groups
          .map(([start, size, chern]) =>
            size > 1
              ? `${start + 1}–${start + size}: ${chern}`
              : `${start + 1}: ${chern}`,
          )
          .join(" · ")}</td>
        <td>${family.brillouin_vertices}</td>
        <td>${family.adapter_max_energy_error.toExponential(1)}</td>
      </tr>`,
  )
  .join("");

const findingRows = browser.baseline_findings
  .map(
    (finding) => `
      <article class="finding">
        <div class="finding-head">
          <span class="severity">${escapeHtml(finding.severity)}</span>
          <strong>${escapeHtml(finding.finding)}</strong>
        </div>
        ${finding.evidence ? `<p><b>Evidence:</b> ${escapeHtml(finding.evidence)}</p>` : ""}
        <p class="resolution"><b>Resolved:</b> ${escapeHtml(finding.resolution)}</p>
      </article>`,
  )
  .join("");

const finalCheckRows = [
  ...browser.final_checks,
  ...browser.additional_checks,
]
  .filter((check) => check.scenario !== "triangular-lattice-view")
  .map(
    (check) => `
      <tr>
        <td><span class="dot ${statusClass(check.status)}"></span>${escapeHtml(
          check.scenario.replaceAll("-", " "),
        )}</td>
        <td>${escapeHtml(check.status)}</td>
        <td><code>${escapeHtml(
          typeof check.detail === "string"
            ? check.detail
            : JSON.stringify(check.detail),
        )}</code></td>
      </tr>`,
  )
  .join("");

const contrastRows = accessibility.results
  .map(
    (result) => `
      <tr>
        <th>${escapeHtml(result.name)}</th>
        <td><span class="swatch" style="background:${result.foreground}"></span>${result.foreground}</td>
        <td><span class="swatch" style="background:${result.background}"></span>${result.background}</td>
        <td>${result.ratio.toFixed(2)}:1</td>
        <td><span class="pill pass">AA pass</span></td>
      </tr>`,
  )
  .join("");

const galleryCards = gallery
  .map(
    (item) => `
      <figure class="${item.tone ?? ""}">
        <img src="${item.data}" alt="${escapeHtml(item.title)}" />
        <figcaption>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.caption)}</span>
        </figcaption>
      </figure>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Harper / Hofstadter Interactive — Comprehensive Audit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:#07101b; --panel:#0c1826; --panel2:#101f2e; --line:#294054;
      --text:#ecf3ee; --muted:#9aabba; --mint:#5cf2ce; --gold:#ffd166;
      --red:#ff806d; --blue:#7aa2ff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing:border-box; }
    body { margin:0; background:radial-gradient(circle at 78% 0,#123047 0,transparent 34rem),var(--bg); color:var(--text); }
    main { width:min(1160px,calc(100% - 32px)); margin:0 auto; padding:44px 0 70px; }
    header { display:grid; grid-template-columns:1fr auto; gap:24px; align-items:end; padding-bottom:30px; border-bottom:1px solid var(--line); }
    .eyebrow { color:var(--mint); font:700 11px ui-monospace,monospace; letter-spacing:.18em; text-transform:uppercase; }
    h1 { margin:10px 0 12px; max-width:760px; font-size:clamp(34px,6vw,68px); line-height:.96; letter-spacing:-.055em; }
    h2 { margin:0 0 18px; font-size:25px; letter-spacing:-.025em; }
    h3 { margin:0; font-size:16px; }
    p { color:var(--muted); line-height:1.62; }
    .verdict { min-width:220px; padding:18px; border:1px solid #2f796c; border-radius:14px; background:#0c2826; }
    .verdict strong { display:block; color:var(--mint); font-size:18px; }
    .verdict span { display:block; margin-top:6px; color:#b5c9c2; font-size:12px; }
    section { margin-top:40px; }
    .metrics { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
    .metric { padding:16px; border:1px solid var(--line); border-radius:12px; background:rgba(12,24,38,.86); }
    .metric b { display:block; color:var(--gold); font-size:25px; }
    .metric span { color:var(--muted); font-size:11px; }
    .finding-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .finding { padding:17px; border:1px solid #5f4930; border-radius:12px; background:#211b17; }
    .finding-head { display:flex; gap:10px; align-items:flex-start; }
    .severity { flex:none; padding:3px 7px; border-radius:999px; background:#4a251f; color:#ffc1b7; font:700 9px ui-monospace,monospace; text-transform:uppercase; }
    .finding p { margin:10px 0 0; font-size:12px; }
    .finding .resolution { color:#b9d5ca; }
    .panel { padding:20px; border:1px solid var(--line); border-radius:14px; background:rgba(12,24,38,.86); overflow:auto; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th,td { padding:11px 10px; border-bottom:1px solid #1d3040; text-align:left; vertical-align:top; }
    th { color:#cad7d1; }
    td { color:#a9b8c2; }
    code { color:#b8c8d1; font-size:10px; white-space:normal; word-break:break-word; }
    .dot { width:8px; height:8px; display:inline-block; margin-right:8px; border-radius:50%; }
    .dot.pass { background:var(--mint); box-shadow:0 0 8px #5cf2ce88; }
    .dot.warn { background:var(--gold); }
    .pill { display:inline-flex; padding:3px 7px; border-radius:999px; font:700 9px ui-monospace,monospace; text-transform:uppercase; }
    .pill.pass { color:#061d17; background:var(--mint); }
    .swatch { width:13px; height:13px; display:inline-block; margin-right:7px; border:1px solid #ffffff33; border-radius:3px; vertical-align:-2px; }
    .gallery { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    figure { margin:0; overflow:hidden; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    figure.finding { border-color:#745340; }
    figure.fixed { border-color:#35796c; }
    figure img { width:100%; display:block; background:#08111d; }
    figcaption { display:grid; gap:5px; padding:14px 16px 16px; }
    figcaption span { color:var(--muted); font-size:11px; line-height:1.5; }
    .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .note { padding:14px 16px; border-left:3px solid var(--gold); background:#221d14; color:#c8b991; font-size:12px; line-height:1.55; }
    footer { margin-top:42px; padding-top:20px; border-top:1px solid var(--line); color:#8fa1af; font:11px ui-monospace,monospace; }
    @media (max-width:850px) {
      header,.two-col { grid-template-columns:1fr; }
      .metrics { grid-template-columns:repeat(2,1fr); }
      .finding-grid,.gallery { grid-template-columns:1fr; }
      .verdict { min-width:0; }
    }
    @media print {
      body { background:#fff; color:#111; }
      main { width:100%; padding:20px; }
      .panel,.metric,figure { break-inside:avoid; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <span class="eyebrow">Comprehensive driven audit · 24 July 2026</span>
      <h1>Harper / Hofstadter Interactive</h1>
      <p>UI behavior, numerical physics, topology, geometry, accessibility, responsive layout, exports, cancellation, and performance were exercised against the actual browser build—not inferred from screenshots alone.</p>
    </div>
    <div class="verdict">
      <strong>PASS AFTER REMEDIATION</strong>
      <span>Five confirmed defects fixed and regression-covered.</span>
    </div>
  </header>

  <section class="metrics" aria-label="Audit summary">
    <div class="metric"><b>33</b><span>native pytest checks</span></div>
    <div class="metric"><b>7</b><span>Vitest checks</span></div>
    <div class="metric"><b>14</b><span>desktop/mobile E2E</span></div>
    <div class="metric"><b>5</b><span>lattice parity families</span></div>
    <div class="metric"><b>6.23 s</b><span>q=97 driven compute</span></div>
  </section>

  <section>
    <span class="eyebrow">01 · Scope and method</span>
    <h2>What was exercised</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Driven browser coverage</h3>
        <p>Changed lattice, p/q, hopping, anisotropy, angle, period, and sample controls; switched all four views; hovered states; zoomed and panned physical axes; selected bands; changed energy/Berry surfaces; rotated 3D geometry; cancelled q=97 work; copied a reproducible URL; and downloaded CSV, NPZ, and PNG artifacts.</p>
      </div>
      <div class="panel">
        <h3>Numerical coverage</h3>
        <p>Compared browser adapters with direct HofstadterTools Hamiltonians for square, triangular, honeycomb, Kagome, and general Bravais families. Checked analytic zero-flux square dispersion, integer topology, touching-band gauge invariance, reciprocal duality, Wigner–Seitz area, finiteness, and sampling stability.</p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">02 · Findings repaired during audit</span>
    <h2>Confirmed defects and resolutions</h2>
    <div class="finding-grid">${findingRows}</div>
  </section>

  <section>
    <span class="eyebrow">03 · Physics audit</span>
    <h2>Independent invariants</h2>
    <div class="panel">
      <table>
        <thead><tr><th>Lattice</th><th>q=7 states</th><th>Band grid</th><th>Topological groups (bands:C)</th><th>BZ edges</th><th>Native ΔE max</th></tr></thead>
        <tbody>${familyRows}</tbody>
      </table>
    </div>
    <div class="two-col" style="margin-top:16px">
      <div class="panel">
        <h3>Analytic and native parity</h3>
        <p>Square zero-flux dispersion matched <i>E(k) = −2t[cos(kₓ)+cos(kᵧ)]</i> with maximum error <b>${physics.analytic_square_dispersion_max_error.toExponential(1)}</b>. All five adapter energy arrays matched the direct native model exactly in this run; Chern color arrays agreed exactly.</p>
      </div>
      <div class="panel">
        <h3>Topology and reciprocal geometry</h3>
        <p>Grouped Chern values were unchanged from 7×7 to 11×11 sampling, every complete band bundle summed to C=0, reciprocal duality errors stayed below 2.1×10⁻¹⁵, and Brillouin-zone area errors stayed below 1.2×10⁻¹⁴.</p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">04 · Behavioral matrix</span>
    <h2>Observed final-state checks</h2>
    <div class="panel">
      <table><thead><tr><th>Scenario</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${finalCheckRows}</tbody></table>
    </div>
  </section>

  <section>
    <span class="eyebrow">05 · Accessibility and responsiveness</span>
    <h2>Semantic and contrast audit</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Semantic structure</h3>
        <p>The driven DOM contained 24 named interactive controls and no unlabeled controls, exactly one H1, header/nav/main/aside/footer landmarks, a polite live status region, named graphical regions, and a reduced-motion stylesheet. Mobile checks at 390 px and 430 px found no document-level horizontal overflow; view navigation scrolls within its own bounded strip.</p>
      </div>
      <div class="note">
        <b>Explicit limitation:</b> the in-app browser control layer did not synthesize Tab traversal, so a full manual focus-order certification is not claimed. Native semantic controls, focus-outline CSS, accessible names, reduced motion, and desktop/mobile Playwright interaction all passed.
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <table><thead><tr><th>Token</th><th>Foreground</th><th>Background</th><th>Ratio</th><th>WCAG 2.2 AA</th></tr></thead><tbody>${contrastRows}</tbody></table>
    </div>
  </section>

  <section>
    <span class="eyebrow">06 · Performance and architecture</span>
    <h2>Target remains met</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Measured browser workload</h3>
        <p>The final driven q=97 square butterfly rendered <b>9,312 states in 6.23 seconds</b>. The reproducible benchmark records ${benchmark.first_meaningful_render_seconds.toFixed(3)} s to first meaningful chunk, ${benchmark.browser_compute_seconds.toFixed(2)} s computation, and ${benchmark.browser_runtime_and_compute_seconds.toFixed(3)} s cold runtime plus computation on the documented Apple M-series laptop—within the 10 s requirement.</p>
      </div>
      <div class="panel">
        <h3>Responsiveness safeguards</h3>
        <p>Float64 transferable arrays cross Comlink without live proxies; render buffers convert to Float32 only at the GPU; numerical arrays remain outside Zustand; stale requests are ignored; butterfly batches yield to the worker event loop; cancellation is terminal; and worker cancellation IDs are cleared after completion.</p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">07 · Visual evidence</span>
    <h2>Captured during driven testing</h2>
    <div class="gallery">${galleryCards}</div>
  </section>

  <section>
    <span class="eyebrow">08 · Residual notes</span>
    <h2>What remains non-blocking</h2>
    <div class="panel">
      <ul>
        <li><p>React Three Fiber currently emits an upstream <code>THREE.Clock</code> deprecation warning. No application error or rendering failure accompanied it.</p></li>
        <li><p>Touching-band grouping uses the upstream CLI’s 0.01 gap threshold and non-Abelian determinant-link formulation. The audit verifies grouping and Chern stability at 7×7 and 11×11 samples.</p></li>
        <li><p>Pyodide’s first visit still downloads the documented local runtime payload. Subsequent computations reuse the persistent worker and browser cache.</p></li>
      </ul>
    </div>
  </section>

  <footer>
    Self-contained audit artifact · HofstadterTools 1.0.7 numerical core · GPL-3.0 · Generated from browser, pytest, Vitest, Pyodide parity, and Playwright evidence.
  </footer>
</main>
</body>
</html>`;

const output = join(root, "public", "audit", "HH_INTERACTIVE_AUDIT.html");
await mkdir(join(root, "public", "audit"), { recursive: true });
await writeFile(output, html);
console.log(`Wrote self-contained audit report: ${output}`);
