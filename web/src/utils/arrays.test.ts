import { describe, expect, it } from "vitest";
import { extent } from "./arrays";

describe("extent", () => {
  it("returns the finite range", () => {
    expect(extent([3, -1, 2], [0, 1])).toEqual([-1, 3]);
  });

  it("pads a degenerate range", () => {
    expect(extent([2, 2, 2], [0, 1])).toEqual([1, 3]);
  });

  it("ignores non-finite values instead of poisoning the domain", () => {
    expect(extent([Number.NaN, 1, 5, Number.POSITIVE_INFINITY], [0, 1]))
      .toEqual([1, 5]);
  });

  it("falls back when nothing is finite", () => {
    expect(extent([], [0, 1])).toEqual([0, 1]);
    expect(extent([Number.NaN, Number.NEGATIVE_INFINITY], [0, 1]))
      .toEqual([0, 1]);
  });
});
