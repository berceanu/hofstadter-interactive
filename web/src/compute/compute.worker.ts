/// <reference lib="webworker" />

import { expose, proxy, transfer, type ProxyMarked } from "comlink";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { estimatedBandCount } from "./computeKeys";
import type {
  BandResult,
  ButterflyChunk,
  DispersionResult,
  GeometryResult,
  LatticeResult,
  RuntimeProgress,
  ScientificParameters,
  TopologyResult,
} from "./contracts";

type ProgressCallback = ((progress: RuntimeProgress) => void) & ProxyMarked;

interface PythonButterfly {
  topology_available: boolean;
  flux: Float64Array;
  energy: Float64Array;
  band: Int32Array;
  chern: Int32Array;
  dos: Float64Array;
  gap: Float64Array;
  gap_chern: Int32Array;
  gap_flux: Float64Array;
  gap_energy: Float64Array;
}

interface PythonBands {
  samples: number;
  bands: number;
  energy: Float64Array;
  berry: Float64Array;
  wilson: Float64Array;
  chern: Int32Array;
  topology_resolved: boolean;
  topology_group_resolved: Uint8Array;
  wilson_winding: Int32Array;
  wilson_max_step: Float64Array;
  topology_total_chern: number;
  topology_total_winding: number;
  topology_grouping_consistent: boolean;
  wilson_phase_step_limit: number;
  group_start: Int32Array;
  group_size: Int32Array;
  property_rows: PythonPropertyRow[];
  group_rows: PythonGroupRow[];
  bgt: number;
  path_x: Float64Array;
  path_k1: Float64Array;
  path_k2: Float64Array;
  path_energy: Float64Array;
  path_ticks: Float64Array;
  path_labels: string[];
  reciprocal: Float64Array;
  sym_points: PythonSymmetryPoint[];
  bz: Float64Array;
  ordinary_bz: Float64Array;
}

interface PythonTopology {
  base_samples: number;
  samples_x: number;
  samples_y: number;
  bands: number;
  wilson: Float64Array;
  chern: Int32Array;
  group_start: Int32Array;
  group_size: Int32Array;
  topology_resolved: boolean;
  topology_group_resolved: Uint8Array;
  wilson_winding: Int32Array;
  wilson_max_step: Float64Array;
  topology_total_chern: number;
  topology_total_winding: number;
  topology_grouping_consistent: boolean;
  wilson_phase_step_limit: number;
}

interface PythonDispersion {
  base_samples: number;
  surface_samples: number;
  path_samples_per_segment: number;
  bands: number;
  energy: Float64Array;
  path_x: Float64Array;
  path_k1: Float64Array;
  path_k2: Float64Array;
  path_energy: Float64Array;
  path_ticks: Float64Array;
  path_labels: string[];
}

interface PythonGeometryRow {
  band: number;
  band_end: number;
  group: number;
  std_g: number;
  av_gxx: number;
  std_gxx: number;
  av_gxy: number;
  std_gxy: number;
  T: number;
  D: number;
}

interface PythonGeometry {
  samples: number;
  bands: number;
  gxx: Float64Array;
  gxy: Float64Array;
  group_start: Int32Array;
  group_size: Int32Array;
  rows: PythonGeometryRow[];
  bgt: number;
}

interface PythonSymmetryPoint {
  label: string;
  k1: number;
  k2: number;
}

interface PythonPropertyRow {
  band: number;
  group: number;
  isolated: boolean;
  width: number;
  gap: number | null;
  gap_width: number | null;
  std_B: number;
  C: number;
}

interface PythonGroupRow extends PythonPropertyRow {
  band_end: number;
}

interface PythonLattice {
  sites: Float64Array;
  site_basis: Int32Array;
  links: Float64Array;
  unit_cell: Float64Array;
  magnetic_cell: Float64Array;
  lattice_vectors: Float64Array;
  reciprocal_vectors: Float64Array;
  ordinary_reciprocal_vectors: Float64Array;
  bz: Float64Array;
  ordinary_bz: Float64Array;
  sym_points: PythonSymmetryPoint[];
  basis_count: number;
}

let runtime: PyodideInterface | undefined;
let initialization: Promise<void> | undefined;
const cancelled = new Set<string>();

function toPlain<T>(value: unknown): T {
  const pyProxy = value as {
    toJs: (options: {
      dict_converter: (entries: Iterable<[string, unknown]>) => object;
      create_pyproxies: boolean;
    }) => T;
    destroy: () => void;
  };
  try {
    return pyProxy.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    });
  } finally {
    pyProxy.destroy();
  }
}

