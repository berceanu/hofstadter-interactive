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
  chern: number;
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
  parameters: defaultParameters,
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
      parameters: { ...state.parameters, [key]: value },
      selectedPoint: undefined,
    })),
  setLattice: (lattice) =>
    set((state) => ({
      parameters: {
        ...state.parameters,
        lattice,
        ...latticeDefaults[lattice],
      },
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
      parameters: { ...state.parameters, ...parameters },
    })),
}));
