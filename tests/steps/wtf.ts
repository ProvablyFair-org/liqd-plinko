/**
 * Step 15: Phase E — WTF Mode Verification.
 *
 * WTF is a 4th risk level (riskLevel 4, numberOfRows fixed at 13). Phase E of the
 * dataset is 2,000 WTF bets. This step:
 *   - asserts every Phase E bet is riskLevel 4 / numberOfRows 13,
 *   - recomputes each bet's dropDetails via the commit-reveal RNG,
 *   - confirms each multiplier == cfg.wtf_mode.odds[winningSlot],
 *   - reports the WTF theoretical RTP (independent binomial × odds).
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { theoreticalRTP, payoutTable, binomP } from '../../src/config';

export function run(ctx: VerifyContext): StepResult[] {
  const { phaseE, seedMap, cfg } = ctx;

  if (phaseE.length === 0) {
    return [step(15, 'Phase E — WTF Mode Verification', 'FAIL',
      'No Phase E (WTF) bets found in dataset')];
  }

  const wtfOdds = cfg.wtf_mode.odds;
  const wtfRTP = theoreticalRTP(cfg, cfg.wtf_mode.rows, cfg.wtf_mode.riskLevel);
  // Structural risk profile of the WTF table, from the independent binomial:
  // probability of landing a zero-paying slot vs any paying slot.
  let pPaying = 0;
  for (let k = 0; k <= cfg.wtf_mode.rows; k++) {
    if (wtfOdds[k] > 0) pPaying += binomP(cfg.wtf_mode.rows, k);
  }
  const pZero = 1 - pPaying;

  const failures: string[] = [];
  let recomputeChecked = 0, recomputeFails = 0;
  let multChecked = 0, multFails = 0;

  for (const b of phaseE) {
    if (b.riskLevel !== 4) failures.push(`bet ${b.id}: riskLevel ${b.riskLevel} (expected 4)`);
    if (b.numberOfRows !== 13) failures.push(`bet ${b.id}: numberOfRows ${b.numberOfRows} (expected 13)`);

    const ss = seedMap.get(b.hashedServerSeed);
    if (ss) {
      const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
      recomputeChecked++;
      if (path !== b.dropDetails || winningSlot !== b.winningSlot) {
        recomputeFails++;
        if (failures.length < 5) failures.push(`bet ${b.id}: dropDetails/slot recompute mismatch`);
      }
    }

    // multiplier == wtf odds table entry
    const expected = payoutTable(cfg, b.numberOfRows, b.riskLevel)[b.winningSlot];
    multChecked++;
    if (Math.abs(expected - b.multiplier) > 1e-9) {
      multFails++;
      if (failures.length < 5) failures.push(`bet ${b.id}: multiplier ${b.multiplier} != odds[${b.winningSlot}]=${expected}`);
    }
  }

  const pass = failures.length === 0 && recomputeFails === 0 && multFails === 0
    && recomputeChecked === phaseE.length && multChecked === phaseE.length;
  const s15 = step(15, 'Phase E — WTF Mode Verification',
    pass ? 'PASS' : 'FAIL',
    pass
      ? `${phaseE.length} WTF bets: all riskLevel 4 / 13 rows; ${recomputeChecked}/${phaseE.length} dropDetails recomputed (expected ${phaseE.length}); ${multChecked}/${phaseE.length} multipliers == odds[slot] (odds=[${wtfOdds.join(',')}]); WTF theoretical RTP = ${(wtfRTP * 100).toFixed(4)}%; only ${wtfOdds.filter(o => o > 0).length}/${wtfOdds.length} slots pay — P(zero payout) = ${(pZero * 100).toFixed(4)}%, P(paying slot) = ${(pPaying * 100).toFixed(4)}%`
      : `${failures.length} issue(s) [recomputed ${recomputeChecked}/${phaseE.length}, mult ${multChecked}/${phaseE.length}]: ${failures.slice(0, 3).join('; ')}`,
    {
      wtfBets: phaseE.length,
      recomputed: recomputeChecked,
      multipliersChecked: multChecked,
      wtfTheoreticalRTP: wtfRTP,
      payingSlots: wtfOdds.filter(o => o > 0).length,
      totalSlots: wtfOdds.length,
      pZeroPayout: pZero,
      pPayingSlot: pPaying,
    },
  );

  return [s15];
}
