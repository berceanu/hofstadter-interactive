import { describe, expect, it } from "vitest";
import { extractContourSegments } from "./contours";

describe("extractContourSegments", () => {
  it("interpolates evenly spaced levels through a planar field", () => {
    const values = new Float64Array([
      0, 0,
      1, 1,
    ]);
    const segments = extractContourSegments(values, values, 2, 3);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.normalizedLevel)).toEqual([
      0.25,
      0.5,
      0.75,
    ]);
    for (const segment of segments) {
      expect(segment.start.x).toBeCloseTo(segment.normalizedLevel);
      expect(segment.end.x).toBeCloseTo(segment.normalizedLevel);
      expect(segment.start.height).toBeCloseTo(segment.normalizedLevel);
      expect(segment.end.height).toBeCloseTo(segment.normalizedLevel);
    }
  });

  it("resolves a saddle cell into two non-crossing segments", () => {
    const values = new Float64Array([
      1, 0,
      0, 1,
    ]);
    const heights = new Float64Array([0.2, 0.4, 0.6, 0.8]);
    const segments = extractContourSegments(values, heights, 2, 1);

    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment.start.x).toBeGreaterThanOrEqual(0);
      expect(segment.start.x).toBeLessThanOrEqual(1);
      expect(segment.start.y).toBeGreaterThanOrEqual(0);
      expect(segment.start.y).toBeLessThanOrEqual(1);
    }
  });

  it("omits contours for a constant field", () => {
    const values = new Float64Array(9).fill(2);
    expect(extractContourSegments(values, values, 3)).toEqual([]);
  });
});
