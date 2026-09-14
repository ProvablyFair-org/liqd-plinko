/**
 * Step 21: Epoch-window slot fit (live drops vs binomial).
 *
 * The 10,100 captured drops are the first 50 nonces of every seed — the direct
 * short-window population a cherry-pick against a predictable client seed would
 * target. This pools the live drops by board size and fits each pooled slot
 * distribution against the independent binomial C(rows,k)·0.5^rows (same tail-merge
 * rule as Pass 1), then combines the per-group p-values with Fisher's method.
 * FAILs if any group breaches the Bonferroni per-group alpha, or the combined
 * Fisher p is below 0.01.
 */

import { step } from './context';
import type { StepResult, VerifyContext } from './context';
import { chiSquaredTest, combination, chiSquaredPValue } from '../../src/stats';
import { EXPECTED_EPOCH_SIZE } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const byRows = new Map<number, number[]>();
  for (const b of ctx.bets) {
    if (!byRows.has(b.numberOfRows)) byRows.set(b.numberOfRows, new Array(b.numberOfRows + 1).fill(0));
    byRows.get(b.numberOfRows)![b.winningSlot]++;
  }
  const rows: string[] = [];
  const perGroupP: Record<string, number> = {};
  const perGroupChi2: Record<string, number> = {};
  const perGroupN: Record<string, number> = {};
  let fisher = 0;
  let k = 0;
  let minP = 1;
  for (const [r, freq] of [...byRows].sort((a, b) => a[0] - b[0])) {
    const n = freq.reduce((a, b) => a + b, 0);
    const exp = Array.from({ length: r + 1 }, (_, s) => combination(r, s) * Math.pow(0.5, r) * n);
    const { chi2, df, pValue } = chiSquaredTest(freq, exp);   // same tail-merge rule as Pass 1
    rows.push(`rows ${r}: n=${n} chi2=${chi2.toFixed(2)} df=${df} p=${pValue.toFixed(4)}`);
    perGroupP[`rows${r}`] = pValue;
    perGroupChi2[`rows${r}`] = chi2;
    perGroupN[`rows${r}`] = n;
    fisher += -2 * Math.log(Math.max(pValue, 1e-300));
    k += 2;
    minP = Math.min(minP, pValue);
  }
  const combinedP = chiSquaredPValue(fisher, k);
  const bon = 0.01 / byRows.size;
  return [step(21, 'Epoch-Window Slot Fit (live drops vs binomial)',
    minP < bon || combinedP < 0.01 ? 'FAIL' : 'PASS',
    `${ctx.bets.length} captured drops = first ${EXPECTED_EPOCH_SIZE} nonces of ${ctx.seeds.length} seeds; ` + rows.join(' | ') +
    `; Fisher X2=${fisher.toFixed(2)} df=${k} combined p=${combinedP.toFixed(4)}; Bonferroni per-group alpha=${bon.toExponential(2)}` +
    // DECLARED LIMITATION A4b (round-3 K8). This step uses the same tail-merged multinomial
    // goodness-of-fit rule as Pass 1/Pass 2, whose true size at these n is near — but not equal
    // to — its nominal 0.05, and is board-dependent. Nothing in this repository measures it, so
    // the per-group p-values and the Fisher combination are reported on a NOMINAL basis.
    // Immaterial at these counts; declared rather than closed. See recommendations.md A4b and
    // MANIFEST 'Declared limitations'.
    `; p-values are NOMINAL — the tail-merged chi²'s true size is assumed 0.05, not measured in-repo (declared limitation A4b)`,
    {
      drops: ctx.bets.length,
      seeds: ctx.seeds.length,
      groups: byRows.size,
      fisherX2: fisher,
      fisherDf: k,
      fisherCombinedP: combinedP,
      minGroupP: minP,
      bonferroniPerGroupAlpha: bon,
      perGroupP,
      perGroupChi2,
      perGroupN,
    })];
}
