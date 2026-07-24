import { create } from "zustand";
import type {
  ButterflyColorMode,
  LatticeKind,
  RuntimeProgress,
  ScientificParameters,
  SurfaceMetric,
  TopologicalPalette,
  FocusKind,
  ViewKind,
} from "../compute/contracts";

export interface SelectedPoint {
  source?: "butterfly" | "wannier" | "gap";
  flux: number;
  energy: number;
  band?: number;
  gapIndex?: number;
  gapEnergyMin?: number;
  gapEnergyMax?: number;
  chern?: number;
  topologyAvailable?: boolean;
  dos?: number;
  gap?: number;
}

interface AppState {
  parameters: ScientificParameters;
  view: ViewKind;
  focus: FocusKind;
  workspaceWide: boolean;
  fluxTransform: { zoom: number; pan: number };
  computeCounters: {
    sweeps: number;
    bands: number;
    lattice: number;
    geometry: number;
    topology: number;
    dispersion: number;
  };
  colorMode: ButterflyColorMode;
  topologicalPalette: TopologicalPalette;
  surfaceMetric: SurfaceMetric;
  geometryColumnsExpanded: boolean;
  bandCutZoom: number;
  selectedBand: number;
  selectedPoint?: SelectedPoint;
  progress: RuntimeProgress;
  activeRequestId?: string;
  runtimeReady: boolean;
  setParameter: <K extends keyof ScientificParameters>(
    key: K,
    value: ScientificParameters[K],
  ) => void;
  setFlux: (p: number, q: number) => void;
  setLattice: (lattice: LatticeKind) => void;
  setView: (view: ViewKind) => void;
  setFocus: (focus: FocusKind) => void;
  setWorkspaceWide: (wide: boolean) => void;
  setFluxTransform: (transform: { zoom: number; pan: number }) => void;
  incrementComputeCounter: (
    kind:
      | "sweeps"
      | "bands"
      | "lattice"
      | "geometry"
      | "topology"
      | "dispersion",
  ) => void;
  setColorMode: (mode: ButterflyColorMode) => void;
  setTopologicalPalette: (palette: TopologicalPalette) => void;
  setSurfaceMetric: (metric: SurfaceMetric) => void;
  setGeometryColumnsExpanded: (expanded: boolean) => void;
  setBandCutZoom: (zoom: number) => void;
  setSelectedBand: (band: number) => void;
  setSelectedPoint: (point?: SelectedPoint) => void;
  setProgress: (progress: RuntimeProgress) => void;
  setActiveRequest: (requestId?: string) => void;
  setRuntimeReady: (ready: boolean) => void;
  hydrate: (
    parameters: Partial<ScientificParameters> & {
      view?: ViewKind;
      focus?: FocusKind;
    },
  ) => void;
}

export const defaultParameters: ScientificParameters = {
  lattice: "square",
  p: 1,
  q: 31,
  a: 1,
  hoppings: [1],
  alpha: 1,
  theta: [1, 2],
  period: 1,
  samples: 17,
  bgt: 0.01,
  customBasis: [
    [0, 0],
    [0.5, 0],
    [0, 0.5],
  ],
};

function boundedInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function boundedNumber(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function greatestCommonDivisor(first: number, second: number) {
  let a = Math.abs(Math.trunc(first));
  let b = Math.abs(Math.trunc(second));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

export function canonicalTheta(
  lattice: LatticeKind,
  theta: [number, number],
): [number, number] {
  if (lattice === "square") return [1, 2];
  if (
    lattice === "triangular"
    || lattice === "honeycomb"
    || lattice === "kagome"
  ) {
    return [1, 3];
  }
  const denominator = boundedInteger(
    theta[1],
    defaultParameters.theta[1],
    2,
    360,
  );
  return [
    boundedInteger(
      theta[0],
      defaultParameters.theta[0],
      1,
      Math.min(180, denominator - 1),
    ),
    denominator,
  ];
}

function normalizeCustomBasis(
  basis: [number, number][],
): [number, number][] {
  const normalized: [number, number][] = [];
  for (const point of basis.slice(0, 4)) {
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const candidate: [number, number] = [
      Math.max(0, Math.min(0.999999, x)),
      Math.max(0, Math.min(0.999999, y)),
    ];
    if (
      !normalized.some(
        ([existingX, existingY]) =>
          Math.abs(existingX - candidate[0]) < 1e-8
          && Math.abs(existingY - candidate[1]) < 1e-8,
      )
    ) {
      normalized.push(candidate);
    }
  }
  return normalized.length
    ? normalized
    : defaultParameters.customBasis.map((point) => [...point]);
}

export function automaticMomentumSamples({
  lattice,
  q,
  customBasis,
}: Pick<ScientificParameters, "lattice" | "q" | "customBasis">) {
  const multiplier =
    lattice === "honeycomb"
      ? 2
      : lattice === "kagome"
        ? 3
        : lattice === "custom"
          ? Math.max(1, customBasis.length)
          : 1;
  const bandCount = Math.max(1, q * multiplier);
  if (bandCount <= 11) return 21;
  if (bandCount <= 31) return 17;
  if (bandCount <= 63) return 13;
  if (bandCount <= 127) return 9;
  return 7;
}

export function normalizeParameters(
  candidate: ScientificParameters,
): ScientificParameters {
  const boundedQ = boundedInteger(candidate.q, defaultParameters.q, 2, 199);
  const boundedP = boundedInteger(candidate.p, defaultParameters.p, 1, boundedQ - 1);
  const divisor = greatestCommonDivisor(boundedP, boundedQ);
  const p = boundedP / divisor;
  const q = boundedQ / divisor;
  const customBasis = normalizeCustomBasis(
    candidate.customBasis ?? defaultParameters.customBasis,
  );
  const samples = automaticMomentumSamples({
    lattice: candidate.lattice,
    q,
    customBasis,
  });
  const hoppings = candidate.hoppings
    .filter(Number.isFinite)
    .slice(0, 5);

  return {
    lattice: candidate.lattice,
    p,
    q,
    a: 1,
    hoppings: hoppings.length ? hoppings : [...defaultParameters.hoppings],
    alpha: boundedNumber(
      candidate.alpha,
      defaultParameters.alpha,
      0.1,
      4,
    ),
    theta: canonicalTheta(candidate.lattice, candidate.theta),
    period: boundedInteger(
      candidate.period,
      defaultParameters.period,
      1,
      16,
    ),
    samples,
    bgt: boundedNumber(candidate.bgt, defaultParameters.bgt, 0, 10),
    customBasis,
  };
}

const latticeDefaults: Record<
  LatticeKind,
  Pick<ScientificParameters, "theta" | "period" | "alpha">
> = {
  square: { theta: [1, 2], period: 1, alpha: 1 },
  triangular: { theta: [1, 3], period: 1, alpha: 1 },
  honeycomb: { theta: [1, 3], period: 1, alpha: 1 },
  kagome: { theta: [1, 3], period: 8, alpha: 1 },
  bravais: { theta: [67, 180], period: 1, alpha: 1 },
  custom: { theta: [1, 3], period: 1, alpha: 1 },
};

export const useAppStore = create<AppState>((set) => ({
  parameters: normalizeParameters(defaultParameters),
  view: "butterfly",
  focus: "workspace",
  workspaceWide: false,
  fluxTransform: { zoom: 1, pan: 0 },
  computeCounters: {
    sweeps: 0,
    bands: 0,
    lattice: 0,
    geometry: 0,
    topology: 0,
    dispersion: 0,
  },
  colorMode: "spectral",
  topologicalPalette: "avron",
  surfaceMetric: "energy",
  geometryColumnsExpanded: false,
  bandCutZoom: 1,
  selectedBand: 0,
  progress: {
    phase: "idle",
    fraction: 0,
    message: "Preparing local compute engine",
  },
  runtimeReady: false,
  setParameter: (key, value) =>
    set((state) => ({
      parameters: normalizeParameters({
        ...state.parameters,
        [key]: value,
      }),
      selectedPoint: undefined,
    })),
  setFlux: (p, q) =>
    set((state) => ({
      parameters: normalizeParameters({
        ...state.parameters,
        p,
        q,
      }),
      selectedPoint: undefined,
    })),
  setLattice: (lattice) =>
    set((state) => ({
      parameters: normalizeParameters({
        ...state.parameters,
        lattice,
        ...latticeDefaults[lattice],
      }),
      selectedPoint: undefined,
    })),
  setView: (view) =>
    set({ view, focus: view, selectedPoint: undefined }),
  setFocus: (focus) =>
    set((state) => ({
      focus,
      view: focus === "workspace" ? state.view : focus,
      selectedPoint: undefined,
    })),
  setWorkspaceWide: (workspaceWide) => set({ workspaceWide }),
  setFluxTransform: (fluxTransform) => set({ fluxTransform }),
  incrementComputeCounter: (kind) =>
    set((state) => ({
      computeCounters: {
        ...state.computeCounters,
        [kind]: state.computeCounters[kind] + 1,
      },
    })),
  setColorMode: (colorMode) => set({ colorMode }),
  setTopologicalPalette: (topologicalPalette) => set({ topologicalPalette }),
  setSurfaceMetric: (surfaceMetric) => set({ surfaceMetric }),
  setGeometryColumnsExpanded: (geometryColumnsExpanded) =>
    set({ geometryColumnsExpanded }),
  setBandCutZoom: (bandCutZoom) =>
    set({
      bandCutZoom: boundedNumber(bandCutZoom, 1, 1, 64),
    }),
  setSelectedBand: (selectedBand) => set({ selectedBand }),
  setSelectedPoint: (selectedPoint) => set({ selectedPoint }),
  setProgress: (progress) => set({ progress }),
  setActiveRequest: (activeRequestId) => set({ activeRequestId }),
  setRuntimeReady: (runtimeReady) => set({ runtimeReady }),
  hydrate: ({ view, focus, ...parameters }) =>
    set((state) => ({
      view:
        focus && focus !== "workspace"
          ? focus
          : view ?? state.view,
      focus: focus ?? view ?? state.focus,
      parameters: normalizeParameters({ ...state.parameters, ...parameters }),
    })),
}));
