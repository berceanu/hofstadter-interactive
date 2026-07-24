import { describe, expect, it } from "vitest";
import { defaultParameters } from "../state/store";
import {
  bandComputationKey,
  latticeComputationKey,
  sweepComputationKey,
  topologyComputationKey,
  topologyRefinementGrid,
} from "./computeKeys";

describe("panel-specific computation keys", () => {
  it("changes only the band key when the flux cursor moves", () => {
    const first = { ...defaultParameters, p: 1, q: 7 };
    const second = { ...first, p: 2 };
    expect(sweepComputationKey(second)).toBe(sweepComputationKey(first));
    expect(latticeComputationKey(second)).toBe(latticeComputationKey(first));
    expect(bandComputationKey(second)).not.toBe(bandComputationKey(first));
  });

  it("keeps sampling and grouping controls out of sweep/lattice keys", () => {
    const first = { ...defaultParameters, samples: 9, bgt: 0.01 };
    const second = { ...first, samples: 21, bgt: 0.05 };
    expect(sweepComputationKey(second)).toBe(sweepComputationKey(first));
    expect(latticeComputationKey(second)).toBe(latticeComputationKey(first));
    expect(bandComputationKey(second)).not.toBe(bandComputationKey(first));
  });

  it("keeps sweep period out of the lattice key", () => {
    const first = { ...defaultParameters, period: 1 };
    const second = { ...first, period: 8 };
    expect(latticeComputationKey(second)).toBe(latticeComputationKey(first));
    expect(sweepComputationKey(second)).not.toBe(sweepComputationKey(first));
    expect(bandComputationKey(second)).not.toBe(bandComputationKey(first));
  });

  it("keys every custom-lattice result by the edited basis", () => {
    const first = {
      ...defaultParameters,
      lattice: "custom" as const,
      customBasis: [[0, 0], [0.5, 0]] as [number, number][],
    };
    const second = {
      ...first,
      customBasis: [[0, 0], [0.5, 0.25]] as [number, number][],
    };
    expect(sweepComputationKey(second)).not.toBe(sweepComputationKey(first));
    expect(bandComputationKey(second)).not.toBe(bandComputationKey(first));
    expect(latticeComputationKey(second)).not.toBe(
      latticeComputationKey(first),
    );
  });

  it("chooses a memory-bounded anisotropic topology grid for q=31", () => {
    const parameters = {
      ...defaultParameters,
      p: 1,
      q: 31,
      samples: 31,
    };
    expect(topologyRefinementGrid(parameters)).toEqual({
      samplesX: 81,
      samplesY: 121,
      capped: false,
    });
    expect(topologyComputationKey(parameters)).toContain("topology:81x121");
  });

  it("honestly caps impractical large-q refinement grids", () => {
    expect(
      topologyRefinementGrid({
        ...defaultParameters,
        q: 199,
        samples: 31,
      }),
    ).toEqual({
      samplesX: 161,
      samplesY: 241,
      capped: true,
    });
  });
});
