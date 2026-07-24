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
import { parseNpzArchive, type NpyArray } from "./npz";

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
  return array instanceof Int32Array ? array : Int32Array.from(array);
}

function inferredDenominator(flux: Float64Array) {
  if (!flux.length) return defaultParameters.q;
  for (let q = 2; q <= 199; q += 1) {
    let matches = true;
    for (let index = 0; index < flux.length; index += 1) {
      if (Math.abs(flux[index] * q - Math.round(flux[index] * q)) > 1e-7) {
        matches = false;
        break;
      }
    }
    if (matches) return q;
  }
  return defaultParameters.q;
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

function fluxMatchesDenominator(flux: Float64Array, q: number) {
  if (!Number.isInteger(q) || q < 1) return false;
  for (let index = 0; index < flux.length; index += 1) {
    if (Math.abs(flux[index] * q - Math.round(flux[index] * q)) > 1e-7) {
      return false;
    }
  }
  return true;
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
  // The denominator must actually divide every flux in the archive.  The
  // app's own metadata is authoritative and fails hard when inconsistent;
  // a filename hint (files get renamed) silently falls back to the data.
  let q: number;
  if (raw.q !== undefined) {
    q = Number(raw.q);
    if (!fluxMatchesDenominator(fallbackFlux, q)) {
      throw new Error(
        "The archive's flux values do not match its declared denominator.",
      );
    }
  } else if (
    filenameFallback.q !== undefined
    && fluxMatchesDenominator(fallbackFlux, filenameFallback.q)
  ) {
    q = filenameFallback.q;
  } else {
    q = inferredDenominator(fallbackFlux);
    if (!fluxMatchesDenominator(fallbackFlux, q)) {
      throw new Error(
        "The archive's flux values do not fit any denominator up to 199.",
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
  if (metadata?.view === "bands" || metadata?.view === "lattice") {
    throw new Error(
      "NPZ loading currently restores butterfly and Wannier sweep archives.",
    );
  }
  const view = archiveView(metadata, filename);
  const aliasFlux = asFloat(arrays.get("flux"));
  const aliasEnergy = asFloat(arrays.get("energy"));
  const stateFlux =
    asFloat(arrays.get("state_flux"))
    ?? (view === "butterfly" ? aliasFlux : undefined)
    ?? new Float64Array();
  const stateEnergy =
    asFloat(arrays.get("state_energy"))
    ?? (view === "butterfly" ? aliasEnergy : undefined)
    ?? new Float64Array();
  if (stateFlux.length !== stateEnergy.length) {
    throw new Error(
      "state_flux and state_energy hold different numbers of values.",
    );
  }
  const stateCount = stateFlux.length;
  const providedBand =
    asInt(arrays.get("state_band"))
    ?? (view === "butterfly" ? asInt(arrays.get("band")) : undefined);
  const providedChern =
    asInt(arrays.get("state_chern"))
    ?? (view === "butterfly" ? asInt(arrays.get("chern")) : undefined);
  requireLength("state_band", providedBand, stateCount);
  requireLength("state_chern", providedChern, stateCount);
  const stateBand = providedBand ?? new Int32Array(stateCount);
  const stateChern = providedChern ?? new Int32Array(stateCount);
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
  if (!stateCount && !gapCount) {
    throw new Error("The NPZ archive has no plottable sweep data.");
  }
  const parameters = parametersFromMetadata(
    metadata,
    filename,
    stateCount ? stateFlux : gapFlux,
  );
  const topologyFlag = asInt(arrays.get("topology_available"));
  const topologyAvailable = topologyFlag
    ? topologyFlag[0] !== 0
    : stateChern.some((value) => value !== 0)
      || gapChern.some((value) => value !== 0);
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
  return restoreNpzBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}
