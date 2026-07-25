import {
  bandComputationKey,
  latticeComputationKey,
  sweepComputationKey,
} from "../compute/computeKeys";
import type {
  ScientificParameters,
  ViewKind,
} from "../compute/contracts";

function greatestCommonDivisor(first: number, second: number) {
  let a = Math.abs(Math.trunc(first));
  let b = Math.abs(Math.trunc(second));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function reducedFraction(numerator: number, denominator: number) {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

// Imported archives can hold fluxes whose denominator differs from the live
// q, so derive the display value from the point and always return it coprime.
export function fluxFraction(flux: number, preferredDenominator: number) {
  const preferred = Math.round(flux * preferredDenominator);
  if (Math.abs(flux - preferred / preferredDenominator) < 1e-9) {
    return reducedFraction(preferred, preferredDenominator);
  }
  let bestNumerator = Math.round(flux);
  let bestDenominator = 1;
  let bestError = Math.abs(flux - bestNumerator);
  for (let denominator = 2; denominator <= 199; denominator += 1) {
    const numerator = Math.round(flux * denominator);
    const error = Math.abs(flux - numerator / denominator);
    if (error < bestError - 1e-15) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
      if (error < 1e-12) break;
    }
  }
  return reducedFraction(bestNumerator, bestDenominator);
}

export interface ExportCacheState {
  butterfly?: { complete: boolean };
  butterflyKey?: string;
  butterflyStale: boolean;
  bands?: unknown;
  bandsKey?: string;
  bandsStale: boolean;
  lattice?: unknown;
  latticeKey?: string;
  latticeStale: boolean;
  geometry?: unknown;
  geometryKey?: string;
  geometryStale: boolean;
}

// Exported arrays must already match the live metadata.  Key comparison makes
// this synchronous with a parameter render, before the debounced scheduler has
// had a chance to mark the previous result stale.
export function exportsPending(
  view: ViewKind,
  parameters: ScientificParameters,
  cache: ExportCacheState,
  geometryRequested = false,
) {
  if (view === "butterfly" || view === "wannier") {
    return cache.butterflyKey !== sweepComputationKey(parameters)
      || cache.butterflyStale
      || !cache.butterfly?.complete;
  }
  if (view === "bands") {
    return cache.bandsKey !== bandComputationKey(parameters)
      || cache.bandsStale
      || (
        geometryRequested
        && (
          cache.geometryKey !== bandComputationKey(parameters)
          || cache.geometryStale
          || !cache.geometry
        )
      )
      || !cache.bands;
  }
  return cache.latticeKey !== latticeComputationKey(parameters)
    || cache.latticeStale
    || !cache.lattice;
}