function runAdapter<T>(
  functionName: string,
  parameters: object,
  extraArguments = "",
): T {
  if (!runtime) {
    throw new Error("The Python runtime is not initialized.");
  }
  runtime.globals.set("_hh_parameters_json", JSON.stringify(parameters));
  try {
    return toPlain<T>(
      runtime.runPython(
        `${functionName}(json.loads(_hh_parameters_json)${extraArguments})`,
      ),
    );
  } finally {
    runtime.globals.delete("_hh_parameters_json");
  }
}

const api = {
  async initialize(
    assetBase: string,
    onProgress: ProgressCallback,
  ): Promise<void> {
    if (initialization) {
      return initialization;
    }
    initialization = (async () => {
      const base = new URL(assetBase, self.location.origin);
      const pyodideBase = new URL("pyodide/", base).href;
      onProgress({
        phase: "downloading",
        fraction: 0.08,
        message: "Downloading the local Python runtime",
      });
      runtime = await loadPyodide({ indexURL: pyodideBase });
      onProgress({
        phase: "initializing",
        fraction: 0.42,
        message: "Initializing Python and NumPy",
      });
      await runtime.loadPackage(["numpy", "micropip"]);
      onProgress({
        phase: "loading-package",
        fraction: 0.76,
        message: "Loading HofstadterTools",
      });
      const wheel = new URL(
        "python/hofstadtertools-1.0.7-py3-none-any.whl",
        base,
      ).href;
      runtime.globals.set("_hh_wheel_url", wheel);
      try {
        await runtime.runPythonAsync(`
import micropip
await micropip.install(_hh_wheel_url, deps=False)
`);
      } finally {
        runtime.globals.delete("_hh_wheel_url");
      }
      await runtime.runPythonAsync(`
import json
from HT.web import compute_bands, compute_butterfly_batch, compute_dispersion, compute_geometry, compute_lattice, compute_topology
`);
      onProgress({
        phase: "ready",
        fraction: 1,
        message: "Local compute engine ready",
      });
    })();
    return initialization;
  },

  async computeButterflyBatch(
    requestId: string,
    parameters: ScientificParameters,
    pStart: number,
    pEnd: number,
    progress: number,
  ): Promise<ButterflyChunk> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const result = runAdapter<PythonButterfly>(
      "compute_butterfly_batch",
      parameters,
      `, ${Math.trunc(pStart)}, ${Math.trunc(pEnd)}`,
    );
    const chunk: ButterflyChunk = {
      requestId,
      topologyAvailable: Boolean(result.topology_available),
      flux: new Float64Array(result.flux),
      energy: new Float64Array(result.energy),
      band: new Int32Array(result.band),
      chern: new Int32Array(result.chern),
      dos: new Float64Array(result.dos),
      gap: new Float64Array(result.gap),
      gapChern: new Int32Array(result.gap_chern),
      gapFlux: new Float64Array(result.gap_flux),
      gapEnergy: new Float64Array(result.gap_energy),
      progress,
    };
    const buffers = [
      chunk.flux.buffer,
      chunk.energy.buffer,
      chunk.band.buffer,
      chunk.chern.buffer,
      chunk.dos.buffer,
      chunk.gap.buffer,
      chunk.gapChern.buffer,
      chunk.gapFlux.buffer,
      chunk.gapEnergy.buffer,
    ];
    return transfer(chunk, buffers);
  },

  async computeBands(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<BandResult> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const started = performance.now();
    const result = runAdapter<PythonBands>("compute_bands", parameters);
    const bands: BandResult = {
      requestId,
      samples: Number(result.samples),
      bands: Number(result.bands),
      energy: new Float64Array(result.energy),
      berry: new Float64Array(result.berry),
      wilson: new Float64Array(result.wilson),
      chern: new Int32Array(result.chern),
      topologyResolved: Boolean(result.topology_resolved),
      topologyGroupResolved: new Uint8Array(
        result.topology_group_resolved,
      ),
      wilsonWinding: new Int32Array(result.wilson_winding),
      wilsonMaxStep: new Float64Array(result.wilson_max_step),
      topologyTotalChern: Number(result.topology_total_chern),
      topologyTotalWinding: Number(result.topology_total_winding),
      topologyGroupingConsistent: Boolean(
        result.topology_grouping_consistent,
      ),
      wilsonPhaseStepLimit: Number(result.wilson_phase_step_limit),
      groupStart: new Int32Array(result.group_start),
      groupSize: new Int32Array(result.group_size),
      propertyRows: Array.from(result.property_rows, (row) => ({
        band: Number(row.band),
        group: Number(row.group),
        isolated: Boolean(row.isolated),
        width: Number(row.width),
        gap: row.gap === null ? null : Number(row.gap),
        gapWidth: row.gap_width === null ? null : Number(row.gap_width),
        stdB: Number(row.std_B),
        chern: Number(row.C),
      })),
      groupRows: Array.from(result.group_rows, (row) => ({
        band: Number(row.band),
        bandEnd: Number(row.band_end),
        group: Number(row.group),
        isolated: Boolean(row.isolated),
        width: Number(row.width),
        gap: row.gap === null ? null : Number(row.gap),
        gapWidth: row.gap_width === null ? null : Number(row.gap_width),
        stdB: Number(row.std_B),
        chern: Number(row.C),
      })),
      bgt: Number(result.bgt),
      pathX: new Float64Array(result.path_x),
      pathK1: new Float64Array(result.path_k1),
      pathK2: new Float64Array(result.path_k2),
      pathEnergy: new Float64Array(result.path_energy),
      pathTicks: new Float64Array(result.path_ticks),
      pathLabels: Array.from(result.path_labels),
      reciprocal: new Float64Array(result.reciprocal),
      symPoints: Array.from(result.sym_points, (point) => ({
        label: String(point.label),
        k1: Number(point.k1),
        k2: Number(point.k2),
      })),
      bz: new Float64Array(result.bz),
      ordinaryBz: new Float64Array(result.ordinary_bz),
      elapsedMs: performance.now() - started,
    };
    return transfer(bands, [
      bands.energy.buffer,
      bands.berry.buffer,
      bands.wilson.buffer,
      bands.chern.buffer,
      bands.topologyGroupResolved.buffer,
      bands.wilsonWinding.buffer,
      bands.wilsonMaxStep.buffer,
      bands.groupStart.buffer,
      bands.groupSize.buffer,
      bands.pathX.buffer,
      bands.pathK1.buffer,
      bands.pathK2.buffer,
      bands.pathEnergy.buffer,
      bands.pathTicks.buffer,
      bands.reciprocal.buffer,
      bands.bz.buffer,
      bands.ordinaryBz.buffer,
    ]);
  },

  async computeTopology(
    requestId: string,
    parameters: ScientificParameters,
    groups: [number, number][],
    samplesX: number,
    samplesY: number,
  ): Promise<TopologyResult> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const started = performance.now();
    const result = runAdapter<PythonTopology>("compute_topology", {
      ...parameters,
      topology_groups: groups,
      topology_partial:
        groups.reduce((total, [, size]) => total + size, 0)
        < estimatedBandCount(parameters),
      topology_samples_x: samplesX,
      topology_samples_y: samplesY,
    });
    const computedBandCount = groups.reduce(
      (total, [, size]) => total + size,
      0,
    );
    const topology: TopologyResult = {
      requestId,
      baseSamples: Number(result.base_samples),
      samplesX: Number(result.samples_x),
      samplesY: Number(result.samples_y),
      bands: Number(result.bands),
      computedGroupStart: groups.length === 1 ? groups[0][0] : -1,
      computedGroupSize: groups.length === 1 ? groups[0][1] : computedBandCount,
      completeBundle: computedBandCount === Number(result.bands),
      wilson: new Float64Array(result.wilson),
      chern: new Int32Array(result.chern),
      groupStart: new Int32Array(result.group_start),
      groupSize: new Int32Array(result.group_size),
      topologyResolved: Boolean(result.topology_resolved),
      topologyGroupResolved: new Uint8Array(
        result.topology_group_resolved,
      ),
      wilsonWinding: new Int32Array(result.wilson_winding),
      wilsonMaxStep: new Float64Array(result.wilson_max_step),
      topologyTotalChern: Number(result.topology_total_chern),
      topologyTotalWinding: Number(result.topology_total_winding),
      topologyGroupingConsistent: Boolean(
        result.topology_grouping_consistent,
      ),
      wilsonPhaseStepLimit: Number(result.wilson_phase_step_limit),
      elapsedMs: performance.now() - started,
    };
    return transfer(topology, [
      topology.wilson.buffer,
      topology.chern.buffer,
      topology.groupStart.buffer,
      topology.groupSize.buffer,
      topology.topologyGroupResolved.buffer,
      topology.wilsonWinding.buffer,
      topology.wilsonMaxStep.buffer,
    ]);
  },

  async computeDispersion(
    requestId: string,
    parameters: ScientificParameters,
    surfaceSamples: number,
    pathSamplesPerSegment: number,
  ): Promise<DispersionResult> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const started = performance.now();
    const result = runAdapter<PythonDispersion>("compute_dispersion", {
      ...parameters,
      dispersion_surface_samples: surfaceSamples,
      dispersion_path_samples: pathSamplesPerSegment,
    });
    const dispersion: DispersionResult = {
      requestId,
      baseSamples: Number(result.base_samples),
      surfaceSamples: Number(result.surface_samples),
      pathSamplesPerSegment: Number(result.path_samples_per_segment),
      bands: Number(result.bands),
      energy: new Float64Array(result.energy),
      pathX: new Float64Array(result.path_x),
      pathK1: new Float64Array(result.path_k1),
      pathK2: new Float64Array(result.path_k2),
      pathEnergy: new Float64Array(result.path_energy),
      pathTicks: new Float64Array(result.path_ticks),
      pathLabels: Array.from(result.path_labels),
      elapsedMs: performance.now() - started,
    };
    return transfer(dispersion, [
      dispersion.energy.buffer,
      dispersion.pathX.buffer,
      dispersion.pathK1.buffer,
      dispersion.pathK2.buffer,
      dispersion.pathEnergy.buffer,
      dispersion.pathTicks.buffer,
    ]);
  },

  async computeLattice(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<LatticeResult> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const result = runAdapter<PythonLattice>("compute_lattice", parameters);
    const lattice: LatticeResult = {
      requestId,
      sites: new Float64Array(result.sites),
      siteBasis: new Int32Array(result.site_basis),
      links: new Float64Array(result.links),
      unitCell: new Float64Array(result.unit_cell),
      magneticCell: new Float64Array(result.magnetic_cell),
      latticeVectors: new Float64Array(result.lattice_vectors),
      reciprocalVectors: new Float64Array(result.reciprocal_vectors),
      ordinaryReciprocalVectors: new Float64Array(
        result.ordinary_reciprocal_vectors,
      ),
      bz: new Float64Array(result.bz),
      ordinaryBz: new Float64Array(result.ordinary_bz),
      symPoints: Array.from(result.sym_points, (point) => ({
        label: String(point.label),
        k1: Number(point.k1),
        k2: Number(point.k2),
      })),
      basisCount: Number(result.basis_count),
    };
    return transfer(lattice, [
      lattice.sites.buffer,
      lattice.siteBasis.buffer,
      lattice.links.buffer,
      lattice.unitCell.buffer,
      lattice.magneticCell.buffer,
      lattice.latticeVectors.buffer,
      lattice.reciprocalVectors.buffer,
      lattice.ordinaryReciprocalVectors.buffer,
      lattice.bz.buffer,
      lattice.ordinaryBz.buffer,
    ]);
  },

  async computeGeometry(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<GeometryResult> {
    if (cancelled.has(requestId)) {
      throw new Error("cancelled");
    }
    const started = performance.now();
    const result = runAdapter<PythonGeometry>("compute_geometry", parameters);
    const geometry: GeometryResult = {
      requestId,
      samples: Number(result.samples),
      bands: Number(result.bands),
      gxx: new Float64Array(result.gxx),
      gxy: new Float64Array(result.gxy),
      groupStart: new Int32Array(result.group_start),
      groupSize: new Int32Array(result.group_size),
      rows: Array.from(result.rows, (row) => ({
        band: Number(row.band),
        bandEnd: Number(row.band_end),
        group: Number(row.group),
        stdG: Number(row.std_g),
        averageGxx: Number(row.av_gxx),
        stdGxx: Number(row.std_gxx),
        averageGxy: Number(row.av_gxy),
        stdGxy: Number(row.std_gxy),
        averageT: Number(row.T),
        averageD: Number(row.D),
      })),
      bgt: Number(result.bgt),
      elapsedMs: performance.now() - started,
    };
    return transfer(geometry, [
      geometry.gxx.buffer,
      geometry.gxy.buffer,
      geometry.groupStart.buffer,
      geometry.groupSize.buffer,
    ]);
  },

  async cancel(requestId: string): Promise<void> {
    cancelled.add(requestId);
  },

  async clearCancellation(requestId: string): Promise<void> {
    cancelled.delete(requestId);
  },
};

export type WorkerApi = typeof api;
expose(api);
