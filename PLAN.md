# Build an Interactive HofstadterTools Web Application

## Context

HofstadterTools is an existing GPL-3.0 Python package for calculating Hofstadter spectra, band structures, topology, and lattice properties. Build a polished interactive website based on [hofstadter.tools](https://hofstadter.tools) while preserving its validated numerical implementation.

Inspect the repository, model classes, packaging metadata, CLI programs, tests, license, and citation metadata before changing anything.
You will create a local git repo in this dir, starting as a base from the HH tools code, and upload it (via GH cli) to a newly created public GH repo under berceanu/hofstadter-interactive

## Goals

Users should be able to:

- configure lattice, hopping, flux, and sampling parameters;
- generate Hofstadter butterflies and Wannier diagrams;
- explore real-space lattices and Brillouin zones;
- inspect linked 2D plots and rotatable 3D band surfaces;
- color results by Chern number where supported;
- hover or select points to inspect \(\phi=p/q\), energy, band, and topology;
- share the current view through URL-encoded parameters;
- export data as CSV or NPZ and figures as PNG;
- run calculations locally without a server.

The interface must be responsive, accessible, and honest about loading and computation progress.

## Stack

Use these pinned baselines and commit the exact resolved versions in the lockfile:

- [React](https://www.npmjs.com/package/react), TypeScript, and [Vite](https://www.npmjs.com/package/vite);
- [Three.js](https://www.npmjs.com/package/three);
- [React Three Fiber](https://www.npmjs.com/package/%40react-three/fiber) and a compatible pinned Drei version;
- native SVG for axes, labels, lattice diagrams, and ordinary 2D plots;
- focused D3 modules for mathematics only: scales, paths, arrays, and zoom transforms;
- React must own all SVG DOM rendering; do not use `d3-selection` or imperatively append SVG elements;
- Zustand for parameters, selections, and UI state;
- Pyodide running in one persistent Web Worker;
- Comlink for the worker API;
- the existing HofstadterTools code and NumPy for computation;
- Vitest, React Testing Library, Playwright, and pytest.
- Use the latest stable version for everything

Do not add SciPy unless inspection or benchmarks demonstrate a real requirement. The audited implementation currently uses `numpy.linalg`.

## Architecture

```text
React visualizations
        ↓
ComputeEngine interface
        ↓
Comlink
        ↓
persistent Web Worker
        ↓
Pyodide + NumPy + HofstadterTools
```

The frontend must not call Pyodide directly. Define a replaceable `ComputeEngine` so a future server implementation can use the same result contracts.

Use one long-lived worker. Every request must have an ID. Ignore stale results and schedule expensive work in batches.

Do not use `SharedArrayBuffer` or require COOP/COEP headers. True cancellation during a single synchronous eigensolve is unavailable. For butterflies, have JavaScript orchestrate repeated Python batch calls so the worker event loop can process cancellation between batches. Terminating and recreating the worker is an acceptable fallback for an otherwise uninterruptible calculation.

## Python integration

First try wrapping the existing package rather than creating a maintenance fork. Add a thin adapter that imports only model and computation paths and never imports `HT.plot` or CLI modules.

The current package imports Matplotlib from computation-adjacent modules and declares desktop/notebook packages as mandatory. Prefer a minimal, upstream-friendly refactor that makes plotting imports lazy and moves dependencies into optional extras. Do not change Hamiltonians or numerical algorithms.

Expose pure functions such as:

```python
compute_butterfly_batch(parameters, p_start, p_end)
compute_bands(parameters)
compute_lattice(parameters)
```

These functions must not invoke CLI parsing, Matplotlib, file saving, logging, or terminal progress bars.

Build a trimmed pure-Python wheel, copy it into Vite’s `public/python/` directory, and load it over HTTP with `micropip.install()`. Until dependency metadata is cleaned up, install it with dependency resolution disabled after explicitly loading NumPy.

## Streaming and progress

The butterfly must stream incremental results:

1. Divide the flux sweep into small batches.
2. Compute one batch at a time.
3. return typed arrays plus a progress fraction;
4. yield to the worker event loop;
5. check whether the request is stale or cancelled;
6. render each completed batch immediately.

Distinguish these UI phases:

- downloading the Python runtime and numerical packages, approximately 15–25 MB on first visit;
- initializing Python;
- loading HofstadterTools;
- computing, with real progress;
- rendering.

After the runtime is ready, target:

- first meaningful butterfly render in under 1 second;
- complete square-lattice \(q=97\) butterfly in under 10 seconds on a documented mid-range laptop;
- responsive pan, zoom, hover, and controls throughout rendering.

Measure and report actual results instead of silently relaxing the target.

## Data boundary

Never send live Pyodide proxy objects through Comlink.

Convert NumPy results into JavaScript typed arrays, copy them into transferable `ArrayBuffer`s, and explicitly destroy temporary Pyodide proxies. Preserve numerical results as `Float64Array`; convert to `Float32Array` only when uploading data to the GPU.

Zustand must not contain multi-megabyte numerical arrays. Store those in an imperative result cache keyed by request ID or computation key. Zustand should hold parameters, selected points, progress, errors, and lightweight metadata.

Define stable contracts early for:

- plain butterfly points;
- Chern-colored points;
- Wannier data;
- band surfaces;
- hover/picking metadata;
- progressive chunks and completion state.

## Visualization requirements

The Hofstadter butterfly is always a GPU-rendered point cloud, including the first implementation.

Use:

- a Three.js/R3F point cloud;
- an orthographic camera;
- 2D pan and zoom mapped to physical data axes;
- no `OrbitControls` for the butterfly;
- SVG overlays for axes, ticks, labels, legends, and color bars;
- a documented GPU-picking or spatial-index strategy for hover readouts;
- no DOM element or React component per data point.

Support plain, Chern-colored, and Wannier modes from the beginning because they affect the computation and data contracts.

Use SVG for:

- real-space lattice sites and hopping links;
- ordinary and magnetic unit cells;
- Brillouin-zone boundaries;
- axes, labels, annotations, band cuts, and density-of-states curves.

Use perspective R3F scenes and appropriate camera controls for genuinely 3D band and Berry-curvature surfaces. Prefer shared `BufferGeometry`, instancing, and point clouds over per-point objects.

## State, URLs, and export

Encode all scientifically meaningful parameters and the active visualization in the URL. Loading a shared URL must reproduce the same calculation and view.

Provide:

- CSV export for tabular point data;
- NPZ export for complete numerical results;
- PNG export that combines the WebGL plot with its SVG axes and annotations;
- clear filenames containing the relevant lattice and flux parameters.

## Validation

Run the complete existing pytest suite natively.

For Pyodide CI, create a small golden-file parity harness around the new `compute_*` entry points. Cover representative square, triangular, honeycomb, and kagome cases.

Require:

- energies matching native results with approximately `rtol=1e-9`;
- exact agreement for integer Chern numbers;
- matching array shapes and finite values.

Do not compare raw eigenvectors elementwise. Their phases and bases inside degenerate subspaces may differ between numerical builds. Compare gauge-invariant derived quantities where needed.

## Licensing and attribution

Preserve all HofstadterTools GPL-3.0 notices and use a GPL-3.0-compatible license for the distributed combined application unless the project owner obtains different legal guidance.

Include:

- a repository `LICENSE`;
- source and dependency notices;
- a visible footer linking to HofstadterTools;

## Deployment

Deploy through GitHub Pages under the repository subpath, with Vite’s base path configured accordingly. Keep the base path configurable for a later custom domain.

Add a GitHub Actions workflow that:

- runs frontend tests;
- runs native Python tests;
- runs the Pyodide parity harness;
- builds the Python wheel;
- copies pinned Pyodide assets and the wheel into the static build;
- builds and deploys the site.

Do not depend on custom response headers or cross-origin isolation.

## Non-goals

Do not initially add:

- FastAPI or another backend;
- a database or authentication;
- Next.js;
- Rust/WASM rewrites;
- Plotly, PixiJS, or a broad charting framework;
- Celery, Redis, or distributed jobs;
- unrequested changes to the underlying physics.

A server-backed computation engine may be added later only if measured browser performance fails the stated targets.

## Suggested order

1. Wrap the numerical package and identify the smallest unavoidable refactors.
2. Add pure computation entry points and keep native tests passing.
3. Build the Pyodide worker, wheel-loading flow, typed-array boundary, and parity harness.
4. Implement the GPU-first progressive butterfly with plain, Chern, and Wannier contracts.
5. Add URL state, hover/picking, progress, cancellation between batches, and exports.
6. Add real-space lattice and Brillouin-zone SVG views.
7. Add interactive 3D band surfaces.
8. Link selections across views and complete responsive/accessibility work.
9. Benchmark, optimize, and deploy through GitHub Pages.

## Completion criteria

The first release is complete when:

- all computation runs locally in Pyodide;
- native regression tests and Pyodide parity checks pass;
- the butterfly renders progressively as a GPU point cloud;
- the performance targets are measured and met or clearly reported;
- large arrays cross the worker boundary without proxy leaks or Zustand storage;
- URLs reproduce scientific state;
- CSV, NPZ, and PNG exports work;
- 2D and 3D views share parameters and selections;
- licensing and JOSS attribution are present;
- the application deploys successfully as a static GitHub Pages site.
