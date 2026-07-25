# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Lean edition

- Remove browser CSV, NPZ, ordinary PNG, art PNG, and whole-workspace export,
  along with NPZ file-picker and drag-and-drop import.
- Remove URL hydration, automatic URL synchronization, and copy-link controls;
  each session now starts from the canonical default state.
- Remove the custom-basis lattice editor and its browser-only Python adapter
  override. Named lattices and the general Bravais model remain available.
- Remove the magnetic-period control and force the canonical internal period
  for each lattice preset.
- Standardize topological coloring on the upstream-inspired Avron palette and
  remove palette selection state.

### Adversarial audit remediation

Whole-codebase follow-up:

- Replace pickle-backed native saves with a versioned primitive-only NPZ
  schema loaded with ``allow_pickle=False``. Legacy files require the explicit
  ``--trust-legacy-pickle`` conversion option; regression coverage proves the
  default loader does not execute a malicious pickle.
- Reject browser workloads that exceed conservative sweep, band-grid, or
  geometry working-set budgets before allocating large arrays. Obsolete
  synchronous worker jobs now terminate and recreate the worker, while
  butterfly batches retain cooperative cancellation.
- Correct plot axes and surface copy to label the upstream raw energy ``E``
  instead of claiming ``E/t₁`` normalization.
- Keep ``--help`` usable in NumPy-only installations by delaying optional CLI
  imports until after argument parsing, and direct command users to the
  ``[cli]`` extra when plotting dependencies are absent.
- Harden browser NPZ import with a pre-read 64 MB file cap, exact required
  arrays and topology flag, finite and integer checks, state ordering and
  energy/gap consistency validation, safe shape arithmetic, supported NPY
  versions, and duplicate-metadata rejection.
- Export the six-field lattice-link contract (endpoints, neighbor shell, and
  amplitude) instead of stepping those records as four-field coordinates.
- Clear abandoned quantum-geometry expectations and gate exports only on
  geometry that the current view actually requests.
- Bound hopping magnitudes at both UI and Python boundaries and report an
  explicit domain error for all-zero general-lattice Hamiltonians instead of
  leaking a NumPy eigensolver failure.
- Extend shared URLs to round-trip color mode, palette, surface metric,
  geometry-table state, selected band and momentum, cut zoom, and butterfly
  zoom/pan.
- Add a named, focusable Wilson-row slider with Arrow, Page, Home, and End
  controls, linked to the same momentum state used by pointer interaction.
- Generate browser audit evidence from the live Playwright matrix, fingerprint
  every evidence file to the exact source tree, reject stale inputs, and
  render an honest failing report when any audit command fails.
- Reduce Pages CI to job-scoped permissions, disable persisted checkout
  credentials, pin actions to exact commits, and enforce high-severity npm
  advisory failures before publishing.

Scientific correctness:

- Fix the cumulative Hall labels (`tᵣ`) shown on Wannier gaps for every even
  flux denominator: labels now come from the Diophantine `t_r` table instead
  of a cumulative sum of the per-band coloring, which double-counted the
  duplicated central entry and mislabeled every gap above the central band
  touching (for example square `q = 6` reported −6 and −5 where the open
  gaps carry −2 and −1). The ambiguous, physically closed central gap at
  `r = q/2` is omitted rather than mislabeled. Even-q regression tests were
  added; previous coverage used odd q only.
- Restrict fast Diophantine butterfly coloring to the non-zero,
  nearest-neighbour, unit-period square model. Probes against the app's own
  Wilson-certified Fukui invariants show the square-window coloring is wrong
  for triangular and general Bravais models, honeycomb doubling at even q,
  altered square periods, zero hopping, and extra square hopping shells, so
  those models now report butterfly topology as unavailable instead of
  displaying labels that contradict the certified band topology.
- Reject non-coprime flux fractions at the Python adapter boundary, matching
  the upstream CLI, instead of silently returning a folded spectrum.
- Close the high-symmetry band cut: the path now includes the final Γ sample
  so curves reach the closing tick and the last point is selectable.

Data integrity:

