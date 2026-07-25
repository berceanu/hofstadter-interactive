# Harper / Hofstadter Interactive

A local-first interactive laboratory for Hofstadter butterflies, Wannier
diagrams, real-space lattices, Brillouin zones, band surfaces, Berry flux, and
Chern topology.

The interface is one persistent three-column scientific workspace intended for
desktop windows at least 1200 px wide. Butterfly, Wannier, lattice/BZ, and
current-flux band results remain visible and linked without alternate tab or
focus modes.

The numerical core is the validated GPL-3.0
[HofstadterTools](https://hofstadter.tools) implementation. Calculations run in
one persistent Pyodide Web Worker; the frontend never calls Pyodide directly.
Progressive butterfly batches cross the worker boundary as transferable typed
arrays and stay outside Zustand.

Hover inspection uses a 72×72 spatial hash over normalized plot coordinates,
so pointer readouts do not require a DOM node or React component per state.
Each computation has a request ID; stale results are ignored, and progressive
butterfly work can be cancelled between small Python batches.

Band resolution is automatic. A lightweight q- and lattice-aware preview is
replaced by finer energy detail for the current zoom, while topology is
computed only for the active band group and refined until Berry and Wilson
diagnostics certify it. Sampling and convergence are intentionally not user
controls.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm install
npm run prepare:static
npm run dev
```

## Validate

Keep the edit loop short:

```bash
npm run check:fast
```

This runs the frontend unit suite and TypeScript check, normally in a few
seconds. While editing, run only the regression nearest the change:

```bash
npm test -- web/src/compute/computeKeys.test.ts
.venv/bin/python -m pytest -q src/HT/tests/test_web_adapter.py -k dispersion
npx playwright test --project=chromium -g "automatically resolves an aliased q=31"
```

Before handing off an integrated browser change, run the small desktop smoke
set:

```bash
npm run check:smoke
```

Reserve the complete native/Pyodide/desktop browser matrix for push, deploy,
or release boundaries:

```bash
npm run check:release
npm run audit:report
npm run benchmark
```

The Vite base path defaults to `/hofstadter-interactive/` for GitHub Pages and
can be changed with `VITE_BASE_PATH`.

The latest comprehensive browser, physics, accessibility, and performance
audit is published with the app at
[`/audit/HH_INTERACTIVE_AUDIT.html`](public/audit/HH_INTERACTIVE_AUDIT.html).
`npm run audit:report` regenerates numerical and accessibility evidence, runs
the complete Playwright project matrix, and always attempts to render the
result—even when a check fails. Every generated evidence file records the
generating commit and a SHA-256 fingerprint of all non-ignored source files.
The content fingerprint is authoritative—unlike a commit ID, it remains valid
when the generated evidence is committed—so the report builder cannot publish
an inherited PASS.

Measured on an Apple M-series laptop with Headless Chrome 149, the square
q=97 workload rendered its first batch in 0.014 s and completed 9,312 states in
6.56 s after the runtime was ready. See [BENCHMARK.json](BENCHMARK.json).

## Architecture

```text
React + SVG + React Three Fiber
              ↓
       ComputeEngine
              ↓
           Comlink
              ↓
 persistent Pyodide Web Worker
              ↓
 NumPy + HofstadterTools adapters
```

## License and citation

GPL-3.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

If this software contributes to research, cite Bartholomew Andrews,
“HofstadterTools: A Python package for analyzing the Hofstadter model,” JOSS
9(95), 6356 (2024), https://doi.org/10.21105/joss.06356.
