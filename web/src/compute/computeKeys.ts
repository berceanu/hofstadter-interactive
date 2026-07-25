import type { ScientificParameters } from "./contracts";

export interface TopologyRefinementGrid {
  samplesX: number;
  samplesY: number;
  capped: boolean;
}

export interface TopologyRefinementPlan {
  levels: TopologyRefinementGrid[];
  capped: boolean;
}

export interface DispersionRefinementGrid {
  surfaceSamples: number;
  pathSamplesPerSegment: number;
  requestedSurfaceSamples: number;
  requestedPathSamplesPerSegment: number;
  capped: boolean;
}

const DISPERSION_EIGENVALUE_BUDGET = 500_000_000;
const TOPOLOGY_EIGENSOLVE_BUDGET = 650_000_000;
const TOPOLOGY_MAX_SAMPLES_X = 161;
const TOPOLOGY_MAX_SAMPLES_Y = 241;
const TOPOLOGY_MAX_PASSES = 3;

export function estimatedBandCount(parameters: ScientificParameters) {
  const multiplier =
    parameters.lattice === "honeycomb"
      ? 2
      : parameters.lattice === "kagome"
        ? 3
        : 1;
  return Math.max(1, parameters.q * multiplier);
}

function largestOddAtMost(value: number) {
  const integer = Math.max(5, Math.floor(value));
  return integer % 2 === 0 ? integer - 1 : integer;
}

function smallestOddAtLeast(value: number) {
  const integer = Math.max(5, Math.ceil(value));
  return integer % 2 === 0 ? integer + 1 : integer;
}

function parameterKey(
  kind: "sweep" | "bands" | "lattice",
  parameters: ScientificParameters,
) {
  const common = {
    lattice: parameters.lattice,
    q: parameters.q,
    hoppings: parameters.hoppings,
    alpha: parameters.alpha,
    theta: parameters.theta,
  };
  if (kind === "lattice") return JSON.stringify(common);
  const sweep = { ...common, period: parameters.period };
  if (kind === "sweep") return JSON.stringify(sweep);
  return JSON.stringify({
    ...sweep,
    p: parameters.p,
    samples: parameters.samples,
    bgt: parameters.bgt,
  });
}

export function sweepComputationKey(parameters: ScientificParameters) {
  return parameterKey("sweep", parameters);
}

export function bandComputationKey(parameters: ScientificParameters) {
  return parameterKey("bands", parameters);
}

export function baseTopologyGridSufficient(
  parameters: ScientificParameters,
  samples = parameters.samples,
) {
  return samples >= 2 * parameters.q + 1;
}

function topologyBudgetPoints(parameters: ScientificParameters) {
  return Math.floor(
    TOPOLOGY_EIGENSOLVE_BUDGET / estimatedBandCount(parameters) ** 3,
  );
}

function fitTopologyGrid(
  parameters: ScientificParameters,
  requestedX: number,
  requestedY: number,
): TopologyRefinementGrid {
  const hardX = Math.min(
    TOPOLOGY_MAX_SAMPLES_X,
    smallestOddAtLeast(requestedX),
  );
  const hardY = Math.min(
    TOPOLOGY_MAX_SAMPLES_Y,
    smallestOddAtLeast(requestedY),
  );
  const budgetPoints = topologyBudgetPoints(parameters);
  if (hardX * hardY <= budgetPoints) {
    return {
      samplesX: hardX,
      samplesY: hardY,
      capped:
        hardX < requestedX
        || hardY < requestedY,
    };
  }

  const aspect = Math.max(1, hardY / Math.max(1, hardX));
  let samplesX = Math.min(
    hardX,
    largestOddAtMost(Math.sqrt(budgetPoints / aspect)),
  );
  let samplesY = Math.min(
    hardY,
    largestOddAtMost(budgetPoints / Math.max(1, samplesX)),
  );
  while (samplesX * samplesY > budgetPoints && samplesY > 5) {
    samplesY -= 2;
  }
  while (samplesX * samplesY > budgetPoints && samplesX > 5) {
    samplesX -= 2;
  }
  return {
    samplesX,
    samplesY,
    capped: true,
  };
}

