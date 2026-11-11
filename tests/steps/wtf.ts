/**
 * Step 15: Phase E — WTF Mode Verification.
 *
 * WTF is a 4th risk level (riskLevel 4, numberOfRows fixed at 13). Production offers it and it was
 * captured there: Phase E is 2,000 WTF bets, and Phase A holds 50 more (plan id A+W). This step:
 *   - asserts Phase E has the planned number of bets and every one is riskLevel 4 / numberOfRows 13,
 *   - asserts every riskLevel-4 bet anywhere in the dataset is on 13 rows and belongs to Phase E or to
 *     plan id A+W (so no WTF drop sits outside the two places the plan put them),
 *   - recomputes each WTF bet's dropDetails via the commit-reveal RNG,
 *   - confirms each multiplier == cfg.wtf_mode.odds[winningSlot],
 *   - reports the WTF theoretical RTP (independent binomial × odds) and which slots the drops reached.
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { theoreticalRTP, payoutTable, binomP } from '../../src/config';
import { EXPECTED_PLAN } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { phaseE, seedMap, cfg, bets } = ctx;
  const planE = EXPECTED_PLAN.filter(e => e.phase === 'E').reduce((a, e) => a + e.bets, 0);
  const planTopUp = EXPECTED_PLAN.filter(e => e.id === 'A+W').reduce((a, e) => a + e.bets, 0);

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

  // Every WTF drop of the dataset: Phase E plus the Phase A top-up (plan id A+W).
  const allWtf = bets.filter(b => b.riskLevel === cfg.wtf_mode.riskLevel);
  const topUp = allWtf.filter(b => b.phaseId === 'A+W');
  const misplaced = allWtf.filter(b => b.phase !== 'E' && b.phaseId !== 'A+W');
  if (misplaced.length) failures.push(`${misplaced.length} WTF bet(s) outside Phase E and plan id A+W (e.g. ${misplaced[0].id})`);
  if (phaseE.length !== planE) failures.push(`Phase E holds ${phaseE.length} bets, ${planE} planned`);
  if (topUp.length !== planTopUp) failures.push(`plan id A+W holds ${topUp.length} WTF bets, ${planTopUp} planned`);
  for (const b of phaseE) {
    if (b.riskLevel !== 4) failures.push(`bet ${b.id}: riskLevel ${b.riskLevel} (expected 4)`);
  }
  const slotsReached = new Set<number>();
  let payingDrops = 0;
  for (const b of allWtf) {
    if (b.numberOfRows !== 13) failures.push(`bet ${b.id}: numberOfRows ${b.numberOfRows} (expected 13)`);
    slotsReached.add(b.winningSlot);
    if (b.multiplier > 0) payingDrops++;

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
    && recomputeChecked === allWtf.length && multChecked === allWtf.length;
  const reached = [...slotsReached].sort((a, b) => a - b);
  const s15 = step(15, 'Phase E — WTF Mode Verification',
    pass ? 'PASS' : 'FAIL',
    pass
      ? `Phase E: ${phaseE.length}/${planE} WTF bets, all riskLevel 4 / 13 rows; with the ${topUp.length} WTF drops of Phase A (plan id A+W) ${allWtf.length} WTF drops in all, none elsewhere; ${recomputeChecked}/${allWtf.length} dropDetails recomputed; ${multChecked}/${allWtf.length} multipliers == odds[slot] (odds=[${wtfOdds.join(',')}]); slots reached ${reached.join(',')} of 0–${wtfOdds.length - 1}; ${payingDrops} drop(s) paid; WTF theoretical RTP = ${(wtfRTP * 100).toFixed(4)}%; only ${wtfOdds.filter(o => o > 0).length}/${wtfOdds.length} slots pay — P(zero payout) = ${(pZero * 100).toFixed(4)}%, P(paying slot) = ${(pPaying * 100).toFixed(4)}%`
      : `${failures.length} issue(s) [recomputed ${recomputeChecked}/${allWtf.length}, mult ${multChecked}/${allWtf.length}]: ${failures.slice(0, 3).join('; ')}`,
    {
      wtfBets: phaseE.length,
      wtfBetsAll: allWtf.length,
      wtfBetsPhaseATopUp: topUp.length,
      wtfSlotsReached: reached,
      wtfPayingDrops: payingDrops,
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
