import { describe, expect, it } from "vitest";
import {
  bandComputationKey,
  latticeComputationKey,
  sweepComputationKey,
} from "../compute/computeKeys";
import { defaultParameters } from "../state/store";
import {
  exportsPending,
  fluxFraction,
  type ExportCacheState,
} from "./viewIntegrity";

function readyCache(
  parameters = defaultParameters,
): ExportCacheState {
  return {
    butterfly: { complete: true },
    butterflyKey: sweepComputationKey(parameters),
    butterflyStale: false,
    bands: {},
    bandsKey: bandComputationKey(parameters),
    bandsStale: false,
    lattice: {},
    latticeKey: latticeComputationKey(parameters),
    latticeStale: false,
    geometryStale: false,
  };
}

describe("view data integrity", () => {
  it("reduces a point fraction even when the preferred denominator matches", () => {
    expect(fluxFraction(1 / 7, 14)).toEqual({
      numerator: 1,
      denominator: 7,
    });
    expect(fluxFraction(0, 14)).toEqual({
      numerator: 0,
      denominator: 1,
    });
  });

  it("pauses exports immediately when live parameters differ from cached data", () => {
    const previous = { ...defaultParameters, q: 7 };
    const current = { ...defaultParameters, q: 47 };
    const cache = readyCache(previous);

    expect(exportsPending("butterfly", current, cache)).toBe(true);
    expect(exportsPending("bands", current, cache)).toBe(true);
    expect(exportsPending("lattice", current, cache)).toBe(true);
  });

  it("pauses band exports while visible geometry is stale", () => {
    const cache = {
      ...readyCache(),
      geometryStale: true,
    };
    expect(exportsPending("bands", defaultParameters, cache)).toBe(true);
  });
});
