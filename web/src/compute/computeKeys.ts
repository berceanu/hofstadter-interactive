import type { ScientificParameters } from "./contracts";

export interface TopologyRefinementGrid {
  samplesX: number;
  samplesY: number;
  capped: boolean;
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
    ...(parameters.lattice === "custom"
      ? { customBasis: parameters.customBasis }
      : {}),
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

export function topologyRefinementGrid(
  parameters: ScientificParameters,
): TopologyRefinementGrid {
  const requestedX = Math.max(
    2 * parameters.samples - 1,
    2 * parameters.q - 1,
    Math.min(81, 4 * parameters.q - 3),
  );
  const samplesX = Math.min(161, requestedX);
  const requestedY = Math.max(samplesX, 4 * parameters.q - 3);
  const samplesY = Math.min(241, requestedY);
  return {
    samplesX,
    samplesY,
    capped: samplesX < requestedX || samplesY < requestedY,
  };
}

export function topologyComputationKey(
  parameters: ScientificParameters,
  grid = topologyRefinementGrid(parameters),
) {
  return `${bandComputationKey(parameters)}|topology:${grid.samplesX}x${grid.samplesY}`;
}

export function latticeComputationKey(parameters: ScientificParameters) {
  return parameterKey("lattice", parameters);
}
