import { beforeEach, describe, expect, it } from "vitest";
import { resultCache } from "../state/resultCache";
import { defaultParameters, useAppStore } from "../state/store";
import { createNpzArchive, parseNpzArchive } from "./npz";
import { restoreNpzBytes } from "./npzImport";

describe("NPZ spectrum archives", () => {
  beforeEach(() => {
    useAppStore.setState({
      parameters: { ...defaultParameters },
      view: "butterfly",
      focus: "workspace",
      workspaceWide: false,
    });
  });

  it("round-trips typed NPY arrays and JSON metadata", () => {
    const archive = createNpzArchive(
      {
        values: new Float64Array([1.25, -2.5]),
        labels: new Int32Array([3, -7]),
      },
      { schema: "hofstadter-interactive/1", view: "butterfly" },
    );
    const parsed = parseNpzArchive(archive);
    expect(Array.from(parsed.arrays.get("values")!)).toEqual([1.25, -2.5]);
    expect(Array.from(parsed.arrays.get("labels")!)).toEqual([3, -7]);
    expect(parsed.metadata).toMatchObject({
      schema: "hofstadter-interactive/1",
      view: "butterfly",
    });
  });

  it("restores parameters and a cached sweep without recomputing it", () => {
    const parameters = {
      ...defaultParameters,
      lattice: "custom" as const,
      p: 1,
      q: 3,
      customBasis: [
        [0, 0],
        [0.5, 0.25],
      ] as [number, number][],
    };
    const archive = createNpzArchive(
      {
        state_flux: new Float64Array([1 / 3, 1 / 3, 1 / 3]),
        state_energy: new Float64Array([-2, 0, 2]),
        state_band: new Int32Array([0, 1, 2]),
        state_chern: new Int32Array([1, -2, 1]),
        gap_flux: new Float64Array([1 / 3, 1 / 3]),
        gap_energy: new Float64Array([-1, 1]),
        gap: new Float64Array([2, 2]),
        gap_chern: new Int32Array([1, -1]),
        integrated_dos: new Float64Array([1 / 3, 2 / 3]),
        topology_available: new Int32Array([0]),
      },
      {
        schema: "hofstadter-interactive/1",
        view: "butterfly",
        parameters,
      },
    );

    const summary = restoreNpzBytes(
      archive,
      "hofstadter-custom-q3-butterfly.npz",
    );
    expect(summary).toMatchObject({ states: 3, gaps: 2 });
    expect(useAppStore.getState().parameters).toMatchObject({
      lattice: "custom",
      p: 1,
      q: 3,
      customBasis: [
        [0, 0],
        [0.5, 0.25],
      ],
    });
    expect(resultCache.getSnapshot().butterfly).toMatchObject({
      complete: true,
      chunks: [{ topologyAvailable: false }],
    });
  });
});
