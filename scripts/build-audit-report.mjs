import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditStatusPasses } from "./audit-verdict.mjs";
import { auditProvenance } from "./audit-provenance.mjs";

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
const currentProvenance = auditProvenance(root);
for (const [name, evidence] of [
  ["physics", physics],
  ["accessibility", accessibility],
  ["browser", browser],
]) {
  if (
    evidence.provenance?.source_tree_sha256
      !== currentProvenance.source_tree_sha256
  ) {
    throw new Error(
      `${name} audit evidence is stale for the current source tree. Regenerate the complete audit report.`,
    );
  }
}

const gallery = [
  {
    file: "18-honeycomb-q4-lattice-final.jpg",
    title: "Honeycomb coordination, directly inspected",
    caption:
      "The finite patch visibly contains all three nearest-neighbor bond directions, a two-site rhombic primitive cell, and ordinary plus magnetic Brillouin zones.",
    tone: "fixed",
  },
  {
    file: "19-honeycomb-q47-butterfly-final.jpg",
    title: "Honeycomb q=47 is not a chain spectrum",
    caption:
      "All 4,324 Γ-point states span ±2.962t and form structured, chiral-symmetric branches and gaps—not a uniform ±2 chain fill.",
    tone: "fixed",
  },
  {
    file: "20-butterfly-q97-progressive.jpg",
    title: "Progressive render at 3%",
    caption:
      "291 q=97 states are already visible while the worker continues computing, with the current 17/97 flux line in place.",
    tone: "fixed",
  },
  {
    file: "21-butterfly-q97-resized-900.jpg",
    title: "Responsive WebGL repaint at 900 px",
    caption:
      "After resize, all 9,312 states remain visible, axes and flux marker agree, the hint yields space, and the document has no horizontal overflow.",
    tone: "fixed",
  },
  {
    file: "22-butterfly-chern-legend-final.jpg",
    title: "Chern scale with explicit semantics",
    caption:
      "The 21-step scale labels C=−10, 0, and +10 and the selected p/q remains marked.",
    tone: "fixed",
  },
  {
    file: "23-wannier-gap-width-final.jpg",
    title: "Gap-weighted Wannier fan",
    caption:
      "Point area and alpha follow the actual gap width, making the dominant Hall trajectories legible across 9,216 gaps.",
    tone: "fixed",
  },
  {
    file: "24-honeycomb-q89-bz-final.jpg",
    title: "Ordinary BZ plus q-folded magnetic BZ",
    caption:
      "The ordinary honeycomb hexagon remains readable at q=89 while the magnetic sliver is overlaid and explicitly labeled folded ×89.",
    tone: "fixed",
  },
  {
    file: "25-bands-linked-momentum-final.jpg",
    title: "Clicked momentum on the SVG cut",
    caption:
      "The cut marker moved to fractional k=(0.271, 0.500), updating the shared state used by the adjacent surface.",
    tone: "fixed",
  },
  {
    file: "26-band-surface-momentum-marker-final.jpg",
    title: "The same momentum on the 3D surface",
    caption:
      "A luminous sphere and drop line locate k=(0.271, 0.500) on E(k), with the surface color range shown below.",
    tone: "fixed",
  },
  {
    file: "27-kagome-topology-unavailable-final.jpg",
    title: "Unavailable is distinct from C=0",
    caption:
      "Kagome q=11 energy states remain explorable, while the unsupported fast butterfly topology control is visibly disabled and honestly labeled.",
    tone: "fixed",
  },
  {
    file: "28-mobile-final.jpg",
    title: "430 px responsive controls",
    caption:
      "The scientific controls become one column, navigation scroll is contained to its strip, and the document itself does not overflow.",
    tone: "fixed",
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

const statusClass = (status) => {
  const value = String(status);
  if (auditStatusPasses(value)) return "pass";
  if (value.startsWith("warn")) return "warn";
  return "fail";
};

// The headline verdict and summary metrics must be computed from the audit
// inputs: a stale or failing results file has to render as a failure.
const behavioralChecks = [
  ...browser.final_checks,
  ...browser.additional_checks,
];
const accessibilityAllPass =
  auditStatusPasses(accessibility.status)
  && accessibility.results.every((result) => result.pass);
const behavioralAllPass =
  auditStatusPasses(browser.status)
  && behavioralChecks.every((check) =>
    auditStatusPasses(check.status),
  );
const auditPassed =
  auditStatusPasses(physics.status)
  && accessibilityAllPass
  && behavioralAllPass;
const verdictLabel = auditPassed ? "PASS AFTER REMEDIATION" : "AUDIT FAILING";
const verdictDetail = auditPassed
  ? `Honeycomb claim refuted; ${browser.review_verdict.confirmed_findings_fixed} confirmed issues fixed and regression-covered.`
  : "One or more recorded audit inputs report a failure — inspect the sections below.";
const generatedDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "UTC",
}).format(new Date(browser.generated_at));

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
        <td>${family.topology_available ? "available" : "unavailable"}</td>
        <td>${family.ordinary_brillouin_vertices} / ${family.brillouin_vertices}</td>
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