- NPZ import validates instead of fabricating: per-state and per-gap arrays
  with mismatched lengths are rejected (previously zero-padded into
  physical-looking `C = 0` states), the declared flux denominator must equal
  the flux data's canonical denominator (not merely a multiple of it), a
  renamed file's `q` hint is superseded by the data,
  decompressed archives are capped at 64 MB, numpy's native `<i8`/`|b1` and
  other small integer dtypes import correctly, invalid shape headers and
  duplicate array names are rejected, and truncated version-2 headers report
  a clear error.
- Exported NPZ metadata now travels as a `metadata` uint8 array so
  `np.load` users can iterate every key; legacy `metadata.json` archives
  still import.
- Export buttons pause synchronously when live parameters no longer match the
  visible cache, including during the scheduler debounce and quantum-geometry
  replacement, so archives can no longer pair old arrays with new parameter
  metadata and poison the cache on re-import.
- PNG export inlines the computed SVG styles and rasterizes at the output
  scale: axes, tick labels, flux markers, and Brillouin-zone outlines no
  longer vanish from exported images. A failed PNG encode reports an error
  instead of silently downloading nothing. Lattice CSV now includes links,
  the unit cell, and both Brillouin-zone outlines.
- The state inspector derives and coprime-reduces each point's flux fraction
  from the point itself, so imported archives with foreign or multiple
  denominators display correctly.

Interface and pipeline:

- Cancel now cancels: the scheduler stops the remaining queued jobs instead
  of launching the flux sweep after the cancelled computation returns.
- Cancelled or failed butterfly sweeps release their accumulated chunks
  (previously pinned for the whole session).
- Out-of-range band selections are clamped when band results are served
  from cache, fixing the vanishing momentum marker and the false
  "not certified" topology status.
- Topology refinements are cached by resolved band group, so selecting a
  sibling band in the same group or re-entering a parameter set no longer
  reruns an identical multi-second refinement.
- The 3D band surface no longer rebuilds its full geometry on every pointer
  event; result caches evict least-recently-used entries; a background
  dispersion refinement no longer resets a just-selected Wilson marker;
  a failed runtime initialization is retryable instead of cached forever;
  Python exceptions no longer trigger spurious worker restarts.
- Shared URLs round-trip the workspace's active view, and empty hopping
  entries (`?t=` or trailing commas) no longer inject phantom zero-amplitude
  shells.

Trust and delivery:

- The shipped audit report computes its verdict, accessibility pills, and
  summary metrics from the recorded audit inputs instead of hardcoding a
  passing result, recognizes the recorded `pass-*` status variants without
  false-failing, and the contrast audit fails when its audited colors no
  longer appear in the stylesheet.
- CI now also boots the built production bundle at the deployed base path
  (`npm run test:e2e:dist`) so a base-path or asset regression cannot ship
  green, and `prepare:static` verifies the wheel filename referenced by the
  runtime matches the version in `pyproject.toml`.
- `tests/golden/web_advanced_parity.json` gained the previously missing
  generator (`scripts/generate_advanced_golden.py`); goldens were
  regenerated (values unchanged at 1e-12 aside from the corrected Chern
  labels above). Stale `HT.plot*` entry points were removed from the wheel.
- The deliberate Wannier IDOS convention (`r/M` per gap `r`, Diophantine-
  consistent) is now documented in `NOTICE` as a departure from the upstream
  CLI's `(r-1)/M`.

### Development workflow

- Split validation into a seconds-scale `check:fast`, a small Chromium
  `check:smoke`, and the comprehensive `check:release` matrix so ordinary edit
  loops do not repeatedly pay for every native, Pyodide, desktop, and mobile
  test.
- Retry a failed Playwright case up to twice in CI, preserving fail-fast local
  runs, recording passed-after-retry audit evidence, and emitting native
  GitHub annotations for any final browser failure.
- Move checkout, runtime setup, artifact upload, and Pages deployment to
  immutable Node 24 action releases so publishing no longer depends on
  GitHub's deprecated Node 20 compatibility path.

### Interface guidance

- Add keyboard-, pointer-, and touch-accessible explanations to every parameter
  family and primary result panel, including the Wilson loop, 3D surface,
  upstream property table, and linked state inspector.
- Base the help copy on HofstadterTools' Hamiltonian, CLI, butterfly,
  Berry-curvature, Wilson-loop, and quantum-geometry conventions rather than
  introducing frontend-specific physics definitions.

### Phase 2 · Stage 0 — correctness and control hardening

