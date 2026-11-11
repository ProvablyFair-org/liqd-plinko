/**
 * Steps 7–10: Payout Verification
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { payoutTable, allConfigs, theoreticalRTP, isWtf, binomP, slotCount } from '../../src/config';
import type { PlinkoConfigData } from '../../src/types';
import { unitsOf, asMoney } from '../../src/money';
import { MIN_PHASE_A_BETS_PER_CONFIG } from '../../src/loader';

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
  const { bets, cfg, phaseA } = ctx;

  // ── Step 7: Multiplier lookup ─────────────────────────────────────────────────
  // Covers every bet, on all 28 configurations (the 27 standard and WTF, rows 13 / risk 4).
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
  // only check cells that were actually PAID. The cells no captured drop landed on have no payout
  // witness: they rest on the pinned plinkoConfig.json, whose every cell is held to what the
  // production game page displayed (Step 20, src/page-labels.ts) — a display, not a payment. The
  // counts and their share of theoretical RTP are emitted (data below, Step 9 and
  // outputs/coverage-results.json), never typed here. Nothing offline can distinguish a correct
  // value in a never-paid cell from a wrong one that keeps every board within the published-RTP
  // band and is also wrong on the saved page read; the residual is executed every battery run as
  // declared survivor S00 in tests/mutations-extra.json. See S00's guard for the steps that reject it.
  const observedCells = new Set(bets.map(b => `${b.numberOfRows}:${b.riskLevel}:${b.winningSlot}`));
  const totalCells = allConfigs(cfg).reduce((a, c) => a + (isWtf(c.riskLevel) ? cfg.wtf_mode.odds.length : c.rows + 1), 0);
  const s7 = step(7, 'Multiplier Lookup',
    multErrors === 0 ? 'PASS' : 'FAIL',
    `${multChecked} bets checked (incl. WTF) at 1e-9 tolerance; multiplier == payoutTable[winningSlot] (both required finite); ${multErrors} mismatches. `
    + `SCOPE (declared limitation S00): this compares PAID multipliers only — ${observedCells.size}/${totalCells} payout-table cells were exercised by the capture; `
    + `the remaining ${totalCells - observedCells.size} have no payout witness and rest on the pinned plinkoConfig.json, each cell of which equals what the production game page displayed (Step 20). `
    + `See outputs/coverage-results.json, MANIFEST 'Declared limitations' and declared survivor S00 in tests/mutations-extra.json`,
    {
      betsChecked: multChecked,
      mismatches: multErrors,
      cellsExercised: observedCells.size,
      cellsTotal: totalCells,
      cellsUnexercised: totalCells - observedCells.size,
    },
  );

  // ── Step 8: Payout math (betAmount × multiplier == winningAmount) ─────────────
  // EXACT, in integer 1e-8 settlement units — not a tolerance on money. betAmount and
  // winningAmount are 8-dp strings, so the grid is exact and the comparison is integer
  // equality; the only tolerance is inside unitsOf(), snapping a JSON double back onto
  // the grid. Framework floor: exact, or <= 1e-8.
  //
  // Measured over this dataset: 0 off-grid amounts and 0 units of
  // deviation — exactness is what the data supports, not an aspiration.
  let payErrors = 0, offGrid = 0, worstUnits = 0, worstExample = '';
  for (const b of bets) {
    const betU = unitsOf(b.betAmount);
    const winU = unitsOf(b.winningAmount);
    if (betU === null || winU === null || !Number.isFinite(b.multiplier)) { offGrid++; payErrors++; continue; }
    // The multiplier is a genuine quotient, so the product is rounded onto the grid the
    // operator settles on; any residual after that is a money difference, not noise.
    const expectedU = Math.round(betU * b.multiplier);
    const deltaU = Math.abs(expectedU - winU);
    if (deltaU !== 0) {
      payErrors++;
      if (deltaU > worstUnits) {
        worstUnits = deltaU;
        worstExample = ` worst: nonce ${b.nonce} ${asMoney(betU)} x ${b.multiplier} -> served ${asMoney(winU)}, expected ${asMoney(expectedU)} (${deltaU} unit(s))`;
      }
    }
  }
  const s8 = step(8, 'Payout Math (betAmount × multiplier == winningAmount)',
    payErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets reconciled EXACTLY in integer 1e-8 units — no tolerance on money; ` +
    `${offGrid} amount(s) off the grid, ${payErrors} error(s)${worstExample}`,
  );

  // ── Step 9: Config completeness, Phase-A floor & never-paid cell coverage ─────
  // PLINKO-15. Three things, all scored HERE so the coverage the report cites is a scored
  // artifact rather than the unscored coverage block alone:
  //   (a) every published config appears at all (presence): the 27 standard and WTF;
  //   (b) every one of the 28 carries at least the Phase-A floor of bets
  //       (MIN_PHASE_A_BETS_PER_CONFIG in src/loader.ts — the declared floor, not a count
  //       read from the dataset). WTF's Phase A drops are plan id A+W; its own Phase E is
  //       checked by Step 15;
  //   (c) the never-paid payout-table cells are enumerated with their share of theoretical
  //       RTP (a coverage artifact), so the reader knows what the live sample did and did not
  //       exercise. This is the same computation the unscored coverage block emits, moved
  //       into the scored step so the assertion is scored.
  const combosPresent = new Set(bets.map(b => `${b.numberOfRows}:${b.riskLevel}`));
  const expectedStd: string[] = [];
  for (let r = 8; r <= 16; r++) for (let rl = 1; rl <= 3; rl++) expectedStd.push(`${r}:${rl}`);
  const missingStd = expectedStd.filter(k => !combosPresent.has(k));
  const wtfPresent = combosPresent.has(`${cfg.wtf_mode.rows}:${cfg.wtf_mode.riskLevel}`);
  const stdCount = expectedStd.filter(k => combosPresent.has(k)).length;

  // (b) Phase-A bets per standard config, against the declared floor.
  const phaseAByConfig = new Map<string, number>();
  for (const b of phaseA) {
    const k = `${b.numberOfRows}:${b.riskLevel}`;
    phaseAByConfig.set(k, (phaseAByConfig.get(k) ?? 0) + 1);
  }
  const phaseACounts = expectedStd.map(k => phaseAByConfig.get(k) ?? 0);
  const belowFloor = expectedStd
    .map((k, i) => ({ config: k, bets: phaseACounts[i] }))
    .filter(c => c.bets < MIN_PHASE_A_BETS_PER_CONFIG);
  const minPhaseA = phaseACounts.length ? Math.min(...phaseACounts) : 0;
  const maxPhaseA = phaseACounts.length ? Math.max(...phaseACounts) : 0;
  const wtfPhaseA = phaseAByConfig.get(`${cfg.wtf_mode.rows}:${cfg.wtf_mode.riskLevel}`) ?? 0;
  const wtfFloorOk = wtfPhaseA >= MIN_PHASE_A_BETS_PER_CONFIG;

  // (c) Never-paid cells and their share of theoretical RTP, per config and summed.
  const observedSlots = new Map<string, Set<number>>();
  for (const b of bets) {
    const k = `${b.numberOfRows}:${b.riskLevel}`;
    let s = observedSlots.get(k);
    if (!s) { s = new Set<number>(); observedSlots.set(k, s); }
    s.add(b.winningSlot);
  }
  let totalCoverageCells = 0, neverPaidCount = 0, neverPaidRtp = 0, theoreticalRtpSum = 0;
  // Share of theoretical RTP each never-paid cell carries within its own config, keyed
  // "rows:risk:slot" — the enumeration, inside the scored step's own emitted data.
  const neverPaidCellRtpShare: Record<string, number> = {};
  for (const c of allConfigs(cfg)) {
    const k = `${c.rows}:${c.riskLevel}`;
    const table = payoutTable(cfg, c.rows, c.riskLevel);
    const configRtp = theoreticalRTP(cfg, c.rows, c.riskLevel);
    theoreticalRtpSum += configRtp;
    const seen = observedSlots.get(k) ?? new Set<number>();
    const slots = slotCount(c.rows);
    for (let s = 0; s < slots; s++) {
      totalCoverageCells++;
      if (!seen.has(s)) {
        neverPaidCount++;
        const contrib = binomP(c.rows, s) * table[s];
        neverPaidRtp += contrib;
        neverPaidCellRtpShare[`${k}:${s}`] = configRtp > 0 ? contrib / configRtp : 0;
      }
    }
  }
  const neverPaidRtpShareSummed = theoreticalRtpSum > 0 ? neverPaidRtp / theoreticalRtpSum : 0;

  const floorOk = missingStd.length === 0 && wtfPresent && belowFloor.length === 0 && wtfFloorOk;
  const s9 = step(9, 'Config Completeness (27 standard + WTF)',
    floorOk ? 'PASS' : 'FLAG',
    `${stdCount}/27 standard configs + ${wtfPresent ? 'WTF' : 'no WTF'} present`
      + `; Phase A per config ≥ ${MIN_PHASE_A_BETS_PER_CONFIG}-bet floor (src/loader.ts MIN_PHASE_A_BETS_PER_CONFIG): `
      + `${expectedStd.length - belowFloor.length}/27 standard configs meet it (observed ${minPhaseA}–${maxPhaseA} bets/config) and WTF ${wtfFloorOk ? 'meets' : 'DOES NOT meet'} it (${wtfPhaseA} Phase A bets)`
      + (belowFloor.length > 0 ? `; BELOW FLOOR: ${belowFloor.slice(0, 5).map(c => `${c.config}=${c.bets}`).join(', ')}` : '')
      + (missingStd.length > 0 ? `; missing config: ${missingStd.slice(0, 5).join(', ')}` : '')
      + `; never-paid cells ${neverPaidCount}/${totalCoverageCells} carrying ${(neverPaidRtpShareSummed * 100).toFixed(2)}% of summed theoretical RTP `
      + `(coverage artifact — the unexercised cells have no payout witness and rest on the pinned plinkoConfig.json; per-cell RTP shares in data.neverPaidCellRtpShare)`,
    {
      standardConfigsPresent: stdCount,
      wtfPresent,
      phaseAFloor: MIN_PHASE_A_BETS_PER_CONFIG,
      phaseAMinPerConfig: minPhaseA,
      phaseAMaxPerConfig: maxPhaseA,
      phaseAWtfBets: wtfPhaseA,
      configsBelowFloor: belowFloor.length,
      neverPaidCells: neverPaidCount,
      coverageCellsTotal: totalCoverageCells,
      neverPaidRtpShareSummed,
      neverPaidCellRtpShare,
    },
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
      // The bound, not the measurement: the worst gap is a summation residual at the float-noise
      // floor, so printing it here would put a machine-dependent number in a string leaf the
      // reproduction diff's numeric tolerance cannot reach. It is `data.enumerationWorstDelta`.
      + `each cross-checked by exhaustive 2^rows path enumeration (max |binomial − enumerated| `
      + `within tol ${ENUM_TOL.toExponential(0)}${enumOk ? '' : ' — MODEL ERROR'}, measured in data.enumerationWorstDelta). `
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
