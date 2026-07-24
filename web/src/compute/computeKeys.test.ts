import { describe, expect, it } from "vitest";
import { defaultParameters } from "../state/store";
import {
  bandComputationKey,
  dispersionComputationKey,
  dispersionRefinementGrid,
  latticeComputationKey,
  sweepComputationKey,
  topologyComputationKey,
  topologyRefinementGrid,
  topologyRefinementPlan,
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
      samplesY: 179,
      capped: false,
    });
    expect(topologyRefinementPlan(parameters).levels[0]).toEqual({
      samplesX: 81,
      samplesY: 179,
      capped: false,
    });
    expect(topologyComputationKey(parameters, 15)).toContain(
      "topology:auto:band-15:81x179",
    );
  });

  it("honestly caps impractical large-q refinement grids", () => {
    const parameters = {
      ...defaultParameters,
      q: 199,
      samples: 7,
    };
    const grid = topologyRefinementGrid(parameters);
    expect(grid.capped).toBe(true);
    expect(grid.samplesX).toBeLessThanOrEqual(161);
    expect(grid.samplesY).toBeLessThanOrEqual(241);
    expect(
      grid.samplesX * grid.samplesY * 199 ** 3,
    ).toBeLessThanOrEqual(650_000_000);
  });

  it("chooses a q-aware energy-only dispersion grid for q=31", () => {
    const parameters = {
      ...defaultParameters,
      q: 31,
      samples: 17,
    };
    expect(dispersionRefinementGrid(parameters)).toEqual({
      surfaceSamples: 125,
      pathSamplesPerSegment: 124,
      requestedSurfaceSamples: 125,
      requestedPathSamplesPerSegment: 124,
      capped: false,
    });
    expect(dispersionComputationKey(parameters)).toContain(
      "dispersion:125x125:path-124",
    );
  });

  it("caps dispersion refinement when the magnetic matrix is too large", () => {
    expect(
      dispersionRefinementGrid({
        ...defaultParameters,
        q: 199,
        samples: 31,
      }),
    ).toEqual({
      surfaceSamples: 31,
      pathSamplesPerSegment: 31,
      requestedSurfaceSamples: 797,
      requestedPathSamplesPerSegment: 796,
      capped: true,
    });
  });

  it("raises only path detail when the linked cut is deeply zoomed", () => {
    const parameters = {
      ...defaultParameters,
      q: 31,
      samples: 17,
    };
    const overview = dispersionRefinementGrid(parameters, 1);
    const zoomed = dispersionRefinementGrid(parameters, 32);
    expect(zoomed.surfaceSamples).toBe(overview.surfaceSamples);
    expect(zoomed.pathSamplesPerSegment).toBeGreaterThan(
      overview.pathSamplesPerSegment,
    );
    expect(dispersionComputationKey(parameters, zoomed)).not.toBe(
      dispersionComputationKey(parameters, overview),
    );
  });
});
