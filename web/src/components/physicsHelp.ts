import type { ViewKind } from "../compute/contracts";

export interface HelpCopy {
  label: string;
  body: string;
}

// Wording follows src/HT/models/hofstadter.py, src/HT/butterfly.py,
// src/HT/band_structure.py, and src/HT/functions/band_structure.py.
export const parameterHelp = {
  model: {
    label: "Model parameters",
    body:
      "These controls define the Hofstadter tight-binding Hamiltonian. Changes are evaluated locally and automatically update only the results that depend on them.",
  },
  lattice: {
    label: "Lattice geometry",
    body:
      "Chooses the Bravais vectors and basis used by HofstadterTools. Named lattices keep their canonical angle; General Bravais and Custom basis expose the cell shape.",
  },
  flux: {
    label: "Magnetic flux φ = p/q",
    body:
      "p/q is the number of flux quanta per unit cell and is always reduced to coprime form. q enlarges the magnetic cell along a₂ and usually creates q magnetic subbands per basis site.",
  },
  hoppings: {
    label: "Hopping amplitudes",
    body:
      "t₁, t₂, … are the tight-binding amplitudes for first-, second-, and higher-neighbor shells. They multiply the Peierls-phased hopping terms in ascending neighbor order.",
  },
  anisotropy: {
    label: "Bravais anisotropy α",
    body:
      "α sets the length of a₂ relative to a₁: α = |a₂|/|a₁|. Named square and triangular lattices fix this ratio; Bravais and multi-site geometries may expose it.",
  },
  theta: {
    label: "Bravais angle θ",
    body:
      "The angle between a₁ and a₂ is θ = (numerator/denominator)·π. Named lattices enforce their canonical value; only General Bravais and Custom basis allow edits.",
  },
  bandGapThreshold: {
    label: "Band-gap threshold bgt",
    body:
      "For adjacent bands, HofstadterTools uses min(Eₙ₊₁) − max(Eₙ). A gap below bgt is treated as touching, so those bands share one group and one non-Abelian topology calculation.",
  },
} satisfies Record<string, HelpCopy>;

export const resultHelp = {
  butterfly: {
    label: "Hofstadter butterfly",
    body:
      "For every coprime p/q in the sweep, HofstadterTools diagonalizes H(k = 0), so these are Γ-point energies. Energy shows states, Chern colors bands, and Gaps colors open intervals by cumulative Hall label tᵣ.",
  },
  wannier: {
    label: "Wannier diagram",
    body:
      "Each point places an open spectral gap at its integrated density of states r/M. Point size encodes the gap width Δ, while color gives the cumulative Chern number tᵣ, the quantized Hall label.",
  },
  lattice: {
    label: "Lattice and Brillouin zones",
    body:
      "Real space shows primitive vectors, basis sites, hopping links, and the magnetic unit cell. Reciprocal space compares the ordinary Brillouin zone with the q-fold magnetic-zone folding.",
  },
  bands: {
    label: "Momentum-space results",
    body:
      "At the selected p/q, this combines Eₙ(k), the high-symmetry cut and density of states, Wilson-loop topology, Berry or quantum-metric fields, and the upstream band-property table.",
  },
} satisfies Record<ViewKind, HelpCopy>;

export const bandResultHelp = {
  cut: {
    label: "Linked band structure",
    body:
      "The upper plot follows the lattice’s Γ–X/K–M–Y/K′–Γ path; the side curve is the density of states. The lower Wilson phase is a Berry-phase cycle whose winding equals the certified group Chern number.",
  },
  wilson: {
    label: "Wilson loop",
    body:
      "W(k₂) is the principal phase of the product of normalized eigenvector overlaps around a full k₁ cycle. Branch-cut jumps at ±π are not connected, and the trace appears only after automatic certification.",
  },
  surface: {
    label: "Rotatable band surface",
    body:
      "The sheet is the selected Eₙ(k) over the magnetic Brillouin zone. Color can instead show group-resolved Berry flux or quantum-metric components; contours are iso-values and the torus exposes momentum periodicity.",
  },
  properties: {
    label: "Band-property table",
    body:
      "Rows use the upstream CLI definitions for touching groups, isolation, bandwidth, upper gap, gap/width, Berry-flux variation, and Chern number. Quantum-geometry columns are computed lazily from projector derivatives.",
  },
  inspector: {
    label: "State inspector",
    body:
      "Hovering previews a state; clicking links its flux and selection across panels. Spectral picks report energy and band, while gap/Wannier picks report IDOS, width Δ, and cumulative Hall label tᵣ.",
  },
} satisfies Record<string, HelpCopy>;
