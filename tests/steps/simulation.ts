/**
 * Steps 16–17: Simulation Results (reads outputs/simulation-results.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { inverseCriticalZ, chiSquaredTest, combination, normalCDF, binomialSurvival } from '../../src/stats';
import { generateProvablyFairNumber } from '../../src/rng';
import { payoutTable, allConfigs, CONVERGENCE_STEP, PASS2_NONCES_PUBLISHED } from '../../src/config';
import {
  Z_LEFT_TAIL,
  CALIBRATION_METHOD,
  payoutMuSd,
  calibrateLeftTailCount,
  calibratedSurvival,
  revealedEpochConfigs,
} from '../../src/calibration';
import { PLINKO_CONFIG_SHA256 } from '../../src/config';
import { domainRules, validateDomains, describeDomainFailures, boardMultiplierRange } from '../../src/domains';

// ── Pass 2 recompute helpers (mirror src/simulate.ts exactly) ──────────────────
// Deterministic given (serverSeed, clientSeed, rows, nonce) — no randomness.
function simSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  let slot = 0;
  for (let i = 0; i < rows; i++) slot += generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
  return slot;
}
function binomExpected(rows: number, n: number): number[] {
  const p = Math.pow(0.5, rows);
  return Array.from({ length: rows + 1 }, (_, k) => combination(rows, k) * p * n);
}

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir, seeds, bets, cfg } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');
  const calPath = path.join(outputsDir, 'calibration-results.json');
  // Exact per-config payout mean/SD — imported from src/calibration.ts, the single
  // module the producer also reads (audit-rules 9.4). It is NOT redefined here.

  if (!fs.existsSync(simPath)) {
    const s16 = step(16, 'Simulation — Pass 1 Slot Uniformity (FWER)', 'FAIL',
      'simulation-results.json not found — run npm run simulate first');
    const s17 = step(17, 'Simulation — Pass 2 Cherry-Pick Test', 'FAIL',
      'simulation-results.json not found');
    return [s16, s17];
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));

  // ── QA-13 (round-4 client QA): VALUE-DOMAIN validation of the consumed artifact ──
  // Every numeric leaf of simulation-results.json must be a value the physics of this game
  // admits — counts non-negative integers bounded by a population known from code,
  // probabilities in [0,1], any payout average inside the pinned paytable's attainable
  // range. Bounds come from src/domains.ts, which derives them from plinkoConfig.json and
  // src/loader.ts, NEVER from this artifact: a bound the artifact supplies is a bound a
  // forger sets. A leaf with no declared domain is itself a failure, so a new field cannot
  // reopen the class silently. G-VALID: only the impossible is rejected — see the trap list
  // in src/domains.ts for the honest values a naive classifier would wrongly reject.
  const allRules = domainRules(cfg);
  const simDomain = validateDomains(sim, allRules['simulation-results.json']);
  // Attribute each finding to the step that consumes that half of the artifact, so the
  // failure lands on the step a reader would look at. `houseEdge` and anything unattributed
  // go to Step 16, which is the first to read the file.
  const splitDomain = (keep: (p: string) => boolean) => ({
    violations: simDomain.violations.filter(v => keep(v.path)),
    uncovered: simDomain.uncovered.filter(keep),
  });
  const isPass2 = (p: string) => p.startsWith('.pass2_casino_seeds');
  const s16Domain = splitDomain(p => !isPass2(p));
  const s17SimDomain = splitDomain(isPass2);
  const s16DomainFailures = describeDomainFailures('simulation-results.json', s16Domain);
  const s16DomainOk = s16DomainFailures.length === 0;

  // ── Step 16: Pass 1 (fresh seeds, FWER) ──────────────────────────────────────
  const pass1 = sim.pass1_fresh_seeds ?? {};
  // ── G-BIND: the Pass-1 POPULATION comes from the pinned config, never from the
  // artifact (R3-K1 / R3-K2, round-3 external review) ───────────────────────────
  // `configs = pass1.configs ?? 28` let the artifact declare its own population. Two
  // executed counterexamples came through that one line:
  //   K1  configs: 0, results: []  (totalRounds/roundsPerConfig left alone) → every
  //       ratio guard below degenerated to 0/0, which is not a failure, and the whole
  //       28,000,000-round simulation could be ABSENT behind a 21/21 Full Pass. The
  //       detail string even printed "Bonferroni α/0=Infinity" with nothing noticing.
  //   K2  28 byte-identical copies of the 8r/1 row → 28/28 rows, 0/28 chi² fails,
  //       28/28 RTPs within 6·SE, Full Pass. 27 of the 28 audited boards were never
  //       simulated at all.
  // A row COUNT is not an identity (G-BIND). The expected population is `allConfigs(cfg)`
  // — the SAME function the producer enumerates — and the artifact's row SET must equal
  // it as a set of (rows, riskLevel), with no duplicates and no strangers. Mirrors the
  // treatment Step 17 already had for its attestation population.
  const expectedConfigs = allConfigs(cfg);
  const configs = expectedConfigs.length;
  const bonAlpha = 0.01 / configs;
  const bonZCrit = inverseCriticalZ(bonAlpha);
  const results1: Record<string, number>[] = pass1.results ?? [];
  const chi2BonFails = results1.filter(r => r.slotPValue < bonAlpha);
  const serialUncorrected = results1.filter(r =>
    Math.abs(r.r1Z ?? 0) > 1.96 || (r.runsPValue !== undefined && r.runsPValue < 0.01)
  );
  const serialBonFails = results1.filter(r =>
    Math.abs(r.r1Z ?? 0) > bonZCrit || (r.runsPValue !== undefined && r.runsPValue < bonAlpha)
  );
  // Coverage guards: the artifact must actually carry one result row per config and
  // a positive round count. An empty/degenerate simulation-results.json must FAIL,
  // and a reduced-scale dev run (roundsPerConfig below the published 1M) must FLAG.
  const ROUNDS_PER_CONFIG_MIN = 1_000_000;
  const roundsPerConfig = pass1.roundsPerConfig ?? 0;
  const totalRounds = pass1.totalRounds ?? 0;
  // Set equality against the pinned config, not a count. Duplicates and strangers are
  // named individually so a failure says WHICH board is missing rather than "28 != 28".
  const key = (r: number, k: number) => `${r}r/${k}`;
  const wantKeys = expectedConfigs.map(c => key(c.rows, c.riskLevel));
  const gotKeys = results1.map(r => key(r.rows as number, (r.riskLevel ?? NaN) as number));
  const gotSet = new Set(gotKeys);
  const missingConfigs = wantKeys.filter(k => !gotSet.has(k));
  const strangerConfigs = [...new Set(gotKeys.filter(k => !wantKeys.includes(k)))];
  const duplicateConfigs = [...new Set(gotKeys.filter((k, i) => gotKeys.indexOf(k) !== i))];
  const boardsPresentOnce = wantKeys.filter(k => gotKeys.filter(g => g === k).length === 1).length;
  const populationOk = results1.length > 0
    && results1.length === configs
    && missingConfigs.length === 0
    && strangerConfigs.length === 0
    && duplicateConfigs.length === 0;
  // The artifact may still DECLARE a population; if it does it must agree with the code.
  const declaredConfigs = pass1.configs;
  const declaredOk = declaredConfigs === undefined || declaredConfigs === configs;
  const resultsLenOk = populationOk && declaredOk;
  const roundsOk = totalRounds > 0 && roundsPerConfig > 0
    && totalRounds === roundsPerConfig * configs;
  const statOk = chi2BonFails.length === 0 && serialBonFails.length === 0;
  const scaleReduced = roundsPerConfig < ROUNDS_PER_CONFIG_MIN;
  // ── Finite-value + RTP-convergence guards (FIX-04) ────────────────────────────
  // The length/rounds guards above catch an empty artifact, but a row set that RETAINS
  // the 28 rows with blanked statistics still slips through: `undefined < α` is false, so
  // an undefined slotPValue is not a chi² fail, and no comparison of simRTP to theory is
  // made anywhere. Require (a) every row to carry FINITE slot/serial statistics and RTPs,
  // and (b) each config's simulated RTP to sit within k·SE of its theoretical RTP, SE =
  // payoutSD/√rounds — a degenerate/blanked row (simRTP 0 or missing) is many SE away and
  // FAILs; genuine fresh-seed noise (observed max 2.3 SE) is far inside k = 6.
  //
  // ── QA-01 (round-4 client QA, EXECUTED counterexample) ────────────────────────
  // `dev = |r.simRTP − r.theoreticalRTP|` compared TWO EDITABLE VALUES IN THE SAME
  // ARTIFACT. Setting the first row's `simRTP` AND `theoreticalRTP` both to `2` and
  // refreshing only the dependent calibration file's simulation hash produced 21 PASS,
  // `verify` exit 0 and `check-outputs` exit 0, with a 200% RTP sitting in the file the
  // publication hashes then certify. `abs(2 − 2) = 0` is inside any tolerance.
  //
  // The fix is the G-RECOMPUTE rule this suite already applies to the calibration
  // artifact: the reference value is DERIVED FROM THE PINNED CONFIG, never read out of
  // the artifact. `payoutMuSd(cfg, rows, risk).mu` IS the theoretical RTP — the same
  // `theoreticalRTP()` the producer calls, over the SHA-256-pinned `plinkoConfig.json`.
  // So:
  //   * the artifact's DECLARED `theoreticalRTP` must equal the recomputed mu exactly
  //     (1e-12, the same bar Step 10's exhaustive-enumeration anchor is held to);
  //   * the artifact's `simRTP` is compared with the RECOMPUTED mu, not with its own
  //     neighbouring field, so both must be moved to the true value to survive — and a
  //     value moved to the true value is not a fabrication.
  // The 6·SE bar is unchanged. A declared `theoreticalRTP` of 2 now fails on the first
  // rule; a `simRTP` of 2 fails on the second at ~1,810 SE.
  const SIM_RTP_K = 6;
  const THEORY_TOL = 1e-12;
  const finiteBad: string[] = [];
  const rtpBad: string[] = [];
  const theoryBad: string[] = [];
  /** Recomputed per-row theoretical RTP, keyed as `${rows}r/${risk}` — the reference. */
  const recTheory = new Map<string, number>();
  for (const c of expectedConfigs) recTheory.set(key(c.rows, c.riskLevel), payoutMuSd(cfg, c.rows, c.riskLevel).mu);
  for (const r of results1) {
    const label = `${r.rows}r/${r.riskLevel ?? '?'}`;
    const finiteFields = [r.slotPValue, r.r1Z, r.simRTP, r.theoreticalRTP];
    if (!finiteFields.every(v => typeof v === 'number' && Number.isFinite(v))) { finiteBad.push(label); continue; }
    // A row on a board the pinned config does not declare has no reference value; the
    // set-equality guard above already FAILs it, and it must not silently skip this one.
    const mu = recTheory.get(label);
    if (mu === undefined) { theoryBad.push(`${label} is not a board plinkoConfig.json declares`); continue; }
    const { sd } = payoutMuSd(cfg, r.rows, r.riskLevel ?? 3);
    const se = roundsPerConfig > 0 ? sd / Math.sqrt(roundsPerConfig) : Infinity;
    if (!(Math.abs(r.theoreticalRTP - mu) <= THEORY_TOL)) {
      theoryBad.push(`${label} declares theory ${r.theoreticalRTP} but the pinned config gives ${mu}`);
    }
    // Against the RECOMPUTED mean — never against the artifact's own theory field.
    const dev = Math.abs(r.simRTP - mu);
    if (!(dev < SIM_RTP_K * se)) rtpBad.push(`${label} ${(dev / se).toFixed(1)}σ`);
  }
  const finiteOk = finiteBad.length === 0;
  const rtpConvergeOk = rtpBad.length === 0;
  const theoryOk = theoryBad.length === 0;

  // ── Aggregate + convergence reconciliation (QA-01) ────────────────────────────
  // "Reconcile row statistics, convergence endpoints and aggregate summaries." Every
  // header scalar the detail string prints, or a chapter could quote, is recomputed from
  // the rows and from the pinned config. Before this, `meanSimulatedRTP`,
  // `meanTheoreticalRTP`, `chi2FailsAtAlpha01`, `chi2FailsBonferroni`,
  // `serialIndependenceFails*`, `bonferroniAlpha` and `bonferroniZCritical` were read and
  // printed without ever being checked — the same "the artifact declares its own answer"
  // shape as R3-K1/K2, one level up.
  const AGG_TOL = 1e-12;
  const aggBad: string[] = [];
  const meanOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const cmpAgg = (label: string, rec: number, stored: unknown, tol: number) => {
    if (stored === undefined) { aggBad.push(`${label}: absent from the artifact`); return; }
    if (typeof stored !== 'number' || !Number.isFinite(stored) || Math.abs(rec - stored) > tol) {
      aggBad.push(`${label}: recomputed ${rec} vs artifact ${String(stored)}`);
    }
  };
  if (finiteOk && results1.length > 0) {
    cmpAgg('meanSimulatedRTP', meanOf(results1.map(r => r.simRTP)), pass1.meanSimulatedRTP, AGG_TOL);
    // The theoretical mean is recomputed from the CONFIG, not from the artifact's own
    // theory column, so a uniformly-shifted theory column cannot carry its own mean with it.
    cmpAgg('meanTheoreticalRTP', meanOf(expectedConfigs.map(c => recTheory.get(key(c.rows, c.riskLevel)) as number)),
      pass1.meanTheoreticalRTP, AGG_TOL);
    cmpAgg('chi2FailsAtAlpha01', results1.filter(r => r.slotPValue < 0.01).length, pass1.chi2FailsAtAlpha01, 0);
    cmpAgg('chi2FailsBonferroni', chi2BonFails.length, pass1.chi2FailsBonferroni, 0);
    cmpAgg('serialIndependenceFailsUncorrected', serialUncorrected.length, pass1.serialIndependenceFailsUncorrected, 0);
    cmpAgg('serialIndependenceFailsBonferroni', serialBonFails.length, pass1.serialIndependenceFailsBonferroni, 0);
    cmpAgg('bonferroniAlpha', bonAlpha, pass1.bonferroniAlpha, 0);
    cmpAgg('bonferroniZCritical', bonZCrit, pass1.bonferroniZCritical, AGG_TOL);
    // Convergence trace: one sample every CONVERGENCE_STEP rounds, and the LAST sample is
    // the running mean over all `roundsPerConfig` rounds — i.e. it must BE `simRTP`. A row
    // whose simRTP was hand-edited leaves its own convergence trace behind to contradict it.
    const wantPoints = roundsPerConfig > 0 ? Math.floor(roundsPerConfig / CONVERGENCE_STEP) : 0;
    let convBad = 0;
    for (const r of results1) {
      const conv = (r as unknown as { convergence?: unknown }).convergence;
      const label = `${r.rows}r/${r.riskLevel ?? '?'}`;
      if (!Array.isArray(conv) || conv.length !== wantPoints
          || !conv.every(v => typeof v === 'number' && Number.isFinite(v))) {
        convBad++;
        if (convBad <= 3) aggBad.push(`convergence ${label}: expected ${wantPoints} finite points, got ${Array.isArray(conv) ? conv.length : typeof conv}`);
        continue;
      }
      const last = conv[conv.length - 1] as number;
      if (wantPoints > 0 && roundsPerConfig % CONVERGENCE_STEP === 0 && last !== r.simRTP) {
        convBad++;
        if (convBad <= 3) aggBad.push(`convergence ${label}: final point ${last} != simRTP ${r.simRTP}`);
      }
    }
    if (convBad > 3) aggBad.push(`convergence: +${convBad - 3} more row(s) disagree`);
  }
  const aggOk = aggBad.length === 0;
  // ── Serial-test equivalence, MEASURED not asserted (R3-K9) ────────────────────
  // The chapters used to present lag-1 autocorrelation and the Wald-Wolfowitz runs test as
  // two independent serial tests. On this binarisation they are one statistic with the sign
  // flipped. Measure it from the rows rather than claim it, so the figure the glossary and
  // rtp-analysis quote has a producing artifact (verification-stats.json → steps.step16).
  const serialPairs = results1.filter(r =>
    typeof r.r1Z === 'number' && Number.isFinite(r.r1Z)
    && typeof r.runsZ === 'number' && Number.isFinite(r.runsZ));
  let serialCorr = NaN;
  let serialMaxAbsSum = NaN;
  if (serialPairs.length > 1) {
    const a = serialPairs.map(r => r.r1Z as number);
    const b = serialPairs.map(r => r.runsZ as number);
    const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    serialCorr = da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
    serialMaxAbsSum = Math.max(...a.map((v, i) => Math.abs(v + b[i])));
  }
  const meanRTP = pass1.meanSimulatedRTP !== undefined ? `; mean sim RTP ${(pass1.meanSimulatedRTP * 100).toFixed(4)}%` : '';
  const s16Status: 'PASS' | 'FLAG' | 'FAIL' =
    (!resultsLenOk || !roundsOk || !statOk || !finiteOk || !rtpConvergeOk || !theoryOk || !aggOk || !s16DomainOk) ? 'FAIL' : scaleReduced ? 'FLAG' : 'PASS';
  const s16 = step(16, 'Simulation — Pass 1 Slot Uniformity (FWER)',
    s16Status,
    `${configs} configs (27 std + WTF) × ${roundsPerConfig.toLocaleString()} rounds = ${totalRounds.toLocaleString()}, ${results1.length}/${configs} result rows; `
      + `chi²: ${pass1.chi2FailsAtAlpha01 ?? 0}/${configs} uncorrected, ${chi2BonFails.length}/${configs} at Bonferroni α/${configs}=${bonAlpha.toExponential(3)}; `
      + `serial: ${serialUncorrected.length}/${configs} uncorrected, ${serialBonFails.length}/${configs} at Bonferroni${meanRTP}`
      + `; theory recomputed from the pinned config (not read from the artifact): ${results1.length - theoryBad.length}/${results1.length} rows agree at ${THEORY_TOL.toExponential(0)}`
      + `; simRTP within ${SIM_RTP_K}·SE of the RECOMPUTED theory: ${results1.length - rtpBad.length}/${results1.length}`
      + `; header scalars and convergence traces reconcile with the rows: ${aggOk ? 'yes' : 'NO'}`
      + `; value domains (bounds from the pinned config, not from the artifact): ${simDomain.checked} numeric leaf/leaves checked, ${simDomain.violations.length} impossible, ${simDomain.uncovered.length} undeclared`
      + `; population bound to allConfigs(plinkoConfig.json): ${boardsPresentOnce}/${configs} expected boards present exactly once`
      + (serialPairs.length > 1 ? `; serial statistics are one test, not two: corr(r1Z, runsZ)=${serialCorr.toFixed(9)}, max|r1Z+runsZ|=${serialMaxAbsSum.toExponential(4)} over ${serialPairs.length} rows` : '')
      + (!populationOk ? `; FAIL: population does not equal allConfigs(cfg)${
          missingConfigs.length ? ` — ${missingConfigs.length} board(s) absent: ${missingConfigs.slice(0, 6).join(', ')}${missingConfigs.length > 6 ? `, +${missingConfigs.length - 6} more` : ''}` : ''
        }${strangerConfigs.length ? `; ${strangerConfigs.length} row(s) on a board the config does not declare: ${strangerConfigs.slice(0, 4).join(', ')}` : ''
        }${duplicateConfigs.length ? `; ${duplicateConfigs.length} board(s) present more than once: ${duplicateConfigs.slice(0, 4).join(', ')}` : ''
        }${results1.length !== configs ? `; ${results1.length} rows vs ${configs} expected` : ''}` : '')
      + (!declaredOk ? `; FAIL: artifact declares ${String(declaredConfigs)} configs but the pinned config has ${configs}` : '')
      + (!roundsOk ? `; FAIL: rounds — totalRounds ${totalRounds}, roundsPerConfig ${roundsPerConfig}, expected totalRounds = roundsPerConfig × ${configs} = ${roundsPerConfig * configs}` : '')
      + (!finiteOk ? `; FAIL: non-finite statistics in ${finiteBad.length} row(s): ${finiteBad.slice(0, 5).join(', ')}` : '')
      + (!theoryOk ? `; FAIL: declared theoretical RTP does not equal the pinned config's in ${theoryBad.length} row(s): ${theoryBad.slice(0, 3).join('; ')}${theoryBad.length > 3 ? `; +${theoryBad.length - 3} more` : ''}` : '')
      + (!rtpConvergeOk ? `; FAIL: simRTP off the RECOMPUTED theory beyond ${SIM_RTP_K}·SE: ${rtpBad.slice(0, 5).join(', ')}` : '')
      + (!aggOk ? `; FAIL: artifact summaries do not reconcile with its own rows: ${aggBad.slice(0, 4).join('; ')}${aggBad.length > 4 ? `; +${aggBad.length - 4} more` : ''}` : '')
      + (!s16DomainOk ? `; FAIL: value domain — ${s16DomainFailures.join('; ')}` : '')
      + (scaleReduced && resultsLenOk && roundsOk && statOk && finiteOk && rtpConvergeOk && theoryOk && aggOk && s16DomainOk ? `; FLAG: roundsPerConfig ${roundsPerConfig.toLocaleString()} below published ${ROUNDS_PER_CONFIG_MIN.toLocaleString()}` : ''),
    {
      expectedConfigs: configs,
      resultRows: results1.length,
      boardsPresentExactlyOnce: boardsPresentOnce,
      missingConfigs: missingConfigs.length,
      strangerConfigs: strangerConfigs.length,
      duplicateConfigs: duplicateConfigs.length,
      roundsPerConfig,
      totalRounds,
      bonferroniAlpha: bonAlpha,
      chi2BonferroniFails: chi2BonFails.length,
      serialUncorrectedFails: serialUncorrected.length,
      serialBonferroniFails: serialBonFails.length,
      rtpWithin6SE: results1.length - rtpBad.length,
      // QA-01: how many rows' DECLARED theory survived comparison with the theory
      // recomputed from the pinned config, and whether the header scalars and the
      // convergence traces reconcile with the rows. Both are machine values so a chapter
      // can cite them, and so `check-outputs` can re-assert them off the canonical file.
      theoryRowsAgreeingWithPinnedConfig: results1.length - theoryBad.length,
      theoryRecomputeTolerance: THEORY_TOL,
      aggregatesReconcile: aggOk,
      aggregateDisagreements: aggBad.length,
      // QA-13: how many numeric leaves of the consumed artifact were domain-checked,
      // and how many were impossible or carried no declared domain at all.
      domainLeavesChecked: simDomain.checked,
      domainViolations: simDomain.violations.length,
      domainUndeclaredFields: simDomain.uncovered.length,
      serialR1ZRunsZCorrelation: serialCorr,
      // The chapters quote the MAGNITUDE ("corr = −0.999999964"); emitting |corr| as well
      // keeps that prose figure traceable to a number-typed artifact leaf rather than to a
      // sign convention (framework check-prose P2).
      serialR1ZRunsZCorrelationAbs: Math.abs(serialCorr),
      serialMaxAbsR1ZPlusRunsZ: serialMaxAbsSum,
      serialPairsMeasured: serialPairs.length,
    },
  );

  // ── Step 17: Pass 2 (casino seeds, cherry-pick) ──────────────────────────────
  const pass2 = sim.pass2_casino_seeds ?? {};
  const seedsTested = pass2.seeds_tested ?? 0;
  const flags = pass2.cherryPickFlags ?? 0;
  const survival = pass2.cherryPickSurvivalP;
  const expected = pass2.expectedFlagsByChance;
  interface Pass2Row { epoch: number; hashedServerSeed: string; rows: number; riskLevel?: number; earlyPValue: number; latePValue: number; cherryPickFlag: boolean; zEarly?: number; zLate?: number; rtpEarly?: number; rtpLate?: number; }
  const results2: Pass2Row[] = pass2.results ?? [];

  // ── Payout-weighted window statistic (FIX-02b) ────────────────────────────────
  // The economically relevant cherry-pick test: window RTP against its exact per-config
  // mean/SD. FAIL if the count of seeds with a materially low early-window RTP is above
  // the 0.01 tail of its CALIBRATED null (see below), or the early−late paired t
  // exceeds 2.58.
  const pw = pass2.payoutWeighted ?? {};
  const countBelow = pw.countZEarlyBelow1645;
  const tDiff = pw.tZEarlyMinusLate;
  const noncesPerSeed: number = pass2.noncesPerSeed ?? 0;
  const half = Math.floor(noncesPerSeed / 2);
  const pwPresent = typeof countBelow === 'number' && typeof tDiff === 'number'
    && typeof pw.zEarlyMean === 'number' && typeof pw.meanZEarlyMinusLate === 'number';

  // ── Calibrated null, recomputed here (FIX-19) ─────────────────────────────────
  // Round-2 external review N1: the corrected expected count ("≈5.86") was carried in
  // nine chapters and pasted as a HARD-CODED LITERAL into this step's detail string,
  // while the artifact still recorded the naive 0.05·n = 10.1 and the FAIL rule was
  // still Binom(202, 0.05). Nothing in the repository computed it.
  //
  // It is computed now, and it is computed HERE as well as in the producer:
  //   * the population is rebuilt from the DATASET (ctx.bets / ctx.seeds), not from the
  //     artifact, so deleting or relabelling Pass-2 rows cannot reshape the null (G-BIND);
  //   * the per-config left-tail probabilities come from src/calibration.ts — an exact
  //     lattice convolution, not a scalar read out of a file (G-RECOMPUTE);
  //   * outputs/calibration-results.json is MANDATORY and every NUMERIC FIELD in it must agree
  //     with this recompute, so a fabricated calibration artifact FAILs the step.
  // The detail string below prints the RECOMPUTED value. There is no literal.
  const CAL_TOL = 1e-9;
  const calFailures: string[] = [];
  let calArtifact: Record<string, unknown> | null = null;
  if (!fs.existsSync(calPath)) {
    calFailures.push('outputs/calibration-results.json missing — run `npm run calibrate`');
  } else {
    try {
      calArtifact = JSON.parse(fs.readFileSync(calPath, 'utf-8')) as Record<string, unknown>;
    } catch (e) {
      calFailures.push(`outputs/calibration-results.json is not valid JSON: ${(e as Error).message}`);
    }
  }
  const calEpochs = revealedEpochConfigs(bets, seeds);
  const calEpochByEpoch = new Map(calEpochs.map(e => [e.epoch, e]));
  const calibration = half > 0 && calEpochs.length > 0
    ? calibrateLeftTailCount(cfg, calEpochs, half, Z_LEFT_TAIL)
    : null;
  const calExpected = calibration ? calibration.expectedZEarlyBelow1645Calibrated : NaN;
  const calSurvival = calibration && typeof countBelow === 'number'
    ? calibratedSurvival(calibration, countBelow)
    : NaN;
  if (!calibration) {
    calFailures.push(`cannot calibrate: window ${half} nonces, ${calEpochs.length} revealed epochs`);
  } else if (calArtifact) {
    const num = (k: string): number => {
      const v = calArtifact![k];
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    };
    const cmpCal = (label: string, rec: number, stored: number, tol: number) => {
      if (!Number.isFinite(stored) || Math.abs(rec - stored) > tol) {
        calFailures.push(`${label}: recomputed ${rec} vs artifact ${stored}`);
      }
    };
    /** Same, but the tolerance scales with the magnitude — for figures like sumThreshold (~4.9e3). */
    const cmpCalRel = (label: string, rec: number, stored: number, tol: number) => {
      cmpCal(label, rec, stored, tol * Math.max(1, Math.abs(rec)));
    };
    const cmpStr = (label: string, rec: string, stored: unknown) => {
      if (stored !== rec) calFailures.push(`${label}: recomputed ${JSON.stringify(rec)} vs artifact ${JSON.stringify(stored)}`);
    };
    cmpCal('zThreshold', Z_LEFT_TAIL, num('zThreshold'), 0);
    cmpCal('windowNonces', half, num('windowNonces'), 0);
    cmpCal('noncesPerSeed', noncesPerSeed, num('noncesPerSeed'), 0);
    cmpCal('epochs', calEpochs.length, num('epochs'), 0);
    cmpCal('expectedZEarlyBelow1645Calibrated', calExpected, num('expectedZEarlyBelow1645Calibrated'), CAL_TOL);
    cmpCal('sdZEarlyBelow1645Calibrated', calibration.sdCalibrated, num('sdZEarlyBelow1645Calibrated'), CAL_TOL);
    // ── R3-K3: everything the previous cmpCal set did NOT read ────────────────────
    // Round-3 external review doctored every field outside the seven scalars checked
    // above — all 202 perEpoch rows relabelled to 16r/3, and in every byConfig row
    // epochs→1, mu→0.5, sd→99.0, sumThreshold→−1, windowRtpThreshold→−1, latticeUnit→7,
    // crossCheck→{fabricated, 0.999, 0.0}, method→"I made this up" — and the suite still
    // returned 21/21 Full Pass with the doctored file on disk. The `crossCheck` block was
    // the most exposed: rtp-analysis.md cites it as one of two independent anchors and no
    // test read it. Every numeric field of the artifact is now recomputed.
    cmpStr('method', CALIBRATION_METHOD, calArtifact.method);
    cmpCal('varianceZEarlyBelow1645Calibrated', calibration.varianceCalibrated, num('varianceZEarlyBelow1645Calibrated'), CAL_TOL);
    cmpCal('expectedZEarlyBelow1645Naive', calibration.expectedZEarlyBelow1645Naive, num('expectedZEarlyBelow1645Naive'), CAL_TOL);
    if (typeof countBelow === 'number') {
      cmpCal('observedZEarlyBelow1645', countBelow, num('observedZEarlyBelow1645'), 0);
      cmpCal('zEarlyBelowCalibratedSurvivalP', calSurvival, num('zEarlyBelowCalibratedSurvivalP'), CAL_TOL);
    }
    // The calibration must be paired with THIS simulation artifact, not another run's.
    const src = (calArtifact.source ?? {}) as Record<string, { sha256?: string }>;
    const simSha = createHash('sha256').update(fs.readFileSync(simPath)).digest('hex');
    if (src.simulation?.sha256 !== simSha) {
      calFailures.push(`calibration was computed against simulation sha256 ${String(src.simulation?.sha256).slice(0, 12)}… but the artifact on disk is ${simSha.slice(0, 12)}…`);
    }
    if (src.dataset?.sha256 !== ctx.datasetSha256) {
      calFailures.push('calibration dataset sha256 does not match the loaded dataset');
    }
    if ((src.config as { sha256?: string } | undefined)?.sha256 !== PLINKO_CONFIG_SHA256) {
      calFailures.push('calibration config sha256 does not match the pinned plinkoConfig.json');
    }
    // Per-config rows must be present and reproduce — EVERY field, not just the tail prob.
    const stored = Array.isArray(calArtifact.byConfig) ? calArtifact.byConfig as Record<string, unknown>[] : [];
    if (stored.length !== calibration.byConfig.length) {
      calFailures.push(`byConfig rows: recomputed ${calibration.byConfig.length} vs artifact ${stored.length}`);
    } else {
      for (const rec of calibration.byConfig) {
        const row = stored.find(r => r.config === rec.config);
        if (!row) { calFailures.push(`byConfig missing ${rec.config}`); continue; }
        const f = (k: string): number => {
          const v = row[k];
          return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
        };
        cmpCal(`byConfig ${rec.config} leftTailProbability`, rec.leftTailProbability, f('leftTailProbability'), CAL_TOL);
        cmpCal(`byConfig ${rec.config} rows`, rec.rows, f('rows'), 0);
        cmpCal(`byConfig ${rec.config} riskLevel`, rec.riskLevel, f('riskLevel'), 0);
        cmpCal(`byConfig ${rec.config} epochs`, rec.epochs, f('epochs'), 0);
        cmpCal(`byConfig ${rec.config} windowNonces`, rec.windowNonces, f('windowNonces'), 0);
        cmpCalRel(`byConfig ${rec.config} mu`, rec.mu, f('mu'), CAL_TOL);
        cmpCalRel(`byConfig ${rec.config} sd`, rec.sd, f('sd'), CAL_TOL);
        cmpCalRel(`byConfig ${rec.config} sumThreshold`, rec.sumThreshold, f('sumThreshold'), CAL_TOL);
        cmpCalRel(`byConfig ${rec.config} windowRtpThreshold`, rec.windowRtpThreshold, f('windowRtpThreshold'), CAL_TOL);
        cmpCal(`byConfig ${rec.config} latticeUnit`, rec.latticeUnit, f('latticeUnit'), CAL_TOL);
        // crossCheck is published (rtp-analysis.md) as one of the two independent anchors
        // on the DP, so it is recomputed and compared like any other figure — including
        // its ABSENCE, which is meaningful (the closed form only exists for a support of
        // at most three distinct payouts).
        const cc = row.crossCheck as Record<string, unknown> | null | undefined;
        if (rec.crossCheck === null) {
          if (cc != null) calFailures.push(`byConfig ${rec.config} crossCheck: recomputed null (support too large for the closed form) vs artifact ${JSON.stringify(cc)}`);
        } else if (cc == null || typeof cc !== 'object') {
          calFailures.push(`byConfig ${rec.config} crossCheck: recomputed ${rec.crossCheck.probability} vs artifact ${JSON.stringify(cc)}`);
        } else {
          cmpStr(`byConfig ${rec.config} crossCheck.method`, rec.crossCheck.method, cc.method);
          cmpCalRel(`byConfig ${rec.config} crossCheck.probability`, rec.crossCheck.probability,
            typeof cc.probability === 'number' ? cc.probability : NaN, CAL_TOL);
          cmpCalRel(`byConfig ${rec.config} crossCheck.relativeDifference`, rec.crossCheck.relativeDifference,
            typeof cc.relativeDifference === 'number' ? cc.relativeDifference : NaN, CAL_TOL);
        }
      }
    }
    // perEpoch[] is the population the Poisson-binomial aggregate is taken over. It was
    // completely unread: relabelling all 202 rows to 16r/3 changed nothing. Re-derive it
    // against `revealedEpochConfigs(bets, seeds)` — the DATASET, not the artifact.
    const storedEpochs = Array.isArray(calArtifact.perEpoch) ? calArtifact.perEpoch as Record<string, unknown>[] : [];
    if (storedEpochs.length !== calibration.perEpoch.length) {
      calFailures.push(`perEpoch rows: recomputed ${calibration.perEpoch.length} vs artifact ${storedEpochs.length}`);
    } else {
      const byEpochStored = new Map(storedEpochs.map(r => [r.epoch as number, r]));
      let epochBad = 0;
      for (const rec of calibration.perEpoch) {
        const row = byEpochStored.get(rec.epoch);
        if (!row) { calFailures.push(`perEpoch missing epoch ${rec.epoch}`); continue; }
        const okRow = row.rows === rec.rows
          && row.riskLevel === rec.riskLevel
          && typeof row.leftTailProbability === 'number'
          && Math.abs(row.leftTailProbability - rec.leftTailProbability) <= CAL_TOL;
        if (!okRow) {
          epochBad++;
          if (epochBad <= 3) {
            calFailures.push(`perEpoch ${rec.epoch}: dataset says ${rec.rows}r/${rec.riskLevel} P=${rec.leftTailProbability}, artifact says ${String(row.rows)}r/${String(row.riskLevel)} P=${String(row.leftTailProbability)}`);
          }
        }
      }
      if (epochBad > 3) calFailures.push(`perEpoch: +${epochBad - 3} more row(s) disagree with the dataset`);
    }
  }
  // QA-13: the calibration artifact gets the same value-domain treatment as the
  // simulation artifact. Step 17 already RECOMPUTES every numeric field of it, so a
  // doctored value is caught twice over — but the recompute proves disagreement with our
  // maths, while this proves the value could not exist at all, and the two fail for
  // different and separately useful reasons.
  if (calArtifact) {
    const calDomain = validateDomains(calArtifact, allRules['calibration-results.json']);
    calFailures.push(...describeDomainFailures('calibration-results.json', calDomain));
  }
  // Pass-2 leaves of the simulation artifact belong to this step.
  const s17DomainFailures = describeDomainFailures('simulation-results.json', s17SimDomain);
  const s17DomainOk = s17DomainFailures.length === 0;
  const calOk = calFailures.length === 0;
  // The SCORED rule is now the calibrated Poisson-binomial survival — not Binom(n, 0.05).
  const pwOk = pwPresent
    && calOk
    && Number.isFinite(calSurvival) && calSurvival >= 0.01
    && Math.abs(tDiff) <= 2.58;

  // Coverage guard: survival P must be a real number (a missing/degenerate artifact
  // leaves it undefined), one result row per tested seed, and the flag count must
  // not be materially above chance (survival >= 0.01).
  // `seedsTested` is the artifact's own header field, so on its own it is self-referential
  // exactly like Pass 1's `configs` was (R3-K1/K2, swept as a class): it must equal the number
  // of REVEALED seeds in the dataset. `missingRows`/`attestChecked` below already bind the
  // attested population to `ctx.seeds`; this binds the header the detail string prints.
  const revealedSeedCount = seeds.filter(s => !!s.serverSeed).length;
  const seedsTestedOk = seedsTested === revealedSeedCount;
  const pass2Ok = seedsTested > 0
    && seedsTestedOk
    && results2.length === seedsTested
    && typeof survival === 'number'
    && survival >= 0.01
    && pwOk;

  // ── Execution attestation (R2-4) ──────────────────────────────────────────────
  // The structural guards above catch a degenerate/empty artifact but not fabricated
  // stats: nothing yet proves the stored earlyP/lateP were actually computed from the
  // committed casino seeds. Pass 2 is fully deterministic given (serverSeed, clientSeed,
  // rows, nonce), so we deterministically re-run K=5 epochs through src/rng + src/stats
  // and require the recomputed chi² p-values to match the stored rows within 1e-9
  // (headroom for cross-Node libm ULP drift). Any divergence FAILs the step — this is
  // why simulation-results.json is NOT hash-pinned (Pass 1 is fresh-seeded by design;
  // Pass 2 is attested here instead). `noncesPerSeed` / `half` are declared above,
  // where the calibrated null needs them.
  const seedByEpoch = new Map<number, { serverSeed: string | null; clientSeed: string; hashedServerSeed: string }>();
  for (const s of seeds) seedByEpoch.set(s.epoch, { serverSeed: s.serverSeed, clientSeed: s.clientSeed, hashedServerSeed: s.hashedServerSeed });
  const rowByEpoch = new Map<number, Pass2Row>();
  for (const r of results2) rowByEpoch.set(r.epoch, r);

  const ATTEST_TOL = 1e-9;
  // Attestation scope (R3-2): by DEFAULT attest EVERY epoch that has both a stored
  // Pass-2 row and a revealed server seed. A fixed public sample (the old K=5) is
  // pre-gameable — perturbing any non-sampled epoch slips through — so the publication
  // path recomputes all epochs. ATTEST_SAMPLE=<n> selects an evenly-spaced n-epoch
  // subset (endpoints always included) for quick LOCAL runs only; it is NOT the
  // default. Round-3 review R3-K4: saying so in this comment was the ONLY thing stopping
  // it on the publication path, and a comment is not a guard — `ATTEST_SAMPLE=2` shipped
  // a 21/21 Full Pass past `check-outputs`. The mode is now emitted as structured `data`
  // below and `scripts/check-outputs.mjs` REFUSES anything but `full`.
  // Population comes from the DATASET (ctx.seeds), NOT the artifact (FIX-05): the set of
  // epochs to attest is every revealed seed in the capture. An attacker who deletes rows
  // from the artifact to shrink the attested population is caught by `missingRows` below —
  // the artifact cannot define its own coverage.
  const revealedEpochs = seeds.filter(s => !!s.serverSeed).map(s => s.epoch).sort((a, b) => a - b);
  const missingRows = revealedEpochs.filter(e => !rowByEpoch.has(e));
  const attestable = revealedEpochs.filter(e => rowByEpoch.has(e));
  const sampleEnv = process.env.ATTEST_SAMPLE;
  const sampleN = sampleEnv !== undefined ? parseInt(sampleEnv, 10) : NaN;
  let attestMode: string;
  let selectEpochs: number[];
  if (Number.isFinite(sampleN) && sampleN >= 2 && sampleN < attestable.length) {
    const idxs = new Set<number>();
    for (let i = 0; i < sampleN; i++) idxs.add(Math.round((i * (attestable.length - 1)) / (sampleN - 1)));
    selectEpochs = [...idxs].sort((a, b) => a - b).map(i => attestable[i]);
    attestMode = `sample=${selectEpochs.length}`;
  } else {
    selectEpochs = attestable;
    attestMode = 'full';
  }
  let attestChecked = 0;
  let attestMaxDiff = 0;
  const attestFailures: string[] = [];
  // Recomputed per-epoch z's, collected to re-derive (and thereby attest) the stored
  // payoutWeighted summary block.
  const recZEarly: number[] = [];
  const recZLate: number[] = [];
  // ── QA-16 (round-5 client QA, EXECUTED): the rest of the Pass 2 result set ──────
  // Until now the attestation recomputed the per-epoch chi² p-values and the payout-weighted
  // z's, and the summary re-derivation covered four scalars. Everything else the artifact
  // REPORTS was carried unverified, and three separate mutations each took a 21/21 Full Pass
  // and `check-outputs` exit 0 out of that gap:
  //   * `edgeHitsEarly` = 1,000,000,000 against 1,010,000 possible drops;
  //   * `rtpEarly` = 0 on an 8-row low board whose smallest multiplier is 0.5;
  //   * `pTwoSidedZEarlyMinusLate` = 0 in place of the calculated 0.551787.
  // Every one of them is a deterministic function of data this loop already holds, so every
  // one of them is recomputed and compared: the window RTPs and the cherry-pick flag per
  // row, the edge-hit totals across the population, and — below — every remaining scalar of
  // the summary and the Pass 2 header. Nothing reported by Pass 2 is now carried on trust.
  let recEdgeHitsEarly = 0;
  let recEdgeHitsLate = 0;
  let recFlagCount = 0;
  let rtpRowsRecomputed = 0;
  if (noncesPerSeed > 0) {
    for (const ep of selectEpochs) {
      const row = rowByEpoch.get(ep)!;
      const sd = seedByEpoch.get(ep)!;
      // Consistency: the seed used in the artifact must be the one committed for this epoch.
      if (sd.hashedServerSeed !== row.hashedServerSeed) {
        attestFailures.push(`epoch ${ep}: seed hash mismatch vs artifact`);
        continue;
      }
      // G-BIND: the board the artifact claims this epoch ran on must be the board the
      // DATASET says it ran on. Without this the artifact defines its own configuration,
      // and a self-consistent row set on the wrong (rows, risk) would both attest and be
      // scored against the wrong calibrated null.
      const dsCfgRow = calEpochByEpoch.get(ep);
      if (!dsCfgRow) {
        attestFailures.push(`epoch ${ep}: no dataset config (no bets under this seed)`);
        continue;
      }
      if (row.rows !== dsCfgRow.rows || (row.riskLevel ?? 3) !== dsCfgRow.riskLevel) {
        attestFailures.push(`epoch ${ep}: artifact says ${row.rows}r/${row.riskLevel ?? '?'} but the dataset says ${dsCfgRow.rows}r/${dsCfgRow.riskLevel}`);
        continue;
      }
      const rows = row.rows;
      const risk = row.riskLevel ?? 3;
      const table = payoutTable(cfg, rows, risk);
      const { mu, sd: psd } = payoutMuSd(cfg, rows, risk);
      const earlyFreq = new Array(rows + 1).fill(0);
      const lateFreq = new Array(rows + 1).fill(0);
      let payEarly = 0, payLate = 0;
      for (let nonce = 0; nonce < noncesPerSeed; nonce++) {
        const slot = simSlot(sd.serverSeed as string, sd.clientSeed, nonce, rows);
        // An edge hit is a drop in the outermost slot on either side (QA-16).
        const isEdge = slot === 0 || slot === rows;
        if (nonce < half) { earlyFreq[slot]++; payEarly += table[slot]; if (isEdge) recEdgeHitsEarly++; }
        else              { lateFreq[slot]++;  payLate  += table[slot]; if (isEdge) recEdgeHitsLate++; }
      }
      const earlyP = chiSquaredTest(earlyFreq, binomExpected(rows, half)).pValue;
      const lateP = chiSquaredTest(lateFreq, binomExpected(rows, noncesPerSeed - half)).pValue;
      const dE = Math.abs(earlyP - row.earlyPValue);
      const dL = Math.abs(lateP - row.latePValue);
      attestMaxDiff = Math.max(attestMaxDiff, dE, dL);
      // The payout-weighted z-stats are MANDATORY (FIX-05), not "attested only when present":
      // an artifact that simply omits them must not silently skip the economically-relevant
      // check. Recompute both and require them finite and matching.
      const nLate = noncesPerSeed - half;
      const zEarly = psd > 0 ? (payEarly / half - mu) / (psd / Math.sqrt(half)) : 0;
      const zLate = psd > 0 ? (payLate / nLate - mu) / (psd / Math.sqrt(nLate)) : 0;
      if (!(typeof row.zEarly === 'number' && Number.isFinite(row.zEarly))
          || !(typeof row.zLate === 'number' && Number.isFinite(row.zLate))) {
        attestFailures.push(`epoch ${ep}: missing/non-finite zEarly/zLate`);
      } else {
        const dZE = Math.abs(zEarly - row.zEarly);
        const dZL = Math.abs(zLate - row.zLate);
        attestMaxDiff = Math.max(attestMaxDiff, dZE, dZL);
        if (dZE > ATTEST_TOL) attestFailures.push(`epoch ${ep}: zEarly Δ=${dZE.toExponential(2)}`);
        if (dZL > ATTEST_TOL) attestFailures.push(`epoch ${ep}: zLate Δ=${dZL.toExponential(2)}`);
      }
      // ── QA-16: the reported WINDOW RTPs, recomputed and board-bounded ────────────
      // `rtpEarly`/`rtpLate` are the window payout means the z-scores are built from, and
      // they are what the chapters quote as the economically relevant figure. They are
      // MANDATORY on the same reasoning as zEarly/zLate: an artifact that omits them must
      // not silently skip the check.
      const recRtpEarly = payEarly / half;
      const recRtpLate = payLate / nLate;
      if (!(typeof row.rtpEarly === 'number' && Number.isFinite(row.rtpEarly))
          || !(typeof row.rtpLate === 'number' && Number.isFinite(row.rtpLate))) {
        attestFailures.push(`epoch ${ep}: missing/non-finite rtpEarly/rtpLate`);
      } else {
        const dRE = Math.abs(recRtpEarly - row.rtpEarly);
        const dRL = Math.abs(recRtpLate - row.rtpLate);
        attestMaxDiff = Math.max(attestMaxDiff, dRE, dRL);
        if (dRE > ATTEST_TOL) attestFailures.push(`epoch ${ep}: rtpEarly Δ=${dRE.toExponential(2)} (recomputed ${recRtpEarly}, stored ${row.rtpEarly})`);
        if (dRL > ATTEST_TOL) attestFailures.push(`epoch ${ep}: rtpLate Δ=${dRL.toExponential(2)} (recomputed ${recRtpLate}, stored ${row.rtpLate})`);
        // Board-specific bound, on top of the exact recompute. The range is the smallest and
        // largest multiplier of the board the DATASET says this epoch ran on — never the
        // union over all boards, which is [0, 1000] here and therefore admits a 0% window RTP
        // on a board whose minimum payout is 50%. G-VALID: a window mean above 1 is honest
        // and stays accepted; only a value the board cannot pay is rejected.
        const { min: bMin, max: bMax } = boardMultiplierRange(cfg, dsCfgRow.rows, dsCfgRow.riskLevel);
        for (const [label, v] of [['rtpEarly', row.rtpEarly], ['rtpLate', row.rtpLate]] as const) {
          if (v < bMin || v > bMax) {
            attestFailures.push(`epoch ${ep}: ${label} ${v} is outside [${bMin}, ${bMax}], the multipliers the ${dsCfgRow.rows}r/risk-${dsCfgRow.riskLevel} board can pay`);
          }
        }
        rtpRowsRecomputed++;
      }
      // The cherry-pick flag is a PREDICATE over the two p-values this loop just recomputed,
      // so it is re-derived rather than read; `cherryPickFlags` below is its population sum.
      const recFlag = earlyP < 0.05 && lateP >= 0.05;
      if (recFlag) recFlagCount++;
      if (typeof row.cherryPickFlag !== 'boolean') {
        attestFailures.push(`epoch ${ep}: missing/non-boolean cherryPickFlag`);
      } else if (row.cherryPickFlag !== recFlag) {
        attestFailures.push(`epoch ${ep}: cherryPickFlag recomputed ${recFlag} vs stored ${row.cherryPickFlag}`);
      }
      recZEarly.push(zEarly);
      recZLate.push(zLate);
      attestChecked++;
      if (dE > ATTEST_TOL) attestFailures.push(`epoch ${ep}: earlyP Δ=${dE.toExponential(2)}`);
      if (dL > ATTEST_TOL) attestFailures.push(`epoch ${ep}: lateP Δ=${dL.toExponential(2)}`);
    }
  }
  // ── Re-derive the summary AND the Pass 2 header from the attested rows (FIX-05, QA-16) ──
  // Every scalar the artifact reports above the row level must reproduce from the per-epoch
  // values recomputed above — it cannot be fabricated independently of the rows it summarises.
  // FIX-05 covered four of them (zEarlyMean, countZEarlyBelow1645, meanZEarlyMinusLate,
  // tZEarlyMinusLate); QA-16 extends that to all fourteen, which is every numeric field of
  // `payoutWeighted` and of the Pass 2 header except `noncesPerSeed` (bound by the scale floor
  // and by the recompute itself), `seeds_tested` (bound to the dataset above) and
  // `executionTimeMs` (not a result). Only meaningful when the full population was attested
  // (sample mode covers a subset, so its summary would legitimately differ).
  const meanA = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const sampleSdA = (a: number[], m: number) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  const SUMMARY_TOL = 1e-6;
  const summaryFailures: string[] = [];
  let summaryFieldsRecomputed = 0;
  if (attestMode === 'full' && recZEarly.length > 1) {
    const recDiff = recZEarly.map((v, i) => v - recZLate[i]);
    const recZEarlyMean = meanA(recZEarly);
    const recMeanDiff = meanA(recDiff);
    const recSeDiff = sampleSdA(recDiff, recMeanDiff) / Math.sqrt(recDiff.length);
    const recT = recSeDiff > 0 ? recMeanDiff / recSeDiff : 0;
    const recCountBelow = recZEarly.filter(v => v < -Z_LEFT_TAIL).length;
    // `summaryFieldsRecomputed` counts the comparisons this block actually performs, so the
    // emitted figure cannot drift from the code the way a hand-maintained literal would.
    const cmp = (label: string, rec: number, stored: unknown, tol: number) => {
      summaryFieldsRecomputed++;
      if (typeof stored !== 'number' || !Number.isFinite(stored) || Math.abs(rec - stored) > tol)
        summaryFailures.push(`${label}: recomputed ${rec.toFixed(6)} vs stored ${typeof stored === 'number' ? stored.toFixed(6) : String(stored)}`);
    };
    /** Same, for an integer count: exact equality, no tolerance. */
    const cmpInt = (label: string, rec: number, stored: unknown) => {
      summaryFieldsRecomputed++;
      if (stored !== rec) summaryFailures.push(`${label}: recomputed ${rec} vs stored ${String(stored)}`);
    };
    cmp('zEarlyMean', recZEarlyMean, pw.zEarlyMean, SUMMARY_TOL);
    cmp('meanZEarlyMinusLate', recMeanDiff, pw.meanZEarlyMinusLate, SUMMARY_TOL);
    cmp('tZEarlyMinusLate', recT, pw.tZEarlyMinusLate, SUMMARY_TOL);
    cmpInt('countZEarlyBelow1645', recCountBelow, countBelow);

    // ── QA-16: every REMAINING reported Pass 2 scalar ────────────────────────────
    // Each of these is a closed-form function of the per-epoch values recomputed above and
    // of the attested population size `n` — which is the count of epochs THIS loop verified
    // against the dataset, not a field read out of the artifact. `normalCDF` and
    // `binomialSurvival` are imported from src/stats.ts, the same module the producer uses
    // (audit-rules 9.4), so the two sides cannot drift into disagreement over an
    // approximation. The three fields the round-5 reviewer forged are among them.
    const n = recZEarly.length;
    const recZEarlySd = sampleSdA(recZEarly, recZEarlyMean);
    cmp('zEarlySd', recZEarlySd, pw.zEarlySd, SUMMARY_TOL);
    cmp('seZEarlyMinusLate', recSeDiff, pw.seZEarlyMinusLate, SUMMARY_TOL);
    cmp('pTwoSidedZEarlyMinusLate', 2 * (1 - normalCDF(Math.abs(recT))), pw.pTwoSidedZEarlyMinusLate, SUMMARY_TOL);
    // The superseded naive null is still PUBLISHED alongside the calibrated one so the size
    // of the FIX-19 correction stays legible, so it is still a reported figure and still has
    // to reproduce. Its formulae are the producer's: 0.05·n and Binom(n, 0.05).
    cmp('expectedZEarlyBelow1645 (naive 0.05·n)', n * 0.05, pw.expectedZEarlyBelow1645, SUMMARY_TOL);
    cmp('zEarlyBelowSurvivalP (naive)', binomialSurvival(recCountBelow, n, 0.05), pw.zEarlyBelowSurvivalP, SUMMARY_TOL);
    // Edge-hit totals: integer counts of drops in slot 0 or slot `rows`, summed over exactly
    // the epochs attested above. Exact equality — there is no tolerance on a count.
    cmpInt('edgeHitsEarly', recEdgeHitsEarly, pw.edgeHitsEarly);
    cmpInt('edgeHitsLate', recEdgeHitsLate, pw.edgeHitsLate);
    // Pass 2 header scalars: the cherry-pick count is the sum of the flags re-derived per
    // row, and both nominal figures built on it are recomputed from the same formulae the
    // producer uses (0.05 × 0.95 per seed, and Binom(n, 0.0475)).
    cmpInt('cherryPickFlags', recFlagCount, flags);
    cmp('expectedFlagsByChance', n * 0.05 * 0.95, expected, SUMMARY_TOL);
    cmp('cherryPickSurvivalP', binomialSurvival(recFlagCount, n, 0.0475), survival, SUMMARY_TOL);
  }
  const summaryOk = summaryFailures.length === 0;

  // Require the recompute to have run over the selected epochs and to agree. In the
  // default (full) mode every REVEALED epoch (population from ctx.seeds) must have a row
  // and have been checked, and the summary must re-derive — an attacker cannot shrink
  // coverage or fabricate the summary without tripping this.
  const attestExpected = attestMode === 'full' ? attestable.length : selectEpochs.length;
  const attestOk = noncesPerSeed > 0 && attestChecked >= 1 && attestChecked === attestExpected
    && attestFailures.length === 0
    && (attestMode !== 'full' || missingRows.length === 0)
    && summaryOk;

  // ── Publication-scale floor (R3-3) ─────────────────────────────────────────────
  // Mirror Pass 1's ROUNDS_PER_CONFIG_MIN treatment (a below-scale run FLAGs, it does
  // not FAIL): a self-consistent but under-scale Pass 2 (e.g. 1,000 nonces vs the
  // published 10,000) is statistically valid yet not the published experiment, so it
  // must not silently pass as a full-scale attestation.
  // Single-sourced in src/config.ts (QA-16) — the same declared scale the edge-hit value
  // domain is derived from, so the floor and the bound cannot drift apart.
  const PASS2_NONCES_MIN = PASS2_NONCES_PUBLISHED;
  const pass2ScaleReduced = noncesPerSeed < PASS2_NONCES_MIN;

  const s17HardFail = !pass2Ok || !attestOk || !s17DomainOk;
  const s17Status: 'PASS' | 'FLAG' | 'FAIL' =
    s17HardFail ? 'FAIL' : pass2ScaleReduced ? 'FLAG' : 'PASS';

  // Every figure in this string is COMPUTED (FIX-19). `calExpected` and `calSurvival`
  // come from the recompute above — src/calibration.ts over the dataset population —
  // not from the artifact and not from a literal. The naive 0.05·n figure is printed
  // alongside, labelled as superseded, so the size of the correction is legible.
  const pwStr = pwPresent
    ? `; payout-weighted: zEarly mean ${pw.zEarlyMean.toFixed(3)}, ${countBelow} seeds below z=-${Z_LEFT_TAIL}`
      + ` (calibrated expectation ${calExpected.toFixed(4)}`
      + (calibration ? ` ± ${calibration.sdCalibrated.toFixed(4)}` : '')
      + `, Poisson-binomial P(X>=${countBelow})=${calSurvival.toFixed(4)}, recomputed here over ${calEpochs.length} revealed epochs;`
      + ` uncalibrated 0.05·n reference (not used for the verdict): ${(pw.expectedZEarlyBelow1645 ?? 0).toFixed(1)})`
      + `, early−late t=${tDiff.toFixed(2)} (p=${(pw.pTwoSidedZEarlyMinusLate ?? 0).toFixed(4)}), edge hits early/late ${pw.edgeHitsEarly}/${pw.edgeHitsLate}`
    : '';
  const s17 = step(17, 'Simulation — Pass 2 Cherry-Pick Test',
    s17Status,
    `${seedsTested} casino seeds × ${noncesPerSeed.toLocaleString()} nonces, ${results2.length}/${seedsTested} result rows; `
      + `cherry-pick flags: ${flags}`
      // DECLARED LIMITATION A4b (round-3 K8), stated where the reader meets the number rather
      // than only in the chapters: `expectedFlagsByChance` is 202 × 0.05 × 0.95, which assumes
      // the tail-merged slot chi² has size exactly 0.05. Independence of the two windows holds
      // (disjoint nonce ranges); the SIZE does not follow, and nothing in this repository
      // measures it. This figure and the survival P derived from it are therefore NOMINAL, not
      // calibrated — unlike the payout-weighted null below, which is recomputed exactly.
      + (expected !== undefined ? ` (expected ~${expected.toFixed(1)} by chance on the NOMINAL size-0.05 null — that size is assumed, not measured in-repo; see AUDIT_CONTEXT.md#simulation-interpretation` : '')
      + (typeof survival === 'number' ? `; survival P=${survival.toFixed(4)}, nominal on the same basis)` : expected !== undefined ? ')' : '')
      + pwStr
      + `; execution-attested (${attestMode}): recomputed early/late chi² P, payout-weighted z, window RTP and cherry-pick flag for ${attestChecked}/${attestable.length} epochs`
      + ` (${rtpRowsRecomputed} window-RTP row(s), each also bounded by its own board's paytable), max |Δ|=${attestMaxDiff.toExponential(2)} vs stored (tol ${ATTEST_TOL.toExponential(0)});`
      + ` edge hits re-counted ${recEdgeHitsEarly}/${recEdgeHitsLate} early/late; ${summaryFieldsRecomputed} summary + header scalar(s) re-derived from those rows`
      + (typeof survival !== 'number' ? `; FAIL: survival P missing` : '')
      + (!pwOk ? `; FAIL: payout-weighted ${
          !pwPresent ? 'summary missing'
          : !calOk ? `calibrated null — ${calFailures.slice(0, 4).join('; ')}${calFailures.length > 4 ? `; +${calFailures.length - 4} more` : ''}`
          : `(calibrated count-below survival ${Number.isFinite(calSurvival) ? calSurvival.toFixed(4) : 'n/a'}, |t|=${Math.abs(tDiff).toFixed(2)})`}` : '')
      + (results2.length !== seedsTested ? `; FAIL: expected ${seedsTested} result rows, got ${results2.length}` : '')
      + (!seedsTestedOk ? `; FAIL: artifact says ${seedsTested} seeds tested but the dataset has ${revealedSeedCount} revealed seeds` : '')
      + (!attestOk ? `; FAIL: execution attestation — ${
          missingRows.length ? `${missingRows.length} revealed epoch(s) have no Pass-2 row (e.g. ${missingRows.slice(0, 5).join(', ')})`
          : summaryFailures.length ? `payoutWeighted summary does not re-derive: ${summaryFailures.slice(0, 4).join('; ')}`
          : attestFailures.length ? attestFailures.slice(0, 8).join('; ') + (attestFailures.length > 8 ? `; +${attestFailures.length - 8} more` : '')
          : (noncesPerSeed <= 0 ? 'noncesPerSeed missing' : attestChecked !== attestExpected ? `checked ${attestChecked}/${attestExpected} epochs` : 'no epochs recomputed')}` : '')
      + (!s17DomainOk ? `; FAIL: value domain — ${s17DomainFailures.join('; ')}` : '')
      + (pass2ScaleReduced && !s17HardFail ? `; FLAG: noncesPerSeed ${noncesPerSeed.toLocaleString()} below published ${PASS2_NONCES_MIN.toLocaleString()}` : ''),
    // ── R3-K4: attestation scope as a MACHINE value, not only in a sentence ───────
    // `ATTEST_SAMPLE=2 npm run verify` gave 21/21 Full Pass, exit 0, and `check-outputs`
    // reported OK — the only trace was the words "sample=2" inside a prose detail string,
    // which nothing reads. The scope is recorded here so `scripts/check-outputs.mjs` can
    // require `full` on the publication path instead of a code comment asking politely.
    {
      attestMode,
      attestChecked,
      attestPopulation: attestable.length,
      revealedEpochs: revealedEpochs.length,
      missingRows: missingRows.length,
      attestMaxAbsDiff: attestMaxDiff,
      seedsTested,
      revealedSeedCount,
      resultRows: results2.length,
      noncesPerSeed,
      windowNonces: half,
      cherryPickFlags: flags,
      calibratedExpectation: calExpected,
      calibratedSurvivalP: calSurvival,
      countZEarlyBelow1645: typeof countBelow === 'number' ? countBelow : -1,
      // ── QA-16: how much of the reported Pass 2 result set was RECOMPUTED ──────────
      // Counts, not adjectives. `rtpRowsRecomputed` is the number of rows whose window RTPs
      // were re-derived from the seeds and bounded by their own board's paytable;
      // `summaryFieldsRecomputed` is the number of summary/header scalars re-derived from
      // those rows; the edge-hit totals are this run's own re-count, not the artifact's.
      rtpRowsRecomputed,
      recomputedEdgeHitsEarly: recEdgeHitsEarly,
      recomputedEdgeHitsLate: recEdgeHitsLate,
      summaryFieldsRecomputed,
      // QA-13: Pass-2 leaves of the simulation artifact that were domain-checked.
      domainViolations: s17SimDomain.violations.length,
      domainUndeclaredFields: s17SimDomain.uncovered.length,
    },
  );

  return [s16, s17];
}
