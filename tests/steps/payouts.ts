/**
 * Steps 7–10: Payout Verification
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { payoutTable, allConfigs, theoreticalRTP, isWtf } from '../../src/config';
import type { PlinkoConfigData } from '../../src/types';

/**
 * Exhaustive-enumeration RTP: iterate every one of the 2^rows equally likely
 * bit-paths, take its popcount as the slot, and average the payouts. Shares NO
 * arithmetic with `binomP`/`theoreticalRTP` — no binomial coefficient, no power,
 * no probability is ever formed, so a coefficient or normalisation error in the
 * closed form is inexpressible here. rows ≤ 16 ⇒ at most 65,536 paths per config.
 */
function enumeratedRTP(cfg: PlinkoConfigData, rows: number, riskLevel: number): number {
  const table = payoutTable(cfg, rows, riskLevel);
  const total = 1 << rows;
  let sum = 0;
  for (let p = 0; p < total; p++) {
    let bits = p, slot = 0;
    while (bits) { slot += bits & 1; bits >>>= 1; }
    sum += table[slot];
  }
  return sum / total;
}

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, cfg } = ctx;

  // ── Step 7: Multiplier lookup ─────────────────────────────────────────────────
  // Covers all configs including WTF (rows 13, risk 4).
  let multErrors = 0, multChecked = 0;
  for (const b of bets) {
    const table = payoutTable(cfg, b.numberOfRows, b.riskLevel);
    multChecked++;
    const expected = table[b.winningSlot];
    // Non-finite operands make `Math.abs(expected - b.multiplier) > tol` silently false
    // (NaN comparisons are false), so a `"not-a-number"` multiplier or an out-of-range
    // slot (table[slot] === undefined) would pass. Reject them explicitly.
    if (!Number.isFinite(expected) || !Number.isFinite(b.multiplier)
        || Math.abs(expected - b.multiplier) > 1e-9) multErrors++;
  }
  // DECLARED LIMITATION S00, stated where the reader meets the conformance claim. This step can
  // only check cells that were actually PAID. The capture landed on 285 of the 365 payout-table
  // cells; the other 80 — including both WTF 1000× tails — rest on our hand-transcription of the
  // operator's client bundle, hash-pinned as plinkoConfig.json, and carry 7.41% of summed
  // theoretical RTP (up to 29.0% on 15r/3). Nothing offline can distinguish a correct
  // transcription of a never-paid cell from a wrong one; the residual is executed every battery
  // run as declared survivor S00 in tests/mutations-extra.json, which mis-transcribes both 1000×
  // tails, regenerates the config pin, propagates it to every chapter — and still passes 20 of
  // the 21 scored steps. Exact per-cell coverage is emitted to outputs/coverage-results.json.
  const observedCells = new Set(bets.map(b => `${b.numberOfRows}:${b.riskLevel}:${b.winningSlot}`));
  const totalCells = allConfigs(cfg).reduce((a, c) => a + (isWtf(c.riskLevel) ? cfg.wtf_mode.odds.length : c.rows + 1), 0);
  const s7 = step(7, 'Multiplier Lookup',
    multErrors === 0 ? 'PASS' : 'FAIL',
    `${multChecked} bets checked (incl. WTF) at 1e-9 tolerance; multiplier == payoutTable[winningSlot] (both required finite); ${multErrors} mismatches. `
    + `SCOPE: this checks recorded multipliers for observed payout cells — ${observedCells.size}/${totalCells} payout-table cells were exercised by the capture; `
    + `the remaining ${totalCells - observedCells.size} (incl. both WTF 1000× tails) rest on the hash-pinned transcription in plinkoConfig.json, not on live data. `
    + `See outputs/coverage-results.json, AUDIT_CONTEXT.md#scope-and-coverage and residual case S00 in tests/mutations-extra.json`,
    {
      betsChecked: multChecked,
      mismatches: multErrors,
      cellsExercised: observedCells.size,
      cellsTotal: totalCells,
      cellsUnexercised: totalCells - observedCells.size,
    },
  );

  // ── Step 8: Payout math (betAmount × multiplier == winningAmount) ─────────────
  // Amounts are decimal STRINGS in the dataset — parseFloat for arithmetic.
  let payErrors = 0;
  for (const b of bets) {
    const bet = parseFloat(b.betAmount);
    const win = parseFloat(b.winningAmount);
    // parseFloat("not-a-number") === NaN, and NaN comparisons are false, so a malformed
    // betAmount/winningAmount/multiplier would slip through the tolerance test. Reject any
    // non-finite operand before comparing.
    if (!Number.isFinite(bet) || !Number.isFinite(win) || !Number.isFinite(b.multiplier)
        || Math.abs(bet * b.multiplier - win) > 1e-6) payErrors++;
  }
  const s8 = step(8, 'Payout Math (betAmount × multiplier == winningAmount)',
    payErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets checked at 1e-6 tolerance (betAmount, winningAmount, multiplier all required finite); ${payErrors} errors`,
  );

  // ── Step 9: Config completeness (27 standard + WTF) ───────────────────────────
  const combosPresent = new Set(bets.map(b => `${b.numberOfRows}:${b.riskLevel}`));
  const expectedStd: string[] = [];
  for (let r = 8; r <= 16; r++) for (let rl = 1; rl <= 3; rl++) expectedStd.push(`${r}:${rl}`);
  const missingStd = expectedStd.filter(k => !combosPresent.has(k));
  const wtfPresent = combosPresent.has(`${cfg.wtf_mode.rows}:${cfg.wtf_mode.riskLevel}`);
  const stdCount = expectedStd.filter(k => combosPresent.has(k)).length;
  const s9 = step(9, 'Config Completeness (27 standard + WTF)',
    missingStd.length === 0 && wtfPresent ? 'PASS' : 'FLAG',
    `${stdCount}/27 standard configs + ${wtfPresent ? 'WTF' : 'no WTF'} present`
      + (missingStd.length > 0 ? `; missing: ${missingStd.slice(0, 5).join(', ')}` : ''),
  );

  // ── Step 10: House edge / RTP audit (anti-circularity + enumeration anchor) ───
  // liqd's designed tables are NOT a flat 99%. Per-config theoretical RTP spans a
  // narrow band; the 1%-of-0.99 policy band is a claim about the OPERATOR's table
  // design and stays a FLAG condition. The MODEL itself is anchored in-step: every
  // config's binomial RTP (C(rows,k)·0.5^rows) is recomputed by EXHAUSTIVE PATH
  // ENUMERATION — all 2^rows equally likely bit-paths, popcount → slot — a method in
  // which a binomial-coefficient or normalisation error is inexpressible, because
  // nothing is ever weighted: paths are counted. Disagreement above 1e-12 is OUR
  // bug and hard-FAILs. (The 0.01 band alone was ~6× looser than the largest real
  // deviation and could not have caught a model error; the enumeration can.)
  // Emits argmin/argmax config LISTS (not a single row) so RTP ties are visible in
  // the artifact and the doc tables can be sourced from it rather than hand-derived.
  const configRTP = allConfigs(cfg).map(c => ({
    label: isWtf(c.riskLevel) ? 'WTF' : `rows ${c.rows} risk ${c.riskLevel}`,
    rtp: theoreticalRTP(cfg, c.rows, c.riskLevel),
    enum: enumeratedRTP(cfg, c.rows, c.riskLevel),
  }));
  const ENUM_TOL = 1e-12;
  const enumWorst = Math.max(...configRTP.map(r => Math.abs(r.rtp - r.enum)));
  const enumOk = enumWorst < ENUM_TOL;
  const minRTP = Math.min(...configRTP.map(r => r.rtp));
  const maxRTP = Math.max(...configRTP.map(r => r.rtp));
  const EPS = 1e-12;
  const argmin = configRTP.filter(r => Math.abs(r.rtp - minRTP) < EPS).map(r => r.label);
  const argmax = configRTP.filter(r => Math.abs(r.rtp - maxRTP) < EPS).map(r => r.label);
  const worstDev = Math.max(Math.abs(minRTP - 0.99), Math.abs(maxRTP - 0.99));
  const worstIsMax = Math.abs(maxRTP - 0.99) >= Math.abs(minRTP - 0.99);
  const worstConfigs = worstIsMax ? argmax : argmin;
  const s10 = step(10, 'House Edge / RTP Audit (analytical, per-config)',
    !enumOk ? 'FAIL' : worstDev < 0.01 ? 'PASS' : 'FLAG',
    `Analytical RTP = Σ C(rows,k)·0.5^rows·payout[k] over ${configRTP.length} configs, `
      + `each cross-checked by exhaustive 2^rows path enumeration (max |binomial − enumerated| `
      + `= ${enumWorst.toExponential(2)}, tol 1e-12${enumOk ? '' : ' — MODEL ERROR'}). `
      + `min ${(minRTP * 100).toFixed(5)}% [${argmin.join(', ')}]; `
      + `max ${(maxRTP * 100).toFixed(5)}% [${argmax.join(', ')}]; `
      + `per-config edge span ${((1 - maxRTP) * 100).toFixed(5)}%–${((1 - minRTP) * 100).toFixed(5)}%; `
      + `max deviation from 99% = ${(worstDev * 100).toFixed(4)}% (${worstConfigs.join(', ')}); ${worstDev < 0.01 ? 'all within 1% tolerance' : 'OUTSIDE the 1% tolerance'}`,
    {
      configs: configRTP.length,
      minRTP,
      maxRTP,
      argminConfigs: argmin,
      argmaxConfigs: argmax,
      minEdge: 1 - maxRTP,
      maxEdge: 1 - minRTP,
      maxDeviationFrom99: worstDev,
      worstDeviationConfigs: worstConfigs,
      enumerationWorstDelta: enumWorst,
      enumerationTolerance: ENUM_TOL,
    },
  );

  return [s7, s8, s9, s10];
}
