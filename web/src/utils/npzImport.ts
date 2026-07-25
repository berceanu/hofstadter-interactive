import type {
  ButterflyChunk,
  LatticeKind,
  ScientificParameters,
  ViewKind,
} from "../compute/contracts";
import { sweepComputationKey } from "../compute/computeKeys";
import { resultCache } from "../state/resultCache";
import {
  defaultParameters,
  normalizeParameters,
  useAppStore,
} from "../state/store";
import {
  MAX_NPZ_FILE_BYTES,
  parseNpzArchive,
  type NpyArray,
} from "./npz";

const supportedLattices = new Set<LatticeKind>([
  "square",
  "triangular",
  "honeycomb",
  "kagome",
  "bravais",
  "custom",
]);

function asFloat(array?: NpyArray) {
  if (!array) return undefined;
  return array instanceof Float64Array
    ? array
    : Float64Array.from(array);
}

function asInt(array?: NpyArray) {
  if (!array) return undefined;
  if (array instanceof Int32Array) return array;
  for (const value of array) {
    if (
      !Number.isInteger(value)
      || value < -2147483648
      || value > 2147483647
    ) {
      throw new Error("An integer array contains a non-integer value.");
    }
  }
  return Int32Array.from(array);
}

function inferredDenominator(flux: Float64Array) {
  if (!flux.length) return undefined;
  for (let q = 2; q <= 199; q += 1) {
    let matches = true;
    for (let index = 0; index < flux.length; index += 1) {
      if (
        !Number.isFinite(flux[index])
        || Math.abs(flux[index] * q - Math.round(flux[index] * q)) > 1e-7
      ) {
        matches = false;
        break;
      }
    }
    if (matches) return q;
  }
  return undefined;
}

function filenameParameters(filename: string) {
  const lower = filename.toLowerCase();
  const lattice = Array.from(supportedLattices).find((candidate) =>
    lower.includes(`-${candidate}-`) || lower.includes(`_${candidate}_`)
  );
  const qMatch = lower.match(/(?:^|[-_])q[-_]?(\d+)(?:[-_.]|$)/);
  return {
    ...(lattice ? { lattice } : {}),
    ...(qMatch ? { q: Number(qMatch[1]) } : {}),
  };
}

function parametersFromMetadata(
  metadata: Record<string, unknown> | undefined,
  filename: string,
  fallbackFlux: Float64Array,
) {
  const raw =
    metadata?.parameters
    && typeof metadata.parameters === "object"
    && !Array.isArray(metadata.parameters)
      ? metadata.parameters as Record<string, unknown>
      : {};
  const filenameFallback = filenameParameters(filename);
  const rawLattice = raw.lattice ?? filenameFallback.lattice;
  const lattice = supportedLattices.has(rawLattice as LatticeKind)
    ? rawLattice as LatticeKind
    : defaultParameters.lattice;
  const hoppings = Array.isArray(raw.hoppings)
    ? raw.hoppings.map(Number).filter(Number.isFinite)
    : defaultParameters.hoppings;
  const theta = Array.isArray(raw.theta) && raw.theta.length === 2
    ? [Number(raw.theta[0]), Number(raw.theta[1])] as [number, number]
    : defaultParameters.theta;
  const customBasis = Array.isArray(raw.customBasis)
    ? raw.customBasis
        .filter(Array.isArray)
        .map((point) => [Number(point[0]), Number(point[1])] as [number, number])
    : defaultParameters.customBasis;
  // The smallest common denominator is the canonical denominator of a
  // fixed-q sweep.  Merely dividing every flux is not enough: q=14 also
  // divides q=7 data, but would describe a different physical sweep.
  const q = inferredDenominator(fallbackFlux);
  if (q === undefined) {
    throw new Error(
      "The archive's flux values do not fit any denominator up to 199.",
    );
  }
  if (raw.q !== undefined) {
    const declaredQ = Number(raw.q);
    if (!Number.isInteger(declaredQ) || declaredQ !== q) {
      throw new Error(
        "The archive's flux values do not match its declared denominator.",
      );
    }
  }
  return normalizeParameters({
    ...defaultParameters,
    lattice,
    p: Number(raw.p ?? defaultParameters.p),
    q,
    a: Number(raw.a ?? defaultParameters.a),
    hoppings,
    alpha: Number(raw.alpha ?? defaultParameters.alpha),
    theta,
    period: Number(raw.period ?? defaultParameters.period),
    samples: Number(raw.samples ?? defaultParameters.samples),
    bgt: Number(raw.bgt ?? defaultParameters.bgt),
    customBasis,
  });
}