export function topologyRefinementPlan(
  parameters: ScientificParameters,
): TopologyRefinementPlan {
  const minimumPoints = 5 * 5;
  if (topologyBudgetPoints(parameters) < minimumPoints) {
    return { levels: [], capped: true };
  }

  let requestedX = Math.max(
    2 * parameters.samples - 1,
    2 * parameters.q - 1,
    Math.min(81, 4 * parameters.q - 3),
  );
  let requestedY = Math.max(requestedX, 6 * parameters.q - 7);
  const levels: TopologyRefinementGrid[] = [];
  for (let pass = 0; pass < TOPOLOGY_MAX_PASSES; pass += 1) {
    const grid = fitTopologyGrid(parameters, requestedX, requestedY);
    const previous = levels.at(-1);
    if (
      previous
      && previous.samplesX === grid.samplesX
      && previous.samplesY === grid.samplesY
    ) {
      break;
    }
    levels.push(grid);
    if (grid.capped) break;
    if (
      grid.samplesX >= TOPOLOGY_MAX_SAMPLES_X
      && grid.samplesY >= TOPOLOGY_MAX_SAMPLES_Y
    ) {
      break;
    }
    requestedX = Math.min(
      TOPOLOGY_MAX_SAMPLES_X,
      smallestOddAtLeast(grid.samplesX * 1.5),
    );
    requestedY = Math.min(
      TOPOLOGY_MAX_SAMPLES_Y,
      smallestOddAtLeast(grid.samplesY * 1.5),
    );
  }
  return {
    levels,
    capped:
      levels.length === 0
      || Boolean(levels.at(-1)?.capped)
      || levels.length === TOPOLOGY_MAX_PASSES,
  };
}

export function topologyRefinementGrid(
  parameters: ScientificParameters,
): TopologyRefinementGrid {
  return topologyRefinementPlan(parameters).levels[0] ?? {
    samplesX: 5,
    samplesY: 5,
    capped: true,
  };
}

export interface TopologyBandGroups {
  bands: number;
  groupStart: Int32Array;
  groupSize: Int32Array;
}

export function topologyTargetLabel(
  bands: TopologyBandGroups | undefined,
  selectedBand: number,
) {
  const clamped = Math.max(0, selectedBand);
  if (!bands) return `band-${clamped}`;
  const band = Math.min(bands.bands - 1, clamped);
  const start = bands.groupStart[band] ?? band;
  const size = bands.groupSize[start] ?? 1;
  return `group-${start}-${size}`;
}

export function activeTopologyComputationKey(
  parameters: ScientificParameters,
  selectedBand: number,
  bands: TopologyBandGroups | undefined,
  bandsKey: string | undefined,
  plan = topologyRefinementPlan(parameters),
) {
  const known =
    bands && bandsKey === bandComputationKey(parameters) ? bands : undefined;
  return topologyComputationKey(
    parameters,
    topologyTargetLabel(known, selectedBand),
    plan,
  );
}

export function topologyComputationKey(
  parameters: ScientificParameters,
  target: number | string = 0,
  plan = topologyRefinementPlan(parameters),
) {
  const label =
    typeof target === "number" ? `band-${Math.max(0, target)}` : target;
  const levels = plan.levels.length
    ? plan.levels
        .map((grid) => `${grid.samplesX}x${grid.samplesY}`)
        .join(">")
    : "unavailable";
  return `${bandComputationKey(parameters)}|topology:auto:${label}:${levels}`;
}

export function dispersionRefinementGrid(
  parameters: ScientificParameters,
  bandCutZoom = 1,
): DispersionRefinementGrid {
  const bandCount = estimatedBandCount(parameters);
  const matrixCost = bandCount ** 3;
  const basePathSamples = Math.max(24, parameters.samples);
  const zoomTier = 2 ** Math.ceil(
    Math.log2(Math.max(1, bandCutZoom)),
  );
  const requestedSurfaceSamples = Math.max(
    2 * parameters.samples - 1,
    4 * parameters.q + 1,
  );
  const requestedPathSamplesPerSegment = Math.max(
    basePathSamples,
    4 * parameters.q,
    Math.ceil(48 * Math.sqrt(zoomTier)),
  );
  const affordableSurfaceSamples = largestOddAtMost(
    Math.sqrt(DISPERSION_EIGENVALUE_BUDGET / matrixCost),
  );
  const surfaceSamples = Math.max(
    parameters.samples,
    Math.min(129, requestedSurfaceSamples, affordableSurfaceSamples),
  );
  const affordablePathSamples = Math.floor(
    DISPERSION_EIGENVALUE_BUDGET / (4 * matrixCost),
  );
  const pathSamplesPerSegment = Math.max(
    basePathSamples,
    Math.min(
      513,
      requestedPathSamplesPerSegment,
      affordablePathSamples,
    ),
  );
  return {
    surfaceSamples,
    pathSamplesPerSegment,
    requestedSurfaceSamples,
    requestedPathSamplesPerSegment,
    capped:
      surfaceSamples < requestedSurfaceSamples
      || pathSamplesPerSegment < requestedPathSamplesPerSegment,
  };
}

export function dispersionComputationKey(
  parameters: ScientificParameters,
  grid = dispersionRefinementGrid(parameters),
) {
  return `${bandComputationKey(parameters)}|dispersion:${grid.surfaceSamples}x${grid.surfaceSamples}:path-${grid.pathSamplesPerSegment}`;
}

export function latticeComputationKey(parameters: ScientificParameters) {
  return parameterKey("lattice", parameters);
}
