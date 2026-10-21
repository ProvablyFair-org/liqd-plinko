/**
 * Steps 16–17: Simulation Results (reads outputs/simulation-results.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { inverseCriticalZ, chiSquaredTest, chiSquaredPValue, combination, normalCDF, binomialSurvival } from '../../src/stats';
import type { Pass2EpochJob } from '../../src/pass2';
import { pass2ScanSlots, readPass2Scan } from '../../src/pass2';
import { runBatch } from '../../src/parallel';
import { pass1Slots, unpackPass1 } from '../../src/pass1';
import type { Pass1Job, Pass1Played } from '../../src/pass1';
import { renderConvergenceChart } from '../../src/convergence-chart';
import { numbersAgree, DIFF_ATOL, DIFF_RTOL } from '../../src/diff';
import { PASS1_CENSUS_SHA256 } from '../../src/artifact-pins';
import { payoutTable, allConfigs, CONVERGENCE_STEP, PASS2_NONCES_PUBLISHED } from '../../src/config';
import type { Calibration } from '../../src/calibration';
import {
  Z_LEFT_TAIL,
  CALIBRATION_METHOD,
  payoutMuSd,
  calibrateLeftTailCount,
  calibratedSurvival,
  countBelowThreshold,
  revealedEpochConfigs,
  revealedSeedsByEpoch,
  windowStats,
} from '../../src/calibration';
import { EXPECTED_EPOCH_SIZE } from '../../src/loader';
import { PLINKO_CONFIG_SHA256 } from '../../src/config';
import { domainRules, validateDomains, describeDomainFailures, boardMultiplierRange } from '../../src/domains';

// ── Pass 2 recompute helpers (mirror src/simulate.ts exactly) ──────────────────
// The per-epoch drop scan itself lives in src/pass2.ts — one function, called both by the
// serial path here and by the worker threads src/parallel.ts hands the epochs to, so the
// two cannot drift. Deterministic given (serverSeed, clientSeed, rows, nonce).
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

  // ── (round-4 client QA): VALUE-DOMAIN validation of the consumed artifact ──
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
  // ── THE EXPERIMENT, RE-RUN (profile PLINKO-20) ──────────────────────────────────
  // Every one of the 28 × 1,000,000 Pass-1 rounds is regenerated from the seed pair saved in its
  // committed row, with src/pass1.ts playPass1Config — the function src/simulate.ts generated them
  // with — fanned out over worker threads (src/parallel.ts; one configuration stays on one thread,
  // in nonce order, so nothing is re-associated). From the REPLAYED CENSUS (slot counts) this step
  // then re-derives chi², df and p (binomial expectation), the RTP (Σ count × table / n), its
  // standard error (exact payout sd / √n) and the serial statistics, and the GATES BELOW READ THOSE,
  // not the artifact's scalars. The artifact's own copies must agree with the replay: simRTP and
  // all 20 running-RTP points EXACTLY (IEEE sums and quotients in nonce order reproduce bit for
  // bit), every other figure within the reproduction tolerance of src/diff.ts (1e-14 + 1e-12·max).
  // The committed artifact carries no per-slot counts (it was generated before the standard asked
  // for them), so the census is bound byte for byte to PASS1_CENSUS_SHA256 in src/artifact-pins.ts.
  // Until 2026-09-24 this replay ran only under `npm run replay` / `npm run test:full`, outside the
  // scored path. PF_P1_REPLAY=off replays only the first CONVERGENCE_STEP rounds of each row (one
  // trace point) for a LOCAL run — the mutation battery uses it for mutations aimed at other steps;
  // the step is then capped at FLAG and is never a publication pass.
  const p1ReplayOff = process.env.PF_P1_REPLAY === 'off';
  const replayRounds = p1ReplayOff ? CONVERGENCE_STEP : roundsPerConfig;
  const replayBad: string[] = [];
  const replayed = new Map<string, Pass1Played>();
  let replayCompared = 0, replayIdentical = 0, replayMismatches = 0, replayMaxGap = 0, replayMs = 0;
  let censusSha = '';
  const rowByKey = new Map<string, Record<string, number>>();
  for (const r of results1) rowByKey.set(key(r.rows as number, (r.riskLevel ?? NaN) as number), r);
  const replayJobs: Array<{ k: string; job: Pass1Job }> = [];
  if (populationOk && roundsPerConfig > 0) {
    for (const c of expectedConfigs) {
      const k = key(c.rows, c.riskLevel);
      const row = rowByKey.get(k) as unknown as { serverSeed?: unknown; clientSeed?: unknown };
      if (typeof row.serverSeed !== 'string' || !/^[0-9a-f]{32}$/.test(row.serverSeed)
          || typeof row.clientSeed !== 'string' || row.clientSeed.length === 0) {
        replayBad.push(`${k}: the row carries no usable saved seed pair, so it cannot be replayed`);
        continue;
      }
      replayJobs.push({ k, job: {
        rows: c.rows, table: payoutTable(cfg, c.rows, c.riskLevel),
        serverSeed: row.serverSeed, clientSeed: row.clientSeed,
        rounds: replayRounds, convergenceStep: CONVERGENCE_STEP,
      } });
    }
    if (replayJobs.length === configs) {
      const t0 = Date.now();
      // Largest boards first so no thread is left alone with a 16-row job at the end; the order
      // across threads changes no arithmetic.
      const byCost = [...replayJobs].sort((a, b) => b.job.rows - a.job.rows);
      const outs = runBatch('pass1-config', byCost.map(q => q.job), pass1Slots(byCost[0].job), true);
      replayMs = Date.now() - t0;
      byCost.forEach((q, i) => replayed.set(q.k, unpackPass1(q.job, outs[i])));
    }
  } else {
    replayBad.push('the population or round count is wrong (see above), so the experiment was not replayed');
  }
  const agreeRep = (label: string, what: string, stored: unknown, derived: number, exact: boolean): void => {
    replayCompared++;
    if (typeof stored !== 'number' || (exact ? stored !== derived : !numbersAgree(stored, derived))) {
      replayMismatches++;
      replayBad.push(`${label} ${what}: committed ${String(stored)} vs replayed ${derived}${exact ? ' (exact)' : ''}`);
      return;
    }
    if (stored === derived) replayIdentical++;
    const gap = Math.abs(stored - derived);
    if (gap > replayMaxGap) replayMaxGap = gap;
  };
  /** Per-row statistics RE-DERIVED from the replay; the gates below read these. */
  const derivedByKey = new Map<string, {
    slotChi2: number; slotDf: number; slotPValue: number; r1Z: number; runsPValue: number;
    simRTP: number; histRTP: number; histTotal: number; census: number[];
  }>();
  for (const { k, job } of replayJobs) {
    const rp = replayed.get(k);
    if (!rp) continue;
    const row = rowByKey.get(k) as Record<string, number>;
    const conv = (row as unknown as { convergence?: unknown }).convergence;
    const storedConv = Array.isArray(conv) ? conv as number[] : [];
    // Trace points inside the replayed window are compared EXACTLY in both modes.
    rp.convergence.forEach((v, i) => agreeRep(k, `convergence[${i}]`, storedConv[i], v, true));
    if (p1ReplayOff) continue;
    const { chi2, df, pValue } = chiSquaredTest([...rp.slotFreq], binomExpected(job.rows, job.rounds));
    const simRTP = rp.payoutSum / job.rounds;
    const r1Z = rp.r1 * Math.sqrt(job.rounds);
    let histTotal = 0;
    rp.slotFreq.forEach((n, slot) => { histTotal += n * job.table[slot]; });
    agreeRep(k, 'slotChi2', row.slotChi2, chi2, false);
    agreeRep(k, 'slotDf', row.slotDf, df, true);
    agreeRep(k, 'slotPValue', row.slotPValue, pValue, false);
    agreeRep(k, 'r1', row.r1, rp.r1, false);
    agreeRep(k, 'r1Z', row.r1Z, r1Z, false);
    agreeRep(k, 'runsZ', row.runsZ, rp.runsZ, false);
    agreeRep(k, 'runsPValue', row.runsPValue, rp.runsP, false);
    agreeRep(k, 'simRTP', row.simRTP, simRTP, true);
    if (storedConv.length !== rp.convergence.length) {
      replayBad.push(`${k} convergence: committed ${storedConv.length} point(s) vs replayed ${rp.convergence.length}`);
    }
    derivedByKey.set(k, {
      slotChi2: chi2, slotDf: df, slotPValue: pValue, r1Z, runsPValue: rp.runsP,
      simRTP, histRTP: histTotal / job.rounds, histTotal, census: rp.slotFreq,
    });
  }
  if (!p1ReplayOff && replayJobs.length === configs && derivedByKey.size === configs) {
    // The census, in allConfigs order, serialised as JSON — pinned byte for byte.
    const census = expectedConfigs.map(c => derivedByKey.get(key(c.rows, c.riskLevel))!.census);
    censusSha = createHash('sha256').update(JSON.stringify(census)).digest('hex');
    if (censusSha !== PASS1_CENSUS_SHA256) {
      replayBad.push(`census: replayed slot counts hash to ${censusSha}, src/artifact-pins.ts PASS1_CENSUS_SHA256 is ${PASS1_CENSUS_SHA256}`);
    }
  } else if (!p1ReplayOff && populationOk) {
    replayBad.push(`${derivedByKey.size}/${configs} configurations replayed`);
  }
  const replayOk = replayBad.length === 0;
  console.log(`  [REPLAY] Pass 1: ${replayed.size}/${configs} configs × ${replayRounds.toLocaleString()} rounds regenerated from the saved seeds in `
    + `${(replayMs / 1000).toFixed(1)} s${p1ReplayOff ? ' — PF_P1_REPLAY=off: LOCAL prefix replay, step capped at FLAG, NOT a publication pass' : ''}`);

  // The gates read the REPLAYED statistics wherever the replay produced them; the artifact's
  // copies are used only on a local prefix-replay run (PF_P1_REPLAY=off, capped at FLAG).
  const gateRows: Record<string, number>[] = results1.map(r => {
    const d = derivedByKey.get(key(r.rows as number, (r.riskLevel ?? NaN) as number));
    return d ? { ...r, slotChi2: d.slotChi2, slotDf: d.slotDf, slotPValue: d.slotPValue, r1Z: d.r1Z, runsPValue: d.runsPValue, simRTP: d.simRTP } : r;
  });
  const chi2BonFails = gateRows.filter(r => r.slotPValue < bonAlpha);
  const serialUncorrected = gateRows.filter(r =>
    Math.abs(r.r1Z ?? 0) > 1.96 || (r.runsPValue !== undefined && r.runsPValue < 0.01)
  );
  const serialBonFails = gateRows.filter(r =>
    Math.abs(r.r1Z ?? 0) > bonZCrit || (r.runsPValue !== undefined && r.runsPValue < bonAlpha)
  );
  const statOk = chi2BonFails.length === 0 && serialBonFails.length === 0;
  const scaleReduced = roundsPerConfig < ROUNDS_PER_CONFIG_MIN;
  // ── Finite-value + RTP-convergence guards ────────────────────────────
  // The length/rounds guards above catch an empty artifact, but a row set that RETAINS
  // the 28 rows with blanked statistics still slips through: `undefined < α` is false, so
  // an undefined slotPValue is not a chi² fail, and no comparison of simRTP to theory is
  // made anywhere. Require (a) every row to carry FINITE slot/serial statistics and RTPs,
  // and (b) each config's simulated RTP to sit within k·SE of its theoretical RTP, SE =
  // payoutSD/√rounds — a degenerate/blanked row (simRTP 0 or missing) is many SE away and
  // FAILs; genuine fresh-seed noise (observed max 2.3 SE) is far inside k = 6.
  //
  // ── (round-4 client QA, EXECUTED counterexample) ────────────────────────
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
  for (const r of gateRows) {
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

  // ── Aggregate + convergence reconciliation ────────────────────────────
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
    cmpAgg('chi2FailsAtAlpha01', gateRows.filter(r => r.slotPValue < 0.01).length, pass1.chi2FailsAtAlpha01, 0);
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

  // ── Convergence-trace binding (profile PLINKO-32) ─────────────────────────────
  // Each committed running-RTP trace must be a trace the committed experiment could have drawn:
  //   grid     — one point every CONVERGENCE_STEP rounds (src/config.ts), roundsPerConfig/step points;
  //   terminal — the last point equals the RTP DERIVED FROM THE HISTOGRAM (the replayed census:
  //              Σ count × table / n) within the reproduction tolerance (the two sums add the same
  //              payouts in a different order, so they may differ in the last bits, never more);
  //   support  — every point lies inside the board's payout support [min table, max table];
  //   increments — the payout accumulated between consecutive points, point_j·m_j − point_{j−1}·m_{j−1},
  //              lies in [Δm·min, Δm·max] — so the cumulative payout never decreases (min ≥ 0) and
  //              no stretch pays more or less than that many drops can;
  //   reachable — from every point, the histogram's exact total is still reachable in the rounds
  //              that remain: total − point_j·m_j ∈ [(n − m_j)·min, (n − m_j)·max].
  // TOLERANCES, from the arithmetic rather than chosen. A trace point is fl(Ŝ_m / m), where Ŝ_m is
  // the running payout sum after m additions in nonce order. Recursive summation of non-negative
  // terms carries a worst-case error |Ŝ_m − S_m| ≤ (m − 1)·u·S_m (u = 2^-53, Higham's γ bound), and
  // the division and the reconstruction point × m add one rounding each, so a payout sum rebuilt
  // from a point is trusted to sumBound(m, S) = (m + 2)·u·S. The histogram-side total Σ count × table
  // is ≤ 17 products and adds, (rows + 3)·u·total. The terminal comparison therefore allows
  // (n + rows + 5)·u·RTP; a gap of that size is float order, a gap one lattice step (0.1/n) wide
  // is a different experiment. Measured gaps and the bound are emitted.
  const U = Math.pow(2, -53);
  const sumBound = (m: number, S: number): number => (m + 2) * U * Math.abs(S);
  const traceBad: string[] = [];
  let tracesBound = 0, tracePointsChecked = 0;
  let traceMaxTerminalGap = 0, traceMaxTerminalGapOverBound = 0;
  const wantTracePoints = roundsPerConfig > 0 ? Math.floor(roundsPerConfig / CONVERGENCE_STEP) : 0;
  for (const r of results1) {
    const k = key(r.rows as number, (r.riskLevel ?? NaN) as number);
    const conv = (r as unknown as { convergence?: unknown }).convergence;
    if (!Array.isArray(conv) || conv.length !== wantTracePoints || !conv.every(v => typeof v === 'number' && Number.isFinite(v))) {
      traceBad.push(`${k}: trace is not ${wantTracePoints} finite points on the ${CONVERGENCE_STEP}-round grid`);
      continue;
    }
    const d = derivedByKey.get(k);
    if (!d) { if (!p1ReplayOff) traceBad.push(`${k}: no replayed histogram to bind the trace to`); continue; }
    const table = payoutTable(cfg, r.rows as number, r.riskLevel as number);
    const lo = Math.min(...table), hi = Math.max(...table);
    const n = roundsPerConfig;
    const terminal = conv[conv.length - 1] as number;
    const gap = Math.abs(terminal - d.histRTP);
    const terminalBound = (n + (r.rows as number) + 5) * U * d.histRTP;
    if (gap > traceMaxTerminalGap) traceMaxTerminalGap = gap;
    if (terminalBound > 0 && gap / terminalBound > traceMaxTerminalGapOverBound) traceMaxTerminalGapOverBound = gap / terminalBound;
    let bad = '';
    if (!(gap <= terminalBound)) bad = `terminal point ${terminal} != histogram-derived RTP ${d.histRTP} (gap ${gap.toExponential(3)} > float bound ${terminalBound.toExponential(3)})`;
    const totalBound = ((r.rows as number) + 3) * U * d.histTotal;
    let prevM = 0, prevS = 0;
    for (let j = 0; j < conv.length && !bad; j++) {
      tracePointsChecked++;
      const m = (j + 1) * CONVERGENCE_STEP;
      const v = conv[j] as number;
      const S = v * m;
      const eS = sumBound(m, S), ePrev = sumBound(prevM, prevS);
      if (v < lo - eS / m || v > hi + eS / m) bad = `point ${j} (${m} rounds) = ${v} outside the payout support [${lo}, ${hi}]`;
      else if (S - prevS < (m - prevM) * lo - eS - ePrev || S - prevS > (m - prevM) * hi + eS + ePrev)
        bad = `point ${j}: ${S - prevS} paid over ${m - prevM} rounds, outside [${(m - prevM) * lo}, ${(m - prevM) * hi}]`;
      else if (d.histTotal - S < (n - m) * lo - eS - totalBound || d.histTotal - S > (n - m) * hi + eS + totalBound)
        bad = `point ${j}: the histogram total ${d.histTotal} is unreachable from ${S} in the remaining ${n - m} rounds`;
      prevM = m; prevS = S;
    }
    if (bad) traceBad.push(`${k}: ${bad}`); else tracesBound++;
  }
  const chartPath = path.join(outputsDir, 'rtp-convergence.html');
  let chartMatches = false;
  let chartBytes = 0;
  if (fs.existsSync(chartPath) && results1.length > 0) {
    const committedChart = fs.readFileSync(chartPath);
    chartBytes = committedChart.length;
    try {
      const rendered = renderConvergenceChart(results1 as never, results1.length, roundsPerConfig,
        pass1.meanTheoreticalRTP, CONVERGENCE_STEP);
      chartMatches = Buffer.from(rendered, 'utf8').equals(committedChart);
    } catch { chartMatches = false; }
  }
  if (!chartMatches) traceBad.push(`outputs/rtp-convergence.html (${chartBytes} bytes) is not the rendering of the committed traces`);
  const traceOk = traceBad.length === 0 && (p1ReplayOff || tracesBound === configs);
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
  // ── Dispersion guard on the committed histograms (PLINKO-31) ──────────────────
  // A per-config fit can fail by being too BAD (chi² too large — the existing Bonferroni
  // guard above) OR too GOOD. A histogram synthesised as round(binomialProb × rounds)
  // re-derives the right RTP, the right multiplier table and the right slot counts, and so
  // clears every ordinary recompute — it is betrayed only by fitting the binomial too
  // tightly: chi² ≈ 0, p ≈ 1. Reject it on either axis, using the p RE-DERIVED from the
  // committed (slotChi2, slotDf) rather than the artifact's own slotPValue scalar, so a
  // doctored p cannot ride a normal chi². Sized against THIS package's committed run
  // (measured worst p 0.9466, min chi²/df 0.4104) so the real rows clear both with wide
  // margin while a theory-perfect synthesis (p → 1, chi²/df → 0) trips them. Margins are
  // emitted as machine values below, not merely stated in prose.
  const DISPERSION_P_MAX = 0.9999;   // fail if the recomputed chi² p exceeds this
  const CHI2_FLOOR_RATIO = 0.02;     // fail if chi²/df falls below this
  const CHI2_P_TOL = 1e-9;
  const dispersionFails: string[] = [];
  const chi2ConsistencyBad: string[] = [];
  let worstDispersionP = -Infinity;   // largest recomputed p (closest to too-perfect)
  let worstChi2Ratio = Infinity;      // smallest chi²/df (closest to too-perfect)
  for (const r of gateRows) {
    const label = `${r.rows}r/${r.riskLevel ?? '?'}`;
    const chi2 = r.slotChi2, df = r.slotDf;
    if (typeof chi2 !== 'number' || !Number.isFinite(chi2) || typeof df !== 'number' || df <= 0) {
      chi2ConsistencyBad.push(`${label}: non-finite slotChi2/slotDf`);
      continue;
    }
    // Re-derive p from the committed chi²/df; a hand-set slotPValue that disagrees FAILs.
    const pRederived = chiSquaredPValue(chi2, df);
    if (typeof r.slotPValue !== 'number' || Math.abs(pRederived - r.slotPValue) > CHI2_P_TOL) {
      chi2ConsistencyBad.push(`${label}: stored p ${r.slotPValue} vs chi²-derived ${pRederived}`);
    }
    const ratio = chi2 / df;
    worstDispersionP = Math.max(worstDispersionP, pRederived);
    worstChi2Ratio = Math.min(worstChi2Ratio, ratio);
    if (pRederived > DISPERSION_P_MAX || ratio < CHI2_FLOOR_RATIO) dispersionFails.push(label);
  }
  const dispersionOk = results1.length > 0 && dispersionFails.length === 0 && chi2ConsistencyBad.length === 0;

  const meanRTP = pass1.meanSimulatedRTP !== undefined ? `; mean sim RTP ${(pass1.meanSimulatedRTP * 100).toFixed(4)}%` : '';
  const s16Status: 'PASS' | 'FLAG' | 'FAIL' =
    (!resultsLenOk || !roundsOk || !statOk || !finiteOk || !rtpConvergeOk || !theoryOk || !aggOk || !s16DomainOk || !dispersionOk || !replayOk || !traceOk) ? 'FAIL'
      : (scaleReduced || p1ReplayOff) ? 'FLAG' : 'PASS';
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
      + `; dispersion guard (re-derived chi²/p): worst p ${Number.isFinite(worstDispersionP) ? worstDispersionP.toExponential(4) : 'n/a'} (fail > ${DISPERSION_P_MAX}), min chi²/df ${Number.isFinite(worstChi2Ratio) ? worstChi2Ratio.toFixed(4) : 'n/a'} (fail < ${CHI2_FLOOR_RATIO}) → ${dispersionFails.length} implausibly-good fit(s)`
      + (serialPairs.length > 1 ? `; serial statistics are one test, not two: corr(r1Z, runsZ)=${serialCorr.toFixed(9)}, max|r1Z+runsZ|=${serialMaxAbsSum.toExponential(4)} over ${serialPairs.length} rows` : '')
      + (p1ReplayOff
        ? `; LOCAL RUN (PF_P1_REPLAY=off): only the first ${replayRounds.toLocaleString()} rounds of each config replayed (${replayCompared} trace points compared) — capped at FLAG, NOT a publication pass`
        : `; EXPERIMENT REPLAYED from the saved seeds: ${replayed.size}/${configs} configs × ${roundsPerConfig.toLocaleString()} rounds, census bound to its pin (${censusSha === PASS1_CENSUS_SHA256 ? 'match' : 'NO MATCH'}), the gates above read the statistics re-derived from it; `
          + `${replayCompared} committed figures compared, ${replayIdentical} bit-identical, ${replayMismatches} beyond tolerance (simRTP and trace points exact; others ${DIFF_ATOL.toExponential(0)} + ${DIFF_RTOL.toExponential(0)}·max)`)
      + `; convergence traces bound to the histogram: ${tracesBound}/${configs} (terminal = histogram RTP within the float bound — largest gap ${traceMaxTerminalGap.toExponential(3)}, ${(traceMaxTerminalGapOverBound * 100).toFixed(1)}% of its bound; every point inside the payout support, increments feasible, total reachable; ${tracePointsChecked} points), `
      + `published chart re-rendered from the committed traces ${chartMatches ? 'byte-identical' : 'DIFFERS'}`
      + (!replayOk ? `; FAIL: replay — ${replayBad.slice(0, 4).join('; ')}${replayBad.length > 4 ? `; +${replayBad.length - 4} more` : ''}` : '')
      + (!traceOk ? `; FAIL: trace binding — ${traceBad.slice(0, 4).join('; ')}${traceBad.length > 4 ? `; +${traceBad.length - 4} more` : ''}` : '')
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
      + (!dispersionOk ? `; FAIL: dispersion — ${dispersionFails.length} config(s) fit the binomial implausibly well (p>${DISPERSION_P_MAX} or chi²/df<${CHI2_FLOOR_RATIO}) [${dispersionFails.slice(0, 4).join(', ')}${dispersionFails.length > 4 ? `, +${dispersionFails.length - 4} more` : ''}]${chi2ConsistencyBad.length ? `; ${chi2ConsistencyBad.length} stored-p inconsistency with chi²/df: ${chi2ConsistencyBad.slice(0, 3).join('; ')}` : ''}` : '')
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
      // how many rows' DECLARED theory survived comparison with the theory
      // recomputed from the pinned config, and whether the header scalars and the
      // convergence traces reconcile with the rows. Both are machine values so a chapter
      // can cite them, and so `check-outputs` can re-assert them off the canonical file.
      theoryRowsAgreeingWithPinnedConfig: results1.length - theoryBad.length,
      theoryRecomputeTolerance: THEORY_TOL,
      aggregatesReconcile: aggOk,
      aggregateDisagreements: aggBad.length,
      // how many numeric leaves of the consumed artifact were domain-checked,
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
      // PLINKO-31 dispersion guard — the margins as machine values so a chapter can cite
      // them and check-outputs can re-assert them off the canonical file.
      dispersionMaxRecomputedP: Number.isFinite(worstDispersionP) ? worstDispersionP : 0,
      dispersionMinChi2OverDf: Number.isFinite(worstChi2Ratio) ? worstChi2Ratio : 0,
      dispersionPMax: DISPERSION_P_MAX,
      dispersionChi2FloorRatio: CHI2_FLOOR_RATIO,
      dispersionImplausiblyGoodFits: dispersionFails.length,
      dispersionChi2PInconsistencies: chi2ConsistencyBad.length,
      // PLINKO-20 — the full replay, as machine values.
      replayMode: p1ReplayOff ? 'local-prefix' : 'full',
      replayConfigs: replayed.size,
      replayRoundsPerConfig: replayRounds,
      replayFiguresCompared: replayCompared,
      replayFiguresBitIdentical: replayIdentical,
      replayFiguresBeyondTolerance: replayMismatches,
      replayLargestGapWithinTolerance: replayMaxGap,
      replayCensusSha256: censusSha,
      // PLINKO-32 — trace binding.
      tracesBoundToHistogram: tracesBound,
      tracePointsChecked,
      traceMaxTerminalGap,
      traceMaxTerminalGapOverFloatBound: traceMaxTerminalGapOverBound,
      traceFailures: traceBad.length,
      chartReRenderedByteIdentical: chartMatches,
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

  // ── Payout-weighted window statistic ────────────────────────────────
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

  // ── Calibrated null, recomputed here ─────────────────────────────────
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

  // ── PRIMARY vs EXTENDED window ───────────────────────────────────────────────
  // The scored window is EXPECTED_EPOCH_SIZE nonces — what was played under each server seed
  // in this capture (the capture rotated the seed pair every 50 bets; nothing in the captured
  // records shows LIQD limiting a seed pair to 50). Those are the drops a cherry-picked seed
  // paid in this capture; a statistic over 5,000 nonces measures a session nobody here played,
  // and its power is spent on a population that was never observed.
  //
  // The primary observed count is not available from the simulation artifact, which only
  // measured the long window, so it is recomputed HERE from the revealed seeds through the
  // same `windowStats` the producer uses. The extended 5,000/5,000 split is kept as a
  // secondary figure — it has far more power against a seed biased across its whole stream —
  // and is checked against the artifact's `extendedWindow` block.
  const primaryWindow = EXPECTED_EPOCH_SIZE;
  const seedPairs = revealedSeedsByEpoch(seeds);
  const primaryStats = primaryWindow > 0 && calEpochs.length > 0
    ? windowStats(cfg, calEpochs, seedPairs, primaryWindow, Z_LEFT_TAIL)
    : [];
  const primaryCount = countBelowThreshold(primaryStats);
  const primaryZEarly = primaryStats.map(s => s.zEarly);
  const primaryDiffs = primaryStats.map(s => s.zEarly - s.zLate);
  const meanOfWindow = (x: number[]): number => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
  const primaryZEarlyMean = meanOfWindow(primaryZEarly);
  const primaryMeanDiff = meanOfWindow(primaryDiffs);
  const primarySeDiff = primaryDiffs.length > 1
    ? Math.sqrt(primaryDiffs.reduce((s, v) => s + (v - primaryMeanDiff) ** 2, 0) / (primaryDiffs.length - 1)) / Math.sqrt(primaryDiffs.length)
    : NaN;
  const primaryT = primarySeDiff > 0 ? primaryMeanDiff / primarySeDiff : NaN;

  const calibration = primaryWindow > 0 && calEpochs.length > 0
    ? calibrateLeftTailCount(cfg, calEpochs, primaryWindow, Z_LEFT_TAIL)
    : null;
  const extCalibration = half > 0 && calEpochs.length > 0
    ? calibrateLeftTailCount(cfg, calEpochs, half, Z_LEFT_TAIL)
    : null;
  const calExpected = calibration ? calibration.expectedZEarlyBelow1645Calibrated : NaN;
  const calSurvival = calibration ? calibratedSurvival(calibration, primaryCount) : NaN;
  const extExpected = extCalibration ? extCalibration.expectedZEarlyBelow1645Calibrated : NaN;
  const extSurvival = extCalibration && typeof countBelow === 'number'
    ? calibratedSurvival(extCalibration, countBelow)
    : NaN;
  if (!extCalibration) {
    calFailures.push(`cannot calibrate the extended window: ${half} nonces, ${calEpochs.length} revealed epochs`);
  }
  if (primaryStats.length !== calEpochs.length) {
    calFailures.push(`primary window: ${primaryStats.length} of ${calEpochs.length} revealed epochs have a seed pair to recompute from`);
  }
  if (!calibration) {
    calFailures.push(`cannot calibrate: window ${primaryWindow} nonces, ${calEpochs.length} revealed epochs`);
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
    cmpCal('windowNonces', primaryWindow, num('windowNonces'), 0);
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
    // the most exposed: MANIFEST.md#payouts-and-rtp cites it as one of two independent anchors and no
    // test read it. Every numeric field of the artifact is now recomputed.
    cmpStr('method', CALIBRATION_METHOD, calArtifact.method);
    cmpCal('varianceZEarlyBelow1645Calibrated', calibration.varianceCalibrated, num('varianceZEarlyBelow1645Calibrated'), CAL_TOL);
    cmpCal('expectedZEarlyBelow1645Naive', calibration.expectedZEarlyBelow1645Naive, num('expectedZEarlyBelow1645Naive'), CAL_TOL);
    // The primary observed count is OURS — recomputed from the seeds — so this compares the
    // artifact's claim against a count nothing in the artifact could have influenced.
    cmpCal('observedZEarlyBelow1645', primaryCount, num('observedZEarlyBelow1645'), 0);
    cmpCal('zEarlyBelowCalibratedSurvivalP', calSurvival, num('zEarlyBelowCalibratedSurvivalP'), CAL_TOL);
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
    // Per-config rows and the perEpoch population must be present and reproduce — EVERY
    // field, not just the tail probability — for the PRIMARY block at the top level and for
    // the secondary `extendedWindow` block alike. Both are published, so both are re-derived.
    const checkCalBlock = (block: Calibration, node: Record<string, unknown>, label: string): void => {
      const stored = Array.isArray(node.byConfig) ? node.byConfig as Record<string, unknown>[] : [];
      if (stored.length !== block.byConfig.length) {
        calFailures.push(`${label}byConfig rows: recomputed ${block.byConfig.length} vs artifact ${stored.length}`);
      } else {
        for (const rec of block.byConfig) {
          const row = stored.find(r => r.config === rec.config);
          if (!row) { calFailures.push(`${label}byConfig missing ${rec.config}`); continue; }
          const f = (k: string): number => {
            const v = row[k];
            return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
          };
          cmpCal(`${label}byConfig ${rec.config} leftTailProbability`, rec.leftTailProbability, f('leftTailProbability'), CAL_TOL);
          cmpCal(`${label}byConfig ${rec.config} rows`, rec.rows, f('rows'), 0);
          cmpCal(`${label}byConfig ${rec.config} riskLevel`, rec.riskLevel, f('riskLevel'), 0);
          cmpCal(`${label}byConfig ${rec.config} epochs`, rec.epochs, f('epochs'), 0);
          cmpCal(`${label}byConfig ${rec.config} windowNonces`, rec.windowNonces, f('windowNonces'), 0);
          cmpCalRel(`${label}byConfig ${rec.config} mu`, rec.mu, f('mu'), CAL_TOL);
          cmpCalRel(`${label}byConfig ${rec.config} sd`, rec.sd, f('sd'), CAL_TOL);
          cmpCalRel(`${label}byConfig ${rec.config} sumThreshold`, rec.sumThreshold, f('sumThreshold'), CAL_TOL);
          cmpCalRel(`${label}byConfig ${rec.config} windowRtpThreshold`, rec.windowRtpThreshold, f('windowRtpThreshold'), CAL_TOL);
          cmpCal(`${label}byConfig ${rec.config} latticeUnit`, rec.latticeUnit, f('latticeUnit'), CAL_TOL);
          // crossCheck is published (MANIFEST.md#payouts-and-rtp) as one of the two independent anchors
          // on the DP, so it is recomputed and compared like any other figure — including
          // its ABSENCE, which is meaningful (the closed form only exists for a support of
          // at most three distinct payouts).
          const cc = row.crossCheck as Record<string, unknown> | null | undefined;
          if (rec.crossCheck === null) {
            if (cc != null) calFailures.push(`${label}byConfig ${rec.config} crossCheck: recomputed null (support too large for the closed form) vs artifact ${JSON.stringify(cc)}`);
          } else if (cc == null || typeof cc !== 'object') {
            calFailures.push(`${label}byConfig ${rec.config} crossCheck: recomputed ${rec.crossCheck.probability} vs artifact ${JSON.stringify(cc)}`);
          } else {
            cmpStr(`${label}byConfig ${rec.config} crossCheck.method`, rec.crossCheck.method, cc.method);
            cmpCalRel(`${label}byConfig ${rec.config} crossCheck.probability`, rec.crossCheck.probability,
              typeof cc.probability === 'number' ? cc.probability : NaN, CAL_TOL);
            cmpCalRel(`${label}byConfig ${rec.config} crossCheck.relativeDifference`, rec.crossCheck.relativeDifference,
              typeof cc.relativeDifference === 'number' ? cc.relativeDifference : NaN, CAL_TOL);
          }
        }
      }
      // perEpoch[] is the population the Poisson-binomial aggregate is taken over. It was
      // completely unread: relabelling all 202 rows to 16r/3 changed nothing. Re-derive it
      // against `revealedEpochConfigs(bets, seeds)` — the DATASET, not the artifact.
      const storedEpochs = Array.isArray(node.perEpoch) ? node.perEpoch as Record<string, unknown>[] : [];
      if (storedEpochs.length !== block.perEpoch.length) {
        calFailures.push(`${label}perEpoch rows: recomputed ${block.perEpoch.length} vs artifact ${storedEpochs.length}`);
      } else {
        const byEpochStored = new Map(storedEpochs.map(r => [r.epoch as number, r]));
        let epochBad = 0;
        for (const rec of block.perEpoch) {
          const row = byEpochStored.get(rec.epoch);
          if (!row) { calFailures.push(`${label}perEpoch missing epoch ${rec.epoch}`); continue; }
          const okRow = row.rows === rec.rows
            && row.riskLevel === rec.riskLevel
            && typeof row.leftTailProbability === 'number'
            && Math.abs(row.leftTailProbability - rec.leftTailProbability) <= CAL_TOL;
          if (!okRow) {
            epochBad++;
            if (epochBad <= 3) {
              calFailures.push(`${label}perEpoch ${rec.epoch}: dataset says ${rec.rows}r/${rec.riskLevel} P=${rec.leftTailProbability}, artifact says ${String(row.rows)}r/${String(row.riskLevel)} P=${String(row.leftTailProbability)}`);
            }
          }
        }
        if (epochBad > 3) calFailures.push(`${label}perEpoch: +${epochBad - 3} more row(s) disagree with the dataset`);
      }
    };
    checkCalBlock(calibration, calArtifact, '');

    // ── The secondary extended-window block ────────────────────────────────────
    // It is published beside the primary result, so it is re-derived to the same standard.
    // Its observed count is Pass 2's own (the artifact measured that window); everything
    // else is recomputed from the pinned config and the dataset population.
    const extNode = calArtifact.extendedWindow as Record<string, unknown> | undefined;
    if (!extNode || typeof extNode !== 'object') {
      calFailures.push('extendedWindow block missing — the secondary 5,000-nonce figures are unverifiable');
    } else if (extCalibration) {
      const extNum = (k: string): number => {
        const v = extNode[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
      };
      cmpCal('extendedWindow.windowNonces', half, extNum('windowNonces'), 0);
      cmpCal('extendedWindow.epochs', calEpochs.length, extNum('epochs'), 0);
      cmpCal('extendedWindow.expectedZEarlyBelow1645Calibrated', extExpected, extNum('expectedZEarlyBelow1645Calibrated'), CAL_TOL);
      cmpCal('extendedWindow.sdZEarlyBelow1645Calibrated', extCalibration.sdCalibrated, extNum('sdZEarlyBelow1645Calibrated'), CAL_TOL);
      cmpCal('extendedWindow.varianceZEarlyBelow1645Calibrated', extCalibration.varianceCalibrated, extNum('varianceZEarlyBelow1645Calibrated'), CAL_TOL);
      cmpCal('extendedWindow.expectedZEarlyBelow1645Naive', extCalibration.expectedZEarlyBelow1645Naive, extNum('expectedZEarlyBelow1645Naive'), CAL_TOL);
      if (typeof countBelow === 'number') {
        cmpCal('extendedWindow.observedZEarlyBelow1645', countBelow, extNum('observedZEarlyBelow1645'), 0);
        cmpCal('extendedWindow.zEarlyBelowCalibratedSurvivalP', extSurvival, extNum('zEarlyBelowCalibratedSurvivalP'), CAL_TOL);
      }
      checkCalBlock(extCalibration, extNode, 'extendedWindow.');
    }
  }
  // the calibration artifact gets the same value-domain treatment as the
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
  // The SCORED rule is the calibrated Poisson-binomial survival — not Binom(n, 0.05) — on the
  // PRIMARY window: the count and the paired early−late t are both computed over
  // the 50 nonces played under each seed in this capture. The extended-window figures are
  // reported beside them but do not decide the step, because no seed here was played 5,000 times.
  const pwOk = pwPresent
    && calOk
    && Number.isFinite(calSurvival) && calSurvival >= 0.01
    && Number.isFinite(primaryT) && Math.abs(primaryT) <= 2.58;

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
  // rows, nonce), so we deterministically re-run the epochs through src/rng + src/stats —
  // every epoch by default, an evenly spaced sample only under ATTEST_SAMPLE, which
  // check-outputs refuses — and require the recomputed figures to match the stored rows within
  // 1e-9 (headroom for cross-Node libm ULP drift). Any divergence FAILs the step. This
  // recomputation is the attestation of Pass 2's figures; the file is ALSO hash-pinned
  // (SIMULATION_RESULTS_SHA256 in src/artifact-pins.ts, PLINKO-27), which proves its bytes are
  // the ones this audit published. `noncesPerSeed` / `half` are declared above, where the
  // calibrated null needs them.
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
  // Population comes from the DATASET (ctx.seeds), NOT the artifact: the set of
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
  // ── (round-5 client QA, EXECUTED): the rest of the Pass 2 result set ──────
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
  // ── Plan, scan, score ─────────────────────────────────────────────────────────
  // One pass used to do all three. It is now three, for ONE reason: the drop replay in
  // the middle is ~26 million HMACs, it is completely independent per epoch, and split
  // that way it can be handed to worker threads (src/parallel.ts). Nothing else moves —
  // the epochs are planned in `selectEpochs` order, scored in `selectEpochs` order, every
  // failure string is emitted at the same point in that order, and each epoch's payout
  // sums are still accumulated over its own nonces, in nonce order, by a single thread.
  type AttestPlanEntry =
    | { kind: 'skip'; ep: number; message: string }
    | {
        kind: 'scan'; ep: number; row: Pass2Row;
        serverSeed: string; clientSeed: string;
        dsRows: number; dsRisk: number;
        rows: number; table: number[]; mu: number; psd: number;
      };
  const attestPlan: AttestPlanEntry[] = [];
  if (noncesPerSeed > 0) {
    for (const ep of selectEpochs) {
      const row = rowByEpoch.get(ep)!;
      const sd = seedByEpoch.get(ep)!;
      // Consistency: the seed used in the artifact must be the one committed for this epoch.
      if (sd.hashedServerSeed !== row.hashedServerSeed) {
        attestPlan.push({ kind: 'skip', ep, message: `epoch ${ep}: seed hash mismatch vs artifact` });
        continue;
      }
      // G-BIND: the board the artifact claims this epoch ran on must be the board the
      // DATASET says it ran on. Without this the artifact defines its own configuration,
      // and a self-consistent row set on the wrong (rows, risk) would both attest and be
      // scored against the wrong calibrated null.
      const dsCfgRow = calEpochByEpoch.get(ep);
      if (!dsCfgRow) {
        attestPlan.push({ kind: 'skip', ep, message: `epoch ${ep}: no dataset config (no bets under this seed)` });
        continue;
      }
      if (row.rows !== dsCfgRow.rows || (row.riskLevel ?? 3) !== dsCfgRow.riskLevel) {
        attestPlan.push({ kind: 'skip', ep, message: `epoch ${ep}: artifact says ${row.rows}r/${row.riskLevel ?? '?'} but the dataset says ${dsCfgRow.rows}r/${dsCfgRow.riskLevel}` });
        continue;
      }
      const rows = row.rows;
      const risk = row.riskLevel ?? 3;
      const { mu, sd: psd } = payoutMuSd(cfg, rows, risk);
      attestPlan.push({
        kind: 'scan', ep, row,
        serverSeed: sd.serverSeed as string, clientSeed: sd.clientSeed,
        dsRows: dsCfgRow.rows, dsRisk: dsCfgRow.riskLevel,
        rows, table: payoutTable(cfg, rows, risk), mu, psd,
      });
    }
  }
  // The scans, one indivisible unit per epoch.
  let scanStride = 1;
  for (const p of attestPlan) if (p.kind === 'scan') scanStride = Math.max(scanStride, p.rows + 1);
  const scanJobs: Pass2EpochJob[] = [];
  for (const p of attestPlan) {
    if (p.kind !== 'scan') continue;
    scanJobs.push({
      serverSeed: p.serverSeed, clientSeed: p.clientSeed, rows: p.rows,
      nonces: noncesPerSeed, half, table: p.table, stride: scanStride,
    });
  }
  const scans = runBatch('pass2-epoch-scan', scanJobs, pass2ScanSlots(scanStride), noncesPerSeed >= 1_000);
  {
    let scanIndex = 0;
    for (const p of attestPlan) {
      if (p.kind === 'skip') { attestFailures.push(p.message); continue; }
      const ep = p.ep;
      const row = p.row;
      const rows = p.rows;
      const mu = p.mu;
      const psd = p.psd;
      const dsCfgRow = { rows: p.dsRows, riskLevel: p.dsRisk };
      const scan = readPass2Scan(scans[scanIndex++], rows, scanStride);
      const { earlyFreq, lateFreq, payEarly, payLate } = scan;
      recEdgeHitsEarly += scan.edgeEarly;
      recEdgeHitsLate += scan.edgeLate;
      const earlyP = chiSquaredTest(earlyFreq, binomExpected(rows, half)).pValue;
      const lateP = chiSquaredTest(lateFreq, binomExpected(rows, noncesPerSeed - half)).pValue;
      const dE = Math.abs(earlyP - row.earlyPValue);
      const dL = Math.abs(lateP - row.latePValue);
      attestMaxDiff = Math.max(attestMaxDiff, dE, dL);
      // The payout-weighted z-stats are MANDATORY, not "attested only when present":
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
      // ── the reported WINDOW RTPs, recomputed and board-bounded ────────────
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
  // ── Re-derive the summary AND the Pass 2 header from the attested rows () ──
  // Every scalar the artifact reports above the row level must reproduce from the per-epoch
  // values recomputed above — it cannot be fabricated independently of the rows it summarises.
  // covered four of them (zEarlyMean, countZEarlyBelow1645, meanZEarlyMinusLate,
  // tZEarlyMinusLate); extends that to all fourteen, which is every numeric field of
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

    // ── every REMAINING reported Pass 2 scalar ────────────────────────────
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
    // of the correction stays legible, so it is still a reported figure and still has
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
  // Single-sourced in src/config.ts — the same declared scale the edge-hit value
  // domain is derived from, so the floor and the bound cannot drift apart.
  const PASS2_NONCES_MIN = PASS2_NONCES_PUBLISHED;
  const pass2ScaleReduced = noncesPerSeed < PASS2_NONCES_MIN;

  const s17HardFail = !pass2Ok || !attestOk || !s17DomainOk;
  const s17Status: 'PASS' | 'FLAG' | 'FAIL' =
    s17HardFail ? 'FAIL' : pass2ScaleReduced ? 'FLAG' : 'PASS';

  // Every figure in these strings is COMPUTED. The primary sentence is recomputed
  // here end to end — the count from the revealed seeds via `windowStats`, the null from
  // src/calibration.ts over the dataset population — not read from the artifact and not a
  // literal. The extended sentence reports Pass 2's own long-window measurement beside it,
  // labelled as secondary, with the superseded naive 0.05·n null shown so the size of the
  // correction stays legible.
  const primaryStr = calibration
    ? `; payout-weighted, PRIMARY window ${primaryWindow} nonces (played per seed in this capture — SCORED):`
      + ` zEarly mean ${primaryZEarlyMean.toFixed(3)}, ${primaryCount} of ${primaryStats.length} seeds below z=-${Z_LEFT_TAIL}`
      + ` (calibrated expectation ${calExpected.toFixed(4)} ± ${calibration.sdCalibrated.toFixed(4)},`
      + ` Poisson-binomial P(X>=${primaryCount})=${calSurvival.toFixed(4)}), early−late t=${primaryT.toFixed(2)}`
    : '';
  const pwStr = pwPresent
    ? `; EXTENDED window ${half.toLocaleString()} nonces (secondary, reported not scored — 100x the nonces played per seed in this capture):`
      + ` zEarly mean ${pw.zEarlyMean.toFixed(3)}, ${countBelow} seeds below z=-${Z_LEFT_TAIL}`
      + ` (calibrated expectation ${extExpected.toFixed(4)}`
      + (extCalibration ? ` ± ${extCalibration.sdCalibrated.toFixed(4)}` : '')
      + `, Poisson-binomial P(X>=${countBelow})=${extSurvival.toFixed(4)}, recomputed here over ${calEpochs.length} revealed epochs;`
      + ` superseded naive 0.05·n null: ${(pw.expectedZEarlyBelow1645 ?? 0).toFixed(1)})`
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
      + (expected !== undefined ? ` (expected ~${expected.toFixed(1)} by chance on the NOMINAL size-0.05 null — that size is assumed, not measured in-repo; declared limitation A4b, see MANIFEST.md#declared-limitations-register` : '')
      + (typeof survival === 'number' ? `; survival P=${survival.toFixed(4)}, nominal on the same basis)` : expected !== undefined ? ')' : '')
      + primaryStr
      + pwStr
      + `; execution-attested (${attestMode}): recomputed early/late chi² P, payout-weighted z, window RTP and cherry-pick flag for ${attestChecked}/${attestable.length} epochs`
      // The BOUND is printed; the MEASURED residual is `data.attestMaxAbsDiff` below. A residual
      // of this kind is float noise in its own right — zero on one machine, one ULP on the next —
      // so printing it inside this sentence puts a machine-dependent number in a string leaf,
      // where the reproduction diff's numeric tolerance cannot reach it and every cross-machine
      // re-run is reported as a disagreement. Text states the bound, `data` carries the number.
      + ` (${rtpRowsRecomputed} window-RTP row(s), each also bounded by its own board's paytable), every |Δ| vs stored within tol ${ATTEST_TOL.toExponential(0)} (measured max in data.attestMaxAbsDiff);`
      + ` edge hits re-counted ${recEdgeHitsEarly}/${recEdgeHitsLate} early/late; ${summaryFieldsRecomputed} summary + header scalar(s) re-derived from those rows`
      + (typeof survival !== 'number' ? `; FAIL: survival P missing` : '')
      + (!pwOk ? `; FAIL: payout-weighted ${
          !pwPresent ? 'summary missing'
          : !calOk ? `calibrated null — ${calFailures.slice(0, 4).join('; ')}${calFailures.length > 4 ? `; +${calFailures.length - 4} more` : ''}`
          : `primary window (calibrated count-below survival ${Number.isFinite(calSurvival) ? calSurvival.toFixed(4) : 'n/a'}, |t|=${Number.isFinite(primaryT) ? Math.abs(primaryT).toFixed(2) : 'n/a'})`}` : '')
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
      // ── The primary (scored) window and the secondary extended one ───────────────
      // The primary figures are recomputed here from the revealed seeds over the 50 nonces
      // played under each seed in this capture; `pwOk` is decided on them. The `extended*` figures are the
      // 5,000/5,000 split Pass 2 measured, kept because it has far more power against a seed
      // biased across its whole stream, and reported rather than scored.
      primaryWindowNonces: primaryWindow,
      primaryCountZEarlyBelow1645: primaryCount,
      primaryEpochsMeasured: primaryStats.length,
      primaryZEarlyMean: primaryZEarlyMean,
      primaryTZEarlyMinusLate: primaryT,
      extendedWindowNonces: half,
      cherryPickFlags: flags,
      calibratedExpectation: calExpected,
      calibratedSurvivalP: calSurvival,
      extendedCalibratedExpectation: extExpected,
      extendedCalibratedSurvivalP: extSurvival,
      countZEarlyBelow1645: typeof countBelow === 'number' ? countBelow : -1,
      // ── how much of the reported Pass 2 result set was RECOMPUTED ──────────
      // Counts, not adjectives. `rtpRowsRecomputed` is the number of rows whose window RTPs
      // were re-derived from the seeds and bounded by their own board's paytable;
      // `summaryFieldsRecomputed` is the number of summary/header scalars re-derived from
      // those rows; the edge-hit totals are this run's own re-count, not the artifact's.
      rtpRowsRecomputed,
      recomputedEdgeHitsEarly: recEdgeHitsEarly,
      recomputedEdgeHitsLate: recEdgeHitsLate,
      summaryFieldsRecomputed,
      // Pass-2 leaves of the simulation artifact that were domain-checked.
      domainViolations: s17SimDomain.violations.length,
      domainUndeclaredFields: s17SimDomain.uncovered.length,
    },
  );

  return [s16, s17];
}
