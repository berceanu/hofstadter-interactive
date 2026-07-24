/// <reference lib="webworker" />

import { expose, proxy, transfer, type ProxyMarked } from "comlink";
import { loadPyodide, type PyodideInterface } from "pyodide";
import type {
  BandResult,
  ButterflyChunk,
  LatticeResult,
  RuntimeProgress,
  ScientificParameters,
} from "./contracts";

type ProgressCallback = ((progress: RuntimeProgress) => void) & ProxyMarked;

interface PythonButterfly {
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
  chern: Int32Array;
  group_start: Int32Array;
  group_size: Int32Array;
  path_x: Float64Array;
  path_energy: Float64Array;
  path_ticks: Float64Array;
  path_labels: string[];
  reciprocal: Float64Array;
}

interface PythonLattice {
  sites: Float64Array;
  site_basis: Int32Array;
  links: Float64Array;
  unit_cell: Float64Array;
  magnetic_cell: Float64Array;
  lattice_vectors: Float64Array;
  reciprocal_vectors: Float64Array;
  bz: Float64Array;
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
  parameters: ScientificParameters,
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
from HT.web import compute_bands, compute_butterfly_batch, compute_lattice
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
      chern: new Int32Array(result.chern),
      groupStart: new Int32Array(result.group_start),
      groupSize: new Int32Array(result.group_size),
      pathX: new Float64Array(result.path_x),
      pathEnergy: new Float64Array(result.path_energy),
      pathTicks: new Float64Array(result.path_ticks),
      pathLabels: Array.from(result.path_labels),
      reciprocal: new Float64Array(result.reciprocal),
      elapsedMs: performance.now() - started,
    };
    return transfer(bands, [
      bands.energy.buffer,
      bands.berry.buffer,
      bands.chern.buffer,
      bands.groupStart.buffer,
      bands.groupSize.buffer,
      bands.pathX.buffer,
      bands.pathEnergy.buffer,
      bands.pathTicks.buffer,
      bands.reciprocal.buffer,
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
      bz: new Float64Array(result.bz),
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
      lattice.bz.buffer,
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
