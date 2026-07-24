import type { ButterflyResult } from "../compute/contracts";

export interface ButterflyArrays {
  flux: Float64Array;
  energy: Float64Array;
  band: Int32Array;
  chern: Int32Array;
  dos: Float64Array;
  gap: Float64Array;
  gapChern: Int32Array;
  gapFlux: Float64Array;
  gapEnergy: Float64Array;
}

function concatenate<T extends Float64Array | Int32Array>(
  values: T[],
  Constructor: {
    new (length: number): T;
  },
) {
  const total = values.reduce((sum, value) => sum + value.length, 0);
  const output = new Constructor(total);
  let offset = 0;
  values.forEach((value) => {
    output.set(value, offset);
    offset += value.length;
  });
  return output;
}

export function flattenButterfly(result?: ButterflyResult): ButterflyArrays {
  const chunks = result?.chunks ?? [];
  return {
    flux: concatenate(
      chunks.map((chunk) => chunk.flux),
      Float64Array,
    ),
    energy: concatenate(
      chunks.map((chunk) => chunk.energy),
      Float64Array,
    ),
    band: concatenate(
      chunks.map((chunk) => chunk.band),
      Int32Array,
    ),
    chern: concatenate(
      chunks.map((chunk) => chunk.chern),
      Int32Array,
    ),
    dos: concatenate(
      chunks.map((chunk) => chunk.dos),
      Float64Array,
    ),
    gap: concatenate(
      chunks.map((chunk) => chunk.gap),
      Float64Array,
    ),
    gapChern: concatenate(
      chunks.map((chunk) => chunk.gapChern),
      Int32Array,
    ),
    gapFlux: concatenate(
      chunks.map((chunk) => chunk.gapFlux),
      Float64Array,
    ),
    gapEnergy: concatenate(
      chunks.map((chunk) => chunk.gapEnergy),
      Float64Array,
    ),
  };
}

export function extent(
  values: ArrayLike<number>,
  fallback: [number, number],
): [number, number] {
  if (!values.length) return fallback;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    min = Math.min(min, values[index]);
    max = Math.max(max, values[index]);
  }
  return min === max ? [min - 1, max + 1] : [min, max];
}
