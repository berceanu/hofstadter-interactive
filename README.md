# Harper / Hofstadter Interactive

A local-first interactive laboratory for Hofstadter butterflies, Wannier
diagrams, real-space lattices, Brillouin zones, band surfaces, Berry flux, and
Chern topology.

The numerical core is the validated GPL-3.0
[HofstadterTools](https://hofstadter.tools) implementation. Calculations run in
one persistent Pyodide Web Worker; the frontend never calls Pyodide directly.
Progressive butterfly batches cross the worker boundary as transferable typed
arrays and stay outside Zustand.

Hover inspection uses a 72×72 spatial hash over normalized plot coordinates,
so pointer readouts do not require a DOM node or React component per state.
Each computation has a request ID; stale results are ignored, and progressive
butterfly work can be cancelled between small Python batches.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm install
npm run prepare:static
npm run dev
```

## Validate

```bash
npm test
npm run python:test
npm run test:pyodide
npm run build
npm run test:e2e
npm run audit:report
npm run benchmark
```

The Vite base path defaults to `/hofstadter-interactive/` for GitHub Pages and
can be changed with `VITE_BASE_PATH`.

The latest comprehensive browser, physics, accessibility, and performance
audit is published with the app at
[`/audit/HH_INTERACTIVE_AUDIT.html`](public/audit/HH_INTERACTIVE_AUDIT.html).

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