- Enforce canonical lattice angles for every named lattice during URL hydration
  and parameter writes, while preserving editable angles for general Bravais
  lattices.
- Reduce magnetic flux fractions to coprime form throughout state, controls,
  titles, and shared URLs.
- Treat the p/q number fields as one draft pair so users can enter a new
  numerator and denominator in either order before canonical reduction.
- Align the flux-denominator slider and number input at the documented
  `q ≤ 199` limit, with every integer denominator selectable.
- Keep Wannier gap identity separate from band identity in point picking.
- Remove the manual momentum-grid control and legacy `samp=` URL output.
  Internal q- and lattice-aware sampling now keeps the butterfly on the
  upstream Γ-point convention while choosing an appropriate band preview.
- Remove the parameter-sidebar privacy callout.
- Cover malicious honeycomb URLs and responsive WebGL repaint behavior in
  browser tests.

### Phase 2 · Stage 1 — Avron gap-plane coloring

- Add a third butterfly color mode that draws every resolvable spectral gap as
  a GPU line segment colored by its cumulative Chern label `tᵣ`.
- Reuse the upstream Avron-style ±10 palette, switch the legend and inspector
  to Hall-conductivity semantics, and omit sub-pixel gaps at the current zoom.
- Add a subtle spectral-state overlay toggle and a browser smoke test for the
  q=31 square-lattice gap plane.

### Phase 2 · Stage 2 — Wilson loops

- Compute upstream Wilson-loop phases for every touching-band group directly
  from the eigenvector grid already used for Berry flux, and transfer the
  group-filled `bands × samples` array to the browser.
- Add a branch-cut-safe SVG Wilson panel with winding/Chern annotation and
  linked k₂-row selection for the 3D momentum marker.
- Verify square-lattice q=3, 4, and 5 isolated-band windings against the
  Diophantine Chern convention and the vanishing total group winding.
- Cross-check Berry and Wilson integers, band grouping, and the largest
  principal phase step before displaying an invariant; uncertified Chern
  numbers and Wilson traces stay hidden rather than appearing provisional.
- Resolve topology automatically for the active band group on a
  memory-bounded anisotropic grid, streaming only two eigenvector rows at a
  time and increasing resolution until the invariants certify. The q=31
  square case automatically reaches 81×179 topology links and recovers the
  central `C = -30` band without inflating the 3D energy surface.
- Cache topology by physical parameters and active group so selection changes
  request only the invariant that is needed; no convergence button or
  user-facing topology sample count remains.

### Phase 2 · Stage 3 — band property table

- Mirror the upstream CLI definitions for band grouping, isolation, bandwidth,
  upper gap, gap/width, normalized Berry-flux variation, and Chern number.
- Expose the upstream `bgt = 0.01` grouping threshold through parameters and
  shareable URLs, and return both exact CLI band rows and compact group rows.
- Add a linked HTML table whose hover previews a group in the cut/surface and
  whose click synchronizes the selected-band control; include its group rows in
  CSV exports.
- Use HofstadterTools' zero-based band and group indices consistently in the
  selector, state inspector, symmetry-cut accessibility text, surface titles,
  property table, CSV, and NPZ output.

### Phase 2 · Stage 4 — reciprocal-space scene linkage

- Return labeled fractional symmetry points plus Wigner–Seitz magnetic and
  ordinary Brillouin-zone outlines from the band adapter.
- Center the periodic surface parameterization on Γ, draw both BZ outlines,
  place camera-facing symmetry labels, and add the symmetry path on the base
  plane and on the selected energy sheet.
- Reuse the same symmetry-point contract in the lattice reciprocal panel and
  fade labels for extremely folded magnetic zones.
- Give symmetry-cut bands a forgiving nearest-curve hit radius and add
  pointer-captured, real-time momentum scrubbing along the selected band.
- Add cursor-centered zoom, Shift/middle-drag panning, adaptive energy tick
  precision, and accessible zoom/reset controls to the linked symmetry cut so
  fine dispersion features remain legible at large magnetic denominators.
- Add automatic, energy-only dispersion refinement with q-aware,
  eigensolve-budgeted surface grids and zoom-aware symmetry-path detail. At
  square q=31 it replaces the lightweight preview with a 125×125 surface and
  124 samples per path leg without allocating a dense eigenvector grid.
