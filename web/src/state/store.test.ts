import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultParameters,
  normalizeParameters,
  useAppStore,
} from "./store";

describe("scientific parameter invariants", () => {
  beforeEach(() => {
    useAppStore.setState({ parameters: { ...defaultParameters } });
  });

  it("keeps the flux numerator inside the selected denominator", () => {
    useAppStore.getState().setParameter("p", 30);
    useAppStore.getState().setParameter("q", 7);
    expect(useAppStore.getState().parameters).toMatchObject({ p: 6, q: 7 });
  });

  it("prevents a degenerate Bravais angle and invalid scalar bounds", () => {
    const normalized = normalizeParameters({
      ...defaultParameters,
      alpha: -4,
      period: 0,
      samples: 32,
      theta: [180, 0],
    });
    expect(normalized.alpha).toBe(0.1);
    expect(normalized.period).toBe(1);
    expect(normalized.samples).toBe(31);
    expect(normalized.theta).toEqual([1, 2]);
  });

  it("normalizes hydrated URL state before computation", () => {
    useAppStore.getState().hydrate({
      lattice: "bravais",
      p: 99,
      q: 3,
      theta: [90, 90],
    });
    expect(useAppStore.getState().parameters).toMatchObject({
      lattice: "bravais",
      p: 2,
      q: 3,
      theta: [89, 90],
    });
  });
});
