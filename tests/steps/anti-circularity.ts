/**
 * Step 13: Anti-circularity — the binomial slot probabilities the RTP path actually
 * uses are derived from first principles, never from any casino-supplied table.
 *
 * The RTP path (theoreticalRTP, WTF P(zero)) is built on `binomP` from src/config.ts.
 * This step audits THAT function — not a second, unused implementation — by comparing
 * it against an independent integer Pascal's-triangle recurrence (no division, no
 * floats): for rows 8–16, binomP(n,k)·2^n must equal the exact integer C(n,k), and
 * Σ_k binomP(n,k) must equal 1. Under the declared binomP mutation (tests/mutations.json)
 * the coefficients no longer match the recurrence and this step FAILs.
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { binomP } from '../../src/config';

export function run(_ctx: VerifyContext): StepResult[] {
  // Pascal's triangle in integers, no division, no floats — the independent reference.
  let rowInts: number[] = [1];
  let maxErr = 0;
  let sumDev = 0;
  let worstRows = 8;
  for (let n = 1; n <= 16; n++) {
    const next = new Array(n + 1).fill(0);
    for (let k = 0; k <= n; k++) next[k] = (rowInts[k - 1] ?? 0) + (rowInts[k] ?? 0);
    rowInts = next;
    if (n < 8) continue;
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      const p = binomP(n, k);
      sum += p;
      // binomP(n,k)·2^n is exactly C(n,k) in float64 for n ≤ 16 (dyadic).
      const err = Math.abs(p * Math.pow(2, n) - rowInts[k]);
      if (err > maxErr) { maxErr = err; worstRows = n; }
    }
    sumDev = Math.max(sumDev, Math.abs(sum - 1));
  }
  // The two residuals are BOUNDS in the sentence and NUMBERS in `data`. Both sit at the
  // float-noise floor, so interpolating them into the detail would put a machine-dependent
  // value in a string leaf, where the reproduction diff's numeric tolerance cannot reach it
  // and an identical result on another machine is reported as a disagreement.
  const SUM_TOL = 1e-12;
  const s13 = step(13, 'Anti-Circularity (Binomial Slot Probabilities)',
    maxErr === 0 && sumDev < SUM_TOL ? 'PASS' : 'FAIL',
    `rows 8–16: binomP(n,k)·2^n == exact integer C(n,k) from an independent Pascal recurrence, and Σ_k binomP(n,k) = 1.0. ` +
    `|binomP·2^n − C(n,k)| required to be exactly 0 on every coefficient: ${maxErr === 0 ? 'holds' : `FAILS (worst at rows=${worstRows})`}; ` +
    `|Σ−1| required within tol ${SUM_TOL.toExponential(0)} on every row: ${sumDev < SUM_TOL ? 'holds' : 'FAILS'} ` +
    `(measured residuals in data.maxAbsCoefficientError / data.maxAbsSumMinusOne). ` +
    `Audits the same binomP used by theoreticalRTP; no operator data used.`,
    {
      rowsAudited: 9,
      maxAbsCoefficientError: maxErr,
      worstRows,
      maxAbsSumMinusOne: sumDev,
      sumTolerance: SUM_TOL,
    },
  );
  return [s13];
}