function deriveGaps(
  flux: Float64Array,
  energy: Float64Array,
  chern: Int32Array,
) {
  const gapFlux: number[] = [];
  const gapEnergy: number[] = [];
  const gap: number[] = [];
  const dos: number[] = [];
  const gapChern: number[] = [];
  let start = 0;
  while (start < flux.length) {
    let end = start + 1;
    while (end < flux.length && Math.abs(flux[end] - flux[start]) < 1e-10) {
      end += 1;
    }
    const count = end - start;
    let cumulativeChern = 0;
    for (let index = start; index < end - 1; index += 1) {
      cumulativeChern += chern[index] ?? 0;
      gapFlux.push(flux[start]);
      gapEnergy.push((energy[index] + energy[index + 1]) / 2);
      gap.push(energy[index + 1] - energy[index]);
      dos.push((index - start + 1) / count);
      gapChern.push(cumulativeChern);
    }
    start = end;
  }
  return {
    gapFlux: Float64Array.from(gapFlux),
    gapEnergy: Float64Array.from(gapEnergy),
    gap: Float64Array.from(gap),
    dos: Float64Array.from(dos),
    gapChern: Int32Array.from(gapChern),
  };
}

function archiveView(
  metadata: Record<string, unknown> | undefined,
  filename: string,
): "butterfly" | "wannier" {
  if (metadata?.view === "wannier") return "wannier";
  if (metadata?.view === "butterfly") return "butterfly";
  return filename.toLowerCase().includes("wannier")
    ? "wannier"
    : "butterfly";
}

// A present-but-mismatched array is a corrupt or foreign archive; padding it
// would fabricate physical-looking states (band 0, C = 0), so reject instead.
function requireLength(
  name: string,
  array: { length: number } | undefined,
  length: number,
) {
  if (array && array.length !== length) {
    throw new Error(
      `Array ${name} holds ${array.length} values, expected ${length}.`,
    );
  }
}

function requireArray<T>(
  name: string,
  array: T | undefined,
): T {
  if (array === undefined) {
    throw new Error(`The archive is missing the required ${name} array.`);
  }
  return array;
}

function requireFinite(name: string, array: Float64Array) {
  for (const value of array) {
    if (!Number.isFinite(value)) {
      throw new Error(`Array ${name} contains a non-finite value.`);
    }
  }
}

function validateStateArrays(
  flux: Float64Array,
  energy: Float64Array,
  band: Int32Array,
) {
  if (!flux.length) {
    throw new Error("The NPZ archive has no spectral states.");
  }
  requireFinite("state_flux", flux);
  requireFinite("state_energy", energy);
  let start = 0;
  while (start < flux.length) {
    if (flux[start] <= 0 || flux[start] >= 1) {
      throw new Error("state_flux values must lie strictly between 0 and 1.");
    }
    if (start > 0 && flux[start] < flux[start - 1] - 1e-10) {
      throw new Error("state_flux groups must be in ascending order.");
    }
    let end = start + 1;
    while (end < flux.length && Math.abs(flux[end] - flux[start]) < 1e-10) {
      end += 1;
    }
    for (let index = start; index < end; index += 1) {
      if (band[index] !== index - start) {
        throw new Error(
          "state_band must enumerate each flux group from zero in energy order.",
        );
      }
      if (index > start && energy[index] < energy[index - 1]) {
        throw new Error(
          "state_energy must be ascending inside every flux group.",
        );
      }
    }
    start = end;
  }
}

