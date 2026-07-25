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
