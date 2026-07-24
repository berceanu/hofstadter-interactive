import { create } from "zustand";
import type {
  ButterflyColorMode,
  LatticeKind,
  RuntimeProgress,
  ScientificParameters,
  SurfaceMetric,
  ViewKind,
} from "../compute/contracts";

export interface SelectedPoint {
  flux: number;
  energy: number;
  band: number;
  chern?: number;
  topologyAvailable?: boolean;
  dos?: number;
  gap?: number;
}

interface AppState {
  parameters: ScientificParameters;
  view: ViewKind;
  colorMode: ButterflyColorMode;
  surfaceMetric: SurfaceMetric;
  selectedBand: number;
  selectedPoint?: SelectedPoint;
  progress: RuntimeProgress;
  activeRequestId?: string;
  runtimeReady: boolean;
  setParameter: <K extends keyof ScientificParameters>(
    key: K,
    value: ScientificParameters[K],
  ) => void;
  setLattice: (lattice: LatticeKind) => void;
  setView: (view: ViewKind) => void;
  setColorMode: (mode: ButterflyColorMode) => void;
  setSurfaceMetric: (metric: SurfaceMetric) => void;
  setSelectedBand: (band: number) => void;
  setSelectedPoint: (point?: SelectedPoint) => void;
  setProgress: (progress: RuntimeProgress) => void;
  setActiveRequest: (requestId?: string) => void;
  setRuntimeReady: (ready: boolean) => void;
  hydrate: (parameters: Partial<ScientificParameters> & { view?: ViewKind }) => void;
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
};

function boundedInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function boundedNumber(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizeParameters(
  candidate: ScientificParameters,
): ScientificParameters {
  const q = boundedInteger(candidate.q, defaultParameters.q, 3, 199);
  const thetaDenominator = boundedInteger(
    candidate.theta[1],
    defaultParameters.theta[1],
    2,
    360,
  );
  const rawSamples = boundedInteger(
    candidate.samples,
    defaultParameters.samples,
    7,
    31,
  );
  const samples = rawSamples % 2 === 0
    ? Math.min(31, rawSamples + 1)
    : rawSamples;
  const hoppings = candidate.hoppings
    .filter(Number.isFinite)
    .slice(0, 5);

  return {
    lattice: candidate.lattice,
    p: boundedInteger(candidate.p, defaultParameters.p, 1, q - 1),
    q,
    a: 1,
    hoppings: hoppings.length ? hoppings : [...defaultParameters.hoppings],
    alpha: boundedNumber(
      candidate.alpha,
      defaultParameters.alpha,
      0.1,
      4,
    ),
    theta: [
      boundedInteger(
        candidate.theta[0],
        defaultParameters.theta[0],
        1,
        Math.min(180, thetaDenominator - 1),
      ),
      thetaDenominator,
    ],
    period: boundedInteger(
      candidate.period,
      defaultParameters.period,
      1,
      16,
    ),
    samples,
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
};

export const useAppStore = create<AppState>((set) => ({
  parameters: normalizeParameters(defaultParameters),
  view: "butterfly",
  colorMode: "spectral",
  surfaceMetric: "energy",
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
  setLattice: (lattice) =>
    set((state) => ({
      parameters: normalizeParameters({
        ...state.parameters,
        lattice,
        ...latticeDefaults[lattice],
      }),
      selectedPoint: undefined,
    })),
  setView: (view) => set({ view, selectedPoint: undefined }),
  setColorMode: (colorMode) => set({ colorMode }),
  setSurfaceMetric: (surfaceMetric) => set({ surfaceMetric }),
  setSelectedBand: (selectedBand) => set({ selectedBand }),
  setSelectedPoint: (selectedPoint) => set({ selectedPoint }),
  setProgress: (progress) => set({ progress }),
  setActiveRequest: (activeRequestId) => set({ activeRequestId }),
  setRuntimeReady: (runtimeReady) => set({ runtimeReady }),
  hydrate: ({ view, ...parameters }) =>
    set((state) => ({
      view: view ?? state.view,
      parameters: normalizeParameters({ ...state.parameters, ...parameters }),
    })),
}));
