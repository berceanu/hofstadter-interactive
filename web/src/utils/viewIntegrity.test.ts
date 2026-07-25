import { describe, expect, it } from "vitest";
import { fluxFraction } from "./viewIntegrity";

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
});
