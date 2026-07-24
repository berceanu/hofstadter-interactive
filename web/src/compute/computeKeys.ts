import type { ScientificParameters } from "./contracts";

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

export function latticeComputationKey(parameters: ScientificParameters) {
  return parameterKey("lattice", parameters);
}