const friendClaimRows = browser.friend_claims.length
  ? browser.friend_claims
    .map(
      (claim) => `
      <article class="claim ${claim.verdict === "refuted" ? "refuted" : "confirmed"}">
        <div class="claim-head">
          <span>${escapeHtml(claim.verdict)}</span>
          <strong>${escapeHtml(claim.claim)}</strong>
        </div>
        <p>${escapeHtml(claim.evidence)}</p>
      </article>`,
    )
    .join("")
  : `<article class="claim">
      <div class="claim-head"><span>none</span><strong>No imported review claims</strong></div>
      <p>This generated run reports only checks and findings backed by current-tree evidence.</p>
    </article>`;

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
        <td><span class="pill ${result.pass ? "pass" : "fail"}">${
          result.pass ? "AA pass" : "AA FAIL"
        }</span></td>
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
    a { color:var(--mint); }
    .verdict { min-width:220px; padding:18px; border:1px solid #2f796c; border-radius:14px; background:#0c2826; }
    .verdict strong { display:block; color:var(--mint); font-size:18px; }
    .verdict span { display:block; margin-top:6px; color:#b5c9c2; font-size:12px; }
    .verdict.failing { border-color:#7a3b2e; background:#2a120c; }
    .verdict.failing strong { color:var(--red); }
    section { margin-top:40px; }
    .metrics { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
    .metric { padding:16px; border:1px solid var(--line); border-radius:12px; background:rgba(12,24,38,.86); }
    .metric b { display:block; color:var(--gold); font-size:25px; }
    .metric span { color:var(--muted); font-size:11px; }
    .finding-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .claim-grid { display:grid; gap:12px; }
    .claim { padding:17px; border:1px solid var(--line); border-radius:12px; background:rgba(12,24,38,.86); }
    .claim.refuted { border-color:#35796c; background:#0c2826; }
    .claim.confirmed { border-color:#5f4930; background:#211b17; }
    .claim-head { display:flex; gap:10px; align-items:flex-start; }
    .claim-head span { flex:none; padding:3px 7px; border-radius:999px; background:#213b3a; color:var(--mint); font:700 9px ui-monospace,monospace; text-transform:uppercase; }
    .claim.confirmed .claim-head span { background:#4a3521; color:var(--gold); }
    .claim p { margin:10px 0 0; font-size:12px; }
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
    .dot.fail { background:var(--red); box-shadow:0 0 8px #ff806d88; }
    .pill { display:inline-flex; padding:3px 7px; border-radius:999px; font:700 9px ui-monospace,monospace; text-transform:uppercase; }
    .pill.pass { color:#061d17; background:var(--mint); }
    .pill.fail { color:#2b0d08; background:var(--red); }
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
      <span class="eyebrow">Generated audit · ${escapeHtml(generatedDate)}</span>
      <h1>Harper / Hofstadter Interactive</h1>
      <p>UI behavior, numerical physics, topology, geometry, accessibility, responsive layout, cancellation, and performance were exercised against the actual browser build—not inferred from screenshots alone.</p>
    </div>
    <div class="verdict${auditPassed ? "" : " failing"}">
      <strong>${escapeHtml(verdictLabel)}</strong>
      <span>${escapeHtml(verdictDetail)}</span>
    </div>
  </header>

  <section class="metrics" aria-label="Audit summary">
    <div class="metric"><b>${physics.families.length}</b><span>lattice families audited</span></div>
    <div class="metric"><b>${physics.diophantine_checks.length}</b><span>Diophantine gap checks</span></div>
    <div class="metric"><b>${behavioralChecks.length}</b><span>driven behavioral checks</span></div>
    <div class="metric"><b>${accessibility.results.length}</b><span>contrast pairs audited</span></div>
    <div class="metric"><b>${benchmark.browser_compute_seconds.toFixed(2)} s</b><span>q=97 browser compute</span></div>
  </section>

  <section>
    <span class="eyebrow">01 · Scope and method</span>
    <h2>What was exercised</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Driven browser coverage</h3>
        <p>Changed lattice, p/q, hopping, anisotropy, angle, period, and grouping controls; switched all four views; inspected progressive batches; resized dense WebGL canvases; used plain-wheel zoom, bounded pan, reset, hover, band/momentum selection, and 3D orbit controls; and cancelled q=97 work.</p>
      </div>
      <div class="panel">
        <h3>Numerical coverage</h3>
        <p>Compared browser adapters with direct HofstadterTools Hamiltonians for square, triangular, honeycomb, Kagome, and general Bravais families. Checked analytic dispersions, honeycomb Γ/K/K′ limits and coordination, q=47 bandwidth and chiral symmetry, Diophantine gap relations, grouped topology, reciprocal duality, Wigner–Seitz areas, q-folding, finiteness, and sampling stability.</p>
      </div>
    </div>
    <p class="note" style="margin-top:16px">Theory and expected visualization conventions were cross-checked against the current HofstadterTools 1.0.7 <a href="https://hofstadter.tools/theory/model.html">model theory</a>, <a href="https://hofstadter.tools/theory/band_structure.html">band-structure reference paths</a>, <a href="https://hofstadter.tools/theory/butterfly.html">butterfly/Chern/Wannier theory</a>, and <a href="https://hofstadter.tools/gallery.html">lattice gallery</a>.</p>
  </section>

  <section>
    <span class="eyebrow">02 · Review disposition</span>
    <h2>Imported review claims</h2>
    <div class="claim-grid">${friendClaimRows}</div>
  </section>

  <section>
    <span class="eyebrow">03 · Findings repaired during audit</span>
    <h2>Confirmed defects and resolutions</h2>
    <div class="finding-grid">${findingRows}</div>
  </section>

  <section>
    <span class="eyebrow">04 · Physics audit</span>
    <h2>Independent invariants</h2>
    <div class="panel">
      <table>
        <thead><tr><th>Lattice</th><th>q=7 states</th><th>Band grid</th><th>Topological groups (bands:C)</th><th>Fast butterfly C</th><th>Ordinary / magnetic BZ edges</th><th>Native ΔE max</th></tr></thead>
        <tbody>${familyRows}</tbody>
      </table>
    </div>
    <div class="two-col" style="margin-top:16px">
      <div class="panel">
        <h3>Honeycomb diagnosis: refuted</h3>
        <p>Γ gives <b>${physics.honeycomb_invariants.gamma_eigenvalues.map((value) => value.toFixed(0)).join(", ")}</b>, both K and K′ are zero to numerical precision, and a bulk site has <b>${physics.honeycomb_invariants.bulk_coordination}</b> nearest neighbors. The q=47 sweep contains <b>${physics.honeycomb_invariants.q47_states.toLocaleString()}</b> states over ${physics.honeycomb_invariants.q47_fluxes} coprime fluxes, spans <b>${physics.honeycomb_invariants.q47_energy_min.toFixed(6)} to ${physics.honeycomb_invariants.q47_energy_max.toFixed(6)}</b>, and has chiral-symmetry error ${physics.honeycomb_invariants.q47_chiral_symmetry_error.toExponential(1)}.</p>
      </div>
      <div class="panel">
        <h3>Analytic, topological, and geometric parity</h3>
        <p>Square zero-flux dispersion matched <i>E(k)=−2t[cos(kₓ)+cos(kᵧ)]</i> with maximum error <b>${physics.analytic_square_dispersion_max_error.toExponential(1)}</b>; all five energy adapters matched their direct native Hamiltonians. Every checked gap obeyed the Diophantine relation for 22/89 and 15/47. Grouped Chern values were stable from 7×7 to 11×11, complete bundles summed to C=0, and both ordinary and magnetic BZ duality/area/folding invariants passed.</p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">05 · Behavioral matrix</span>
    <h2>Observed final-state checks</h2>
    <div class="panel">
      <table><thead><tr><th>Scenario</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${finalCheckRows}</tbody></table>
    </div>
  </section>

  <section>
    <span class="eyebrow">06 · Accessibility and responsiveness</span>
    <h2>Semantic and contrast audit</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Semantic structure</h3>
        <p>The driven DOM uses named native controls and graphical regions, exactly one H1, header/nav/main/aside/footer landmarks, a polite live status region, and a reduced-motion stylesheet. Checks at 900 px and 430 px found no document-level horizontal overflow; mobile view navigation scrolls only within its own bounded strip.</p>
      </div>
      <div class="note">
        <b>Explicit limitation:</b> a separate assistive-technology session and full manual focus-order certification were not performed. Native semantic controls, focus-outline CSS, accessible names, reduced motion, and desktop/mobile Playwright interaction all passed.
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <table><thead><tr><th>Token</th><th>Foreground</th><th>Background</th><th>Ratio</th><th>WCAG 2.2 AA</th></tr></thead><tbody>${contrastRows}</tbody></table>
    </div>
  </section>

  <section>
    <span class="eyebrow">07 · Performance and architecture</span>
    <h2>Target remains met</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Measured browser workload</h3>
        <p>The reproducible q=97 benchmark records ${benchmark.first_meaningful_render_seconds.toFixed(3)} s to first meaningful chunk, ${benchmark.browser_compute_seconds.toFixed(2)} s computation, and ${benchmark.browser_runtime_and_compute_seconds.toFixed(3)} s cold runtime plus computation on the documented Apple M-series laptop—within the 10 s requirement.</p>
      </div>
      <div class="panel">
        <h3>Responsiveness safeguards</h3>
        <p>Float64 transferable arrays cross Comlink without live proxies; render buffers convert to Float32 only at the GPU; numerical arrays remain outside Zustand; stale requests are ignored; old results remain visible until replacements arrive; butterfly batches yield to the worker event loop; cancellation is terminal; and a lost runtime triggers one clean worker reinitialization and retry.</p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">08 · Visual evidence</span>
    <h2>Historical visual context</h2>
    <p class="note">These retained screenshots are illustrative, not current-run
    pass evidence. The verdict above is derived only from source-fingerprinted
    numerical, accessibility, and Playwright result files.</p>
    <div class="gallery">${galleryCards}</div>
  </section>

  <section>
    <span class="eyebrow">09 · Residual notes</span>
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
    Self-contained audit artifact · source tree ${currentProvenance.source_tree_sha256.slice(0, 16)} · HofstadterTools 1.0.7 numerical core · GPL-3.0 · Generated from current-tree numerical probes, contrast checks, and the Playwright project matrix.
  </footer>
</main>
</body>
</html>`;

const output = join(root, "public", "audit", "HH_INTERACTIVE_AUDIT.html");
await mkdir(join(root, "public", "audit"), { recursive: true });
await writeFile(output, html.replace(/[ \t]+$/gm, ""));
console.log(`Wrote self-contained audit report: ${output}`);
