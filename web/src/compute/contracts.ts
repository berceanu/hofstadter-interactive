export type LatticeKind =
  | "square"
  | "triangular"
  | "honeycomb"
  | "kagome"
  | "bravais";

export type ViewKind = "butterfly" | "wannier" | "lattice" | "bands";
export type ButterflyColorMode = "spectral" | "chern";
export type SurfaceMetric = "energy" | "berry";

export interface ScientificParameters {
  lattice: LatticeKind;
  p: number;
  q: number;
  a: number;
  hoppings: number[];
  alpha: number;
  theta: [number, number];
  period: number;
  samples: number;
}

export interface ButterflyChunk {
  requestId: string;
  flux: Float64Array;
  energy: Float64Array;
  band: Int32Array;
  chern: Int32Array;
  dos: Float64Array;
  gap: Float64Array;
  gapChern: Int32Array;
  gapFlux: Float64Array;
  gapEnergy: Float64Array;
  progress: number;
}

export interface ButterflyResult {
  requestId: string;
  chunks: ButterflyChunk[];
  complete: boolean;
  elapsedMs: number;
}

export interface BandResult {
  requestId: string;
  samples: number;
  bands: number;
  energy: Float64Array;
  berry: Float64Array;
  chern: Int32Array;
  pathX: Float64Array;
  pathEnergy: Float64Array;
  pathTicks: Float64Array;
  pathLabels: string[];
  reciprocal: Float64Array;
  elapsedMs: number;
}

export interface LatticeResult {
  requestId: string;
  sites: Float64Array;
  siteBasis: Int32Array;
  links: Float64Array;
  unitCell: Float64Array;
  magneticCell: Float64Array;
  latticeVectors: Float64Array;
  reciprocalVectors: Float64Array;
  bz: Float64Array;
  basisCount: number;
}

export type RuntimePhase =
  | "idle"
  | "downloading"
  | "initializing"
  | "loading-package"
  | "ready"
  | "computing"
  | "rendering"
  | "complete"
  | "error";

export interface RuntimeProgress {
  phase: RuntimePhase;
  fraction: number;
  message: string;
}

export interface ComputeEngine {
  initialize(onProgress: (progress: RuntimeProgress) => void): Promise<void>;
  computeButterfly(
    requestId: string,
    parameters: ScientificParameters,
    onChunk: (chunk: ButterflyChunk) => void,
  ): Promise<number>;
  computeBands(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<BandResult>;
  computeLattice(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<LatticeResult>;
  cancel(requestId: string): Promise<void>;
  dispose(): void;
}
