# AGENTS.md

## Project

This is a local-first React/Pyodide interface for the GPL-3.0
HofstadterTools 1.0.7 numerical core. Read `PLAN.md`, `UPSTREAM.md`, `NOTICE`,
and the current `CHANGELOG.md` before substantial work.

## Non-negotiable boundaries

- Do not change upstream Hamiltonians or numerical algorithms in `src/HT`.
  Put browser-facing computation in `src/HT/web.py`; use
  `src/HT/band_structure.py` as the reference for upstream table semantics.
- Python browser adapters must use NumPy only—no SciPy, backend, server,
  SharedArrayBuffer, COOP, or COEP.
- React owns SVG DOM. Do not add `d3-selection` or a charting framework.
- Large numerical arrays belong in `web/src/state/resultCache.ts`, never
  Zustand. Transfer typed-array buffers across the worker boundary.
- Preserve stale plots while replacements compute. Cache and schedule each
  result by its real parameter dependencies; moving `p` must not rerun a
  butterfly/Wannier sweep.
- Keep topology and quantum-geometry work lazy and separate from the render
  grid. Resolution is an internal adaptive concern: do not add user-facing
  sample counts or convergence buttons, and never label an uncertified
  invariant as converged.

## Scientific invariants

- Browser lattices force canonical θ: square `1/2`; triangular, honeycomb, and
  kagome `1/3`. Generic Bravais/custom geometries are not browser inputs.
- Always reduce magnetic flux `p/q` to coprime form after an edit is
  committed. Band and group indices are zero-based everywhere.
- Butterfly spectra follow the upstream Γ-point convention. Choose band,
  dispersion, and topology sampling automatically from the physical
  parameters, active selection, viewport, and invariant diagnostics.
- Band grouping defaults to upstream `bgt = 0.01`.
- Match energies at about `rtol=1e-9`, integer topology exactly, and geometry
  statistics at `rtol=1e-6`. Compare gauge-invariant quantities, not raw
  eigenvectors.

## Architecture path

`React components → useCompute scheduler → ComputeEngine → Comlink worker →
src/HT/web.py`

When adding a result:

1. Define its contract and exact cache key.
2. Transfer large arrays; store only compact UI metadata in Zustand.
3. Ignore stale request IDs and preserve the previous visible result.
4. Add native parity first, then worker/frontend coverage, then only the
   browser regression needed for the behavior.

## Fast development loop

Run the smallest relevant regression while editing:

```bash
npm test -- path/to/test.ts
.venv/bin/python -m pytest -q path/to/test.py -k case_name
npx playwright test --project=chromium -g "test title" # run from repo root
```

Then use:

```bash
npm run check:fast       # Vitest + TypeScript; ordinary edit loop
npm run check:smoke      # Fast check + three Chromium integration tests
npm run check:release    # Full native, Pyodide, desktop, and mobile matrix
```

Reserve `check:release` for push, deploy, or release boundaries—not every
iteration. If Python packaged for Pyodide changed, run `npm run
prepare:static` before Pyodide or browser validation. Refresh benchmarks only
for performance-sensitive changes or a release.

## Delivery

- Preserve unrelated user changes and keep edits narrowly scoped.
- Update `CHANGELOG.md` for user-visible behavior.
- Keep GPL-3.0 notices, upstream attribution, and the JOSS citation footer
  intact.
- Do not commit, push, or deploy unless explicitly requested.
- Report which validation tier ran and any known limitation or budget miss.
