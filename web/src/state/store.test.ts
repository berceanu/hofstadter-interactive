import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultParameters,
  normalizeParameters,
  useAppStore,
} from "./store";

describe("scientific parameter invariants", () => {
  beforeEach(() => {
    useAppStore.setState({
      parameters: { ...defaultParameters },
      bandCutZoom: 1,
      selectedMomentum: { source: "path", fraction: 0 },
      computeCounters: {
        sweeps: 0,
        bands: 0,
        lattice: 0,
        geometry: 0,
        topology: 0,
        dispersion: 0,
      },
    });
  });

  it("keeps the flux numerator inside the selected denominator", () => {
    useAppStore.getState().setParameter("p", 30);
    useAppStore.getState().setParameter("q", 7);
    expect(useAppStore.getState().parameters).toMatchObject({ p: 6, q: 7 });
  });

  it("applies a replacement flux pair atomically", () => {
    useAppStore.setState({
      parameters: { ...defaultParameters, p: 1, q: 12 },
    });
    useAppStore.getState().setFlux(6, 11);
    expect(useAppStore.getState().parameters).toMatchObject({ p: 6, q: 11 });
  });

  it("forces canonical geometry and bounds invalid scalar values", () => {
    const normalized = normalizeParameters({
      ...defaultParameters,
      alpha: -4,
      samples: 32,
      theta: [180, 0],
    });
    expect(normalized.alpha).toBe(0.1);
    expect(normalized.samples).toBe(17);
    expect(normalized.theta).toEqual([1, 2]);
  });

  it("forces each lattice to its canonical magnetic period", () => {
    expect(
      normalizeParameters({
        ...defaultParameters,
        lattice: "square",
        period: 8,
      }).period,
    ).toBe(1);
    expect(
      normalizeParameters({
        ...defaultParameters,
        lattice: "kagome",
        period: 1,
      }).period,
    ).toBe(8);
  });

  it("forces named lattices to their canonical angle", () => {
    const honeycomb = normalizeParameters({
      ...defaultParameters,
      lattice: "honeycomb",
      theta: [1, 2],
    });
    expect(honeycomb.theta).toEqual([1, 3]);
  });

  it("always reduces the displayed magnetic flux", () => {
    const normalized = normalizeParameters({
      ...defaultParameters,
      p: 2,
      q: 4,
    });
    expect(normalized).toMatchObject({ p: 1, q: 2 });
  });

  it("defaults and bounds the upstream band-gap threshold", () => {
    expect(
      normalizeParameters({ ...defaultParameters, bgt: Number.NaN }).bgt,
    ).toBe(0.01);
    expect(normalizeParameters({ ...defaultParameters, bgt: -1 }).bgt).toBe(0);
  });

  it("bounds hopping amplitudes before they reach the eigensolver", () => {
    const normalized = normalizeParameters({
      ...defaultParameters,
      hoppings: [1e308, -1e308, Number.NaN],
    });
    expect(normalized.hoppings).toEqual([1_000_000, -1_000_000]);
  });

  it("chooses the preview grid from the Hamiltonian size", () => {
    expect(
      normalizeParameters({ ...defaultParameters, p: 1, q: 5 }).samples,
    ).toBe(21);
    expect(
      normalizeParameters({ ...defaultParameters, p: 1, q: 31 }).samples,
    ).toBe(17);
    expect(
      normalizeParameters({
        ...defaultParameters,
        lattice: "honeycomb",
        p: 1,
        q: 31,
      }).samples,
    ).toBe(13);
    expect(
      normalizeParameters({ ...defaultParameters, p: 1, q: 199 }).samples,
    ).toBe(7);
  });

  it("tracks linked-cut zoom as UI detail rather than a scientific parameter", () => {
    useAppStore.getState().setBandCutZoom(12);
    expect(useAppStore.getState().bandCutZoom).toBe(12);
    expect(useAppStore.getState().parameters.samples).toBe(
      defaultParameters.samples,
    );
    expect(useAppStore.getState().computeCounters.dispersion).toBe(0);
    expect(useAppStore.getState().computeCounters.topology).toBe(0);
  });

});