function validateGapArrays(
  stateFlux: Float64Array,
  stateEnergy: Float64Array,
  gapFlux: Float64Array,
  gapEnergy: Float64Array,
  gap: Float64Array,
  dos: Float64Array,
) {
  requireFinite("gap_flux", gapFlux);
  requireFinite("gap_energy", gapEnergy);
  requireFinite("gap", gap);
  requireFinite("integrated_dos", dos);
  const stateGroups = new Map<string, { start: number; end: number }>();
  let stateStart = 0;
  while (stateStart < stateFlux.length) {
    let stateEnd = stateStart + 1;
    while (
      stateEnd < stateFlux.length
      && Math.abs(stateFlux[stateEnd] - stateFlux[stateStart]) < 1e-10
    ) {
      stateEnd += 1;
    }
    stateGroups.set(stateFlux[stateStart].toPrecision(12), {
      start: stateStart,
      end: stateEnd,
    });
    stateStart = stateEnd;
  }
  let previousFlux = -Infinity;
  let previousDos = -Infinity;
  for (let index = 0; index < gapFlux.length; index += 1) {
    const currentFlux = gapFlux[index];
    if (currentFlux < previousFlux - 1e-10) {
      throw new Error("gap_flux groups must be in ascending order.");
    }
    if (Math.abs(currentFlux - previousFlux) >= 1e-10) {
      previousDos = -Infinity;
    }
    if (gap[index] < -1e-10) {
      throw new Error("Gap widths cannot be negative.");
    }
    if (dos[index] <= 0 || dos[index] >= 1 || dos[index] <= previousDos) {
      throw new Error(
        "integrated_dos must increase strictly between zero and one per flux.",
      );
    }
    const group = stateGroups.get(currentFlux.toPrecision(12));
    if (!group) {
      throw new Error("Each gap_flux value must match a spectral-state flux.");
    }
    const count = group.end - group.start;
    const upper = Math.round(dos[index] * count);
    if (
      upper < 1
      || upper >= count
      || Math.abs(dos[index] - upper / count) > 1e-7
    ) {
      throw new Error(
        "integrated_dos does not identify a valid gap in its state group.",
      );
    }
    const lowerEnergy = stateEnergy[group.start + upper - 1];
    const upperEnergy = stateEnergy[group.start + upper];
    const expectedGap = upperEnergy - lowerEnergy;
    const expectedMidpoint = (lowerEnergy + upperEnergy) / 2;
    const tolerance = 1e-8 * Math.max(1, Math.abs(expectedMidpoint));
    if (
      Math.abs(gap[index] - expectedGap) > tolerance
      || Math.abs(gapEnergy[index] - expectedMidpoint) > tolerance
    ) {
      throw new Error(
        "Gap widths or midgap energies contradict the spectral states.",
      );
    }
    previousFlux = currentFlux;
    previousDos = dos[index];
  }
}

export interface NpzImportSummary {
  view: "butterfly" | "wannier";
  parameters: ScientificParameters;
  states: number;
  gaps: number;
}

