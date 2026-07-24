# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
- Document that momentum sampling applies to band grids while butterfly
  spectra follow the upstream Γ-point convention.
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
- Cross-check Berry and Wilson integers, complete-bundle sums, band grouping,
  and the largest principal phase step before presenting topology as
  converged. Under-resolved grids now show the two provisional invariants
  separately instead of claiming `winding = C`.
- Add an opt-in, memory-bounded topology refinement that streams two
  eigenvector rows at a time on an anisotropic grid. The q=31 square case
  refines from the render grid at 31×31 to 81×121 topology links, recovering
  the central `C = -30` band without inflating the 3D energy surface.

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