- Reuse cached surface eigensolves when only the linked-cut zoom changes, so
  finer path detail arrives without recomputing the 3D energy sheet.
- Interpolate the lifted high-symmetry path from the energy mesh actually on
  screen, eliminating detached alias spikes, and expose the Γ-path overlay as
  a labeled toggle.

### Phase 2 · Stage 5 — single scientific workspace

- Replace the desktop-only tab exclusivity with a three-column workspace that
  keeps the butterfly, Wannier diagram, lattice/BZ, bands, Wilson loop,
  property table, and state inspector visible together; retain tabs below
  1100 px and as maximized focus modes.
- Make the flux cursor draggable on both spectral panels, snap it to the
  nearest coprime numerator, link state clicks to flux and band selection, and
  share horizontal pan/zoom while preserving independent vertical transforms.
- Key lattice, band, and sweep results by their exact parameter dependencies,
  prioritize lattice and bands on the single worker, and prove with request
  counters that moving the flux cursor causes zero new sweeps.
- Keep previous results visible and dimmed during replacement or failure, swap
  streamed sweeps on their first new chunk, and restore recently cached
  parameter states without recomputation.
- Replace `view=` with `focus=` in new URLs while continuing to hydrate legacy
  links, add per-panel maximize/export controls, and support whole-workspace
  PNG capture.

### Phase 2 · Stage 6 — lazy quantum geometry

- Add a separate `compute_geometry` adapter that follows the upstream
  projector finite differences, group filling, `gxx`/`gxy` surfaces, and
  `std_g`, component-statistic, trace-inequality, and determinant-inequality
  table definitions.
- Run the two offset eigendiagonalization grids only after a geometry surface
  or table expansion is requested, with explicit cost signaling and stale
  geometry retention.
- Transfer metric arrays as typed-array buffers, export them with band data,
  and verify q=4 square-lattice statistics natively and through Pyodide at
  `rtol=1e-6`.

### Phase 2 · Stage 7 — art-mode PNG export

- Add butterfly and Wannier `Art PNG` exports at 3× output scale with all
  axes, labels, legends, hints, and the flux cursor omitted.
- Support a true transparent-alpha background and use upstream-inspired names
  such as `butterfly_honeycomb_q_199_plane_art.png`.

### Phase 2 · Stretch goals

- Add an opt-in, animated BZ-torus morph for the selected energy sheet,
  including energy and Berry-flux coloring, exaggerated radial dispersion
  relief, a faint undeformed reference torus, an always-visible selected-k
  halo/reticle, and metric-aware iso-contours that use high-contrast ribbons
  over a projected scalar field beneath rectangular sheets and adaptive
  strokes around the torus, while leaving the rectangular surface as the
  default render path.
- Add local drag-and-drop and file-picker loading for application-exported NPZ
  butterfly/Wannier archives. Exports now include portable parameter metadata
  and complete state/gap arrays, and imports seed the keyed result cache
  without launching a replacement sweep.
- Add the upstream `avron`, `jet`, and `red-blue` topology palettes to Chern
  points, gap-plane segments, Wannier points, and their legends.
- Add a shareable `custom` lattice with a small fractional-basis and
  neighbor-shell hopping editor. Custom unit cells use an adapter-only
  `unit_cell` override and the unchanged upstream generic Hamiltonian
  constructor; unsupported fast Diophantine coloring remains explicitly
  unavailable.

## v1.0.0

- Submission to the Journal of Open Source Software (JOSS).

## v1.0.1

- Corrections from first JOSS reviewer. See the [review thread](https://github.com/openjournals/joss-reviews/issues/6356) for further details.

## v1.0.2

- Corrections from second JOSS reviewer. See the [review thread](https://github.com/openjournals/joss-reviews/issues/6356) for further details.

## v1.0.3

- Accepted version in JOSS. See the [review thread](https://github.com/openjournals/joss-reviews/issues/6356) for further details.

## v1.0.4

- Post publication in JOSS. See the [review thread](https://github.com/openjournals/joss-reviews/issues/6356) for further details.

## v1.0.5

- Minor corrections and updates. See the commit history for further details.

## v1.0.6

- Minor corrections and updates. See the commit history for further details.

## v1.0.7

- Fix inconsistent version numbers in v1.0.6.
