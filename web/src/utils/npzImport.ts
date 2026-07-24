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
  return normalizeParameters({
    ...defaultParameters,
    lattice,
    p: Number(raw.p ?? defaultParameters.p),
    q: Number(
      raw.q
      ?? filenameFallback.q
      ?? inferredDenominator(fallbackFlux),
    ),
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

function fitFloat(array: Float64Array | undefined, length: number) {
  if (!array) return new Float64Array(length);
  if (array.length === length) return array;
  if (array.length > length) return array.slice(0, length);
  const output = new Float64Array(length);
  output.set(array);
  return output;
}

function fitInt(array: Int32Array | undefined, length: number) {
  if (!array) return new Int32Array(length);
  if (array.length === length) return array;
  if (array.length > length) return array.slice(0, length);
  const output = new Int32Array(length);
  output.set(array);
  return output;
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
  const stateCount = Math.min(stateFlux.length, stateEnergy.length);
  const fittedStateFlux = stateFlux.slice(0, stateCount);
  const fittedStateEnergy = stateEnergy.slice(0, stateCount);
  const stateBand = fitInt(
    asInt(arrays.get("state_band"))
      ?? (view === "butterfly" ? asInt(arrays.get("band")) : undefined),
    stateCount,
  );
  const stateChern = fitInt(
    asInt(arrays.get("state_chern"))
      ?? (view === "butterfly" ? asInt(arrays.get("chern")) : undefined),
    stateCount,
  );
  const derived = deriveGaps(fittedStateFlux, fittedStateEnergy, stateChern);
  const rawGapFlux =
    asFloat(arrays.get("gap_flux"))
    ?? (view === "wannier" ? aliasFlux : undefined)
    ?? derived.gapFlux;
  const rawGapEnergy =
    asFloat(arrays.get("gap_energy"))
    ?? (view === "wannier" ? aliasEnergy : undefined)
    ?? derived.gapEnergy;
  const rawGap =
    asFloat(arrays.get("gap"))
    ?? derived.gap;
  const rawDos =
    asFloat(arrays.get("integrated_dos"))
    ?? derived.dos;
  const rawGapChern =
    asInt(arrays.get("gap_chern"))
    ?? (view === "wannier" ? asInt(arrays.get("chern")) : undefined)
    ?? derived.gapChern;
  const gapCount = Math.min(
    rawGapFlux.length,
    rawGapEnergy.length,
    rawGap.length,
    rawDos.length,
    rawGapChern.length,
  );
  if (!stateCount && !gapCount) {
    throw new Error("The NPZ archive has no plottable sweep data.");
  }
  const parameters = parametersFromMetadata(
    metadata,
    filename,
    stateCount ? fittedStateFlux : rawGapFlux,
  );
  const topologyFlag = asInt(arrays.get("topology_available"));
  const topologyAvailable = topologyFlag
    ? topologyFlag[0] !== 0
    : stateChern.some((value) => value !== 0)
      || rawGapChern.some((value) => value !== 0);
  const requestId = `npz-${Date.now().toString(36)}`;
  const chunk: ButterflyChunk = {
    requestId,
    topologyAvailable,
    flux: fittedStateFlux,
    energy: fittedStateEnergy,
    band: stateBand,
    chern: stateChern,
    dos: fitFloat(rawDos, gapCount),
    gap: fitFloat(rawGap, gapCount),
    gapChern: fitInt(rawGapChern, gapCount),
    gapFlux: fitFloat(rawGapFlux, gapCount),
    gapEnergy: fitFloat(rawGapEnergy, gapCount),
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
