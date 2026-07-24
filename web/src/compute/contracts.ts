export type LatticeKind =
  | "square"
  | "triangular"
  | "honeycomb"
  | "kagome"
  | "bravais"
  | "custom";

export type ViewKind = "butterfly" | "wannier" | "lattice" | "bands";
export type FocusKind = "workspace" | ViewKind;
export type ButterflyColorMode = "spectral" | "chern" | "gaps";
export type TopologicalPalette = "avron" | "jet" | "red-blue";
export type SurfaceMetric = "energy" | "berry" | "gxx" | "gxy";

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
  bgt: number;
  customBasis: [number, number][];
}

export interface ButterflyChunk {
  requestId: string;
  topologyAvailable: boolean;
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
  wilson: Float64Array;
  chern: Int32Array;
  groupStart: Int32Array;
  groupSize: Int32Array;
  propertyRows: BandPropertyRow[];
  groupRows: BandGroupRow[];
  bgt: number;
  pathX: Float64Array;
  pathK1: Float64Array;
  pathK2: Float64Array;
  pathEnergy: Float64Array;
  pathTicks: Float64Array;
  pathLabels: string[];
  reciprocal: Float64Array;
  symPoints: SymmetryPoint[];
  bz: Float64Array;
  ordinaryBz: Float64Array;
  elapsedMs: number;
}

export interface SymmetryPoint {
  label: string;
  k1: number;
  k2: number;
}

export interface BandPropertyRow {
  band: number;
  group: number;
  isolated: boolean;
  width: number;
  gap: number | null;
  gapWidth: number | null;
  stdB: number;
  chern: number;
}

export interface BandGroupRow extends BandPropertyRow {
  bandEnd: number;
}

export interface GeometryRow {
  band: number;
  bandEnd: number;
  group: number;
  stdG: number;
  averageGxx: number;
  stdGxx: number;
  averageGxy: number;
  stdGxy: number;
  averageT: number;
  averageD: number;
}

export interface GeometryResult {
  requestId: string;
  samples: number;
  bands: number;
  gxx: Float64Array;
  gxy: Float64Array;
  groupStart: Int32Array;
  groupSize: Int32Array;
  rows: GeometryRow[];
  bgt: number;
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
  ordinaryReciprocalVectors: Float64Array;
  bz: Float64Array;
  ordinaryBz: Float64Array;
  symPoints: SymmetryPoint[];
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
  computeGeometry(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<GeometryResult>;
  computeLattice(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<LatticeResult>;
  cancel(requestId: string): Promise<void>;
  dispose(): void;
}