export function restoreNpzBytes(
  bytes: Uint8Array,
  filename = "spectrum.npz",
): NpzImportSummary {
  const { arrays, metadata } = parseNpzArchive(bytes);
  if (
    metadata !== undefined
    && metadata.schema !== "hofstadter-interactive/1"
  ) {
    throw new Error("The NPZ archive uses an unsupported schema version.");
  }
  if (metadata?.view === "bands" || metadata?.view === "lattice") {
    throw new Error(
      "NPZ loading currently restores butterfly and Wannier sweep archives.",
    );
  }
  const view = archiveView(metadata, filename);
  const aliasFlux = asFloat(arrays.get("flux"));
  const aliasEnergy = asFloat(arrays.get("energy"));
  const stateFlux = requireArray(
    "state_flux",
    asFloat(arrays.get("state_flux"))
      ?? (view === "butterfly" ? aliasFlux : undefined),
  );
  const stateEnergy = requireArray(
    "state_energy",
    asFloat(arrays.get("state_energy"))
      ?? (view === "butterfly" ? aliasEnergy : undefined),
  );
  if (stateFlux.length !== stateEnergy.length) {
    throw new Error(
      "state_flux and state_energy hold different numbers of values.",
    );
  }
  const stateCount = stateFlux.length;
  const stateBand = requireArray(
    "state_band",
    asInt(arrays.get("state_band"))
      ?? (view === "butterfly" ? asInt(arrays.get("band")) : undefined),
  );
  const stateChern = requireArray(
    "state_chern",
    asInt(arrays.get("state_chern"))
      ?? (view === "butterfly" ? asInt(arrays.get("chern")) : undefined),
  );
  requireLength("state_band", stateBand, stateCount);
  requireLength("state_chern", stateChern, stateCount);
  validateStateArrays(stateFlux, stateEnergy, stateBand);
  const derived = deriveGaps(stateFlux, stateEnergy, stateChern);
  const providedGapFlux =
    asFloat(arrays.get("gap_flux"))
    ?? (view === "wannier" ? aliasFlux : undefined);
  const providedGapEnergy =
    asFloat(arrays.get("gap_energy"))
    ?? (view === "wannier" ? aliasEnergy : undefined);
  const providedGap = asFloat(arrays.get("gap"));
  const providedDos = asFloat(arrays.get("integrated_dos"));
  const providedGapChern =
    asInt(arrays.get("gap_chern"))
    ?? (view === "wannier" ? asInt(arrays.get("chern")) : undefined);
  const providedGapArrays = [
    providedGapFlux,
    providedGapEnergy,
    providedGap,
    providedDos,
    providedGapChern,
  ].filter((array) => array !== undefined);
  const gapCount = providedGapArrays.length
    ? providedGapArrays[0].length
    : derived.gapFlux.length;
  requireLength("gap_flux", providedGapFlux, gapCount);
  requireLength("gap_energy", providedGapEnergy, gapCount);
  requireLength("gap", providedGap, gapCount);
  requireLength("integrated_dos", providedDos, gapCount);
  requireLength("gap_chern", providedGapChern, gapCount);
  const fallbackGap = (derived_: NpyArray, kind: string) => {
    if (derived_.length !== gapCount) {
      throw new Error(
        `The archive omits ${kind} and it cannot be derived consistently.`,
      );
    }
    return derived_;
  };
  const gapFlux = providedGapFlux
    ?? (fallbackGap(derived.gapFlux, "gap_flux") as Float64Array);
  const gapEnergy = providedGapEnergy
    ?? (fallbackGap(derived.gapEnergy, "gap_energy") as Float64Array);
  const gap = providedGap
    ?? (fallbackGap(derived.gap, "gap") as Float64Array);
  const dos = providedDos
    ?? (fallbackGap(derived.dos, "integrated_dos") as Float64Array);
  const gapChern = providedGapChern
    ?? (fallbackGap(derived.gapChern, "gap_chern") as Int32Array);
  validateGapArrays(
    stateFlux,
    stateEnergy,
    gapFlux,
    gapEnergy,
    gap,
    dos,
  );
  const parameters = parametersFromMetadata(
    metadata,
    filename,
    stateCount ? stateFlux : gapFlux,
  );
  const topologyFlag = requireArray(
    "topology_available",
    asInt(arrays.get("topology_available")),
  );
  if (
    topologyFlag.length !== 1
    || (topologyFlag[0] !== 0 && topologyFlag[0] !== 1)
  ) {
    throw new Error(
      "topology_available must contain exactly one 0 or 1 value.",
    );
  }
  const topologyAvailable = topologyFlag[0] === 1;
  if (
    !topologyAvailable
    && (
      stateChern.some((value) => value !== 0)
      || gapChern.some((value) => value !== 0)
    )
  ) {
    throw new Error(
      "Topology-unavailable archives cannot contain non-zero Chern labels.",
    );
  }
  const requestId = `npz-${Date.now().toString(36)}`;
  const chunk: ButterflyChunk = {
    requestId,
    topologyAvailable,
    flux: stateFlux,
    energy: stateEnergy,
    band: stateBand,
    chern: stateChern,
    dos,
    gap,
    gapChern,
    gapFlux,
    gapEnergy,
    progress: 1,
  };
  const key = sweepComputationKey(parameters);
  resultCache.restoreButterfly(
    {
      requestId,
      chunks: [chunk],
      complete: true,
      elapsedMs: 0,
    },
    key,
  );
  const store = useAppStore.getState();
  const importedView: ViewKind = view;
  store.hydrate({
    ...parameters,
    view: importedView,
    focus: store.workspaceWide ? "workspace" : importedView,
  });
  store.setProgress({
    phase: "complete",
    fraction: 1,
    message: `Loaded ${filename} locally`,
  });
  return {
    view,
    parameters,
    states: stateCount,
    gaps: gapCount,
  };
}

export async function restoreNpzFile(file: File) {
  if (file.size > MAX_NPZ_FILE_BYTES) {
    throw new Error("The NPZ archive is larger than the 64 MB import limit.");
  }
  return restoreNpzBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}
