/**
 * LIQD Plinko — Monte-Carlo simulation (Pass 1 + Pass 2).
 *
 * Pass 1 — fresh random seeds (crypto.randomBytes) per config at runtime:
 *   Configs = allConfigs(cfg) = 27 standard (rows 8–16 × risk 1–3) + 1 WTF
 *             (rows 13, risk 4) = 28 configs.
 *   Validates, per config:
 *     - Slot uniformity: chi-squared vs independent binomial C(rows,k)·0.5^rows
 *       (exact regularized-gamma p-value). WTF slot dist is still binomial(13).
 *     - Serial independence: lag-1 autocorrelation, reported alongside the
 *       ALGEBRAICALLY EQUIVALENT Wald-Wolfowitz runs z. These are not two tests:
 *       on this binarisation runsZ = -r1Z (measured across the 28 committed rows,
 *       corr = -0.999999964, max |r1Z + runsZ| = 1.65e-3), so the serial family is
 *       28 tests and the `||` in the verifier's uncorrected/Bonferroni counts is an
 *       OR of one statistic against two thresholds.
 *     - Simulated RTP via the config's payout table (payoutTable).
 *   FWER: Bonferroni α/28.
 *
 * Pass 2 — casino seeds from the captured dataset's revealed serverSeeds:
 *   Extend each seed's nonce stream (≥10,000 nonces) and run two seed-consistency
 *   checks on the revealed seeds: an early- vs late-window slot chi-squared, and a
 *   payout-weighted window-RTP z-test (the economically relevant statistic an
 *   operator would optimise). Flag seeds whose EARLY window looks engineered
 *   (early p<0.05 AND late p≥0.05).
 *
 *   SCOPE — a SYNTHETIC FIXED-BOARD PROBE (QA-06). Each epoch is evaluated on ONE
 *   board, selected by the explicit nonce rule in `boardOfEpoch` (the epoch's
 *   lowest-nonce bet). For 192 epochs that is the only board played. The ten Phase D
 *   epochs 152–161 each spread 50 bets over all 27 standard boards, so for those this
 *   is NOT a replay of the actual mixed-board payout schedule, and the 5,000-nonce
 *   early window is two orders of magnitude longer than the 50 bets observed under the
 *   seed. Read the result as a property of the seed's payout stream on the stated
 *   board, not as an estimate of what the epoch actually paid.
 *
 *   CHERRY-PICK SCOPE (QA-07) — three tiers, not two, and the first is conditional:
 *     * 192 epochs: the server-seed hash was published before the client seed EXISTED,
 *       so seed substitution is blocked. This is structural, but it is still
 *       CONDITIONAL on authentic commitment timing (premise P1 / DL-3) — commitment
 *       equality and chronology inside one self-published file do not establish that
 *       the commitment was public before the client seed was chosen.
 *     * epoch 152: UNRESOLVED. Its client seed carries the `pfaudit-<run-id>-<epoch>`
 *       pattern whose run-id is a millisecond timestamp. Prior publication of the hash
 *       blocks later seed SUBSTITUTION; it does not rule out grinding against a
 *       PREDICTABLE future client seed. The audit assumes ~10^4 timestamp candidates
 *       carry negligible cherry-pick power and does NOT demonstrate that assumption.
 *       Neither "safe" nor "compromised" is asserted.
 *     * 9 epochs 153–161: predictable client seeds the operator already held at
 *       commitment (rotation N returns the N+1 commitment). Containment there is
 *       statistical only — this test and Step 21.
 *
 * Anti-circularity: expected slot distribution is pure binomial — never from any
 * operator payout table.
 *
 * Output: outputs/simulation-results.json, outputs/rtp-convergence.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'node:crypto';

import { generateProvablyFairNumber } from './rng';
import { loadDataset, EXPECTED_DATASET_SHA256 } from './loader';
import {
  combination,
  chiSquaredTest,
  lag1Autocorrelation,
  runsTest,
  inverseCriticalZ,
  normalCDF,
  binomialSurvival,
} from './stats';
import {
  loadPlinkoConfig,
  allConfigs,
  payoutTable,
  isWtf,
  theoreticalRTP,
  binomP,
  CONVERGENCE_STEP,
  PASS2_NONCES_PUBLISHED,
} from './config';
import {
  Z_LEFT_TAIL,
  CALIBRATION_METHOD,
  payoutMuSd,
  calibrateLeftTailCount,
  calibratedSurvival,
  revealedEpochConfigs,
  boardOfEpoch,
  betsByHash,
} from './calibration';

// ── Config + constants ──────────────────────────────────────────────────────────

const cfg = loadPlinkoConfig();
const CONFIGS = allConfigs(cfg); // 28: 27 standard + WTF
const ROUNDS_PER_CONFIG = Number(process.env.ROUNDS_PER_CONFIG) || 1_000_000;
// The published scale is declared in src/config.ts, which is also where the value-domain
// bound on the Pass 2 edge-hit counts is derived from (QA-16).
const PASS2_NONCES = Number(process.env.PASS2_NONCES) || PASS2_NONCES_PUBLISHED;
const HOUSE_EDGE = cfg.houseEdge;

const DATASET_PATH = path.join(__dirname, '..', 'data', 'plinko-master-10100bets.json');
// Same pin as tests/verify.ts. Pass 2 seeds its casino-seed cherry-pick test from this
// dataset, so it must be loaded through the SHA-256-guarded loader BEFORE any result is
// written — an edited dataset must abort at startup, not after a ~22-minute run has already
// overwritten the outputs.
const EXPECTED_DATASET_HASH = EXPECTED_DATASET_SHA256;

// Load + hash-verify the dataset at STARTUP, before Pass 1's long run and before any
// output is written. loadDataset exits(1) on a SHA-256 mismatch.
const dataset = loadDataset(DATASET_PATH, EXPECTED_DATASET_HASH);

// ── Progress bar ──────────────────────────────────────────────────────────────

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinIdx = 0;
let lastProgressLine = '';
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function startSpinner(): void {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    if (!lastProgressLine) return;
    spinIdx++;
    const spin = SPINNER[spinIdx % SPINNER.length];
    const updated = lastProgressLine.replace(/^(\r  )./, `$1${spin}`);
    process.stdout.write(updated);
  }, 120);
}

function stopSpinner(): void {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
}

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio = Math.min(total > 0 ? current / total : 0, 1);
  const filled = Math.round(ratio * width);
  const bar = '━'.repeat(filled) + '╌'.repeat(width - filled);
  const pct = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  const spin = SPINNER[spinIdx % SPINNER.length];
  lastProgressLine = `\r  ${spin} ${bar} ${pct}% | ${current}/${total} | ${label} | ${elapsed}s elapsed ~ ${eta}s left`;
  process.stdout.write(lastProgressLine);
}

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

// ── Binomial expected slot frequencies ───────────────────────────────────────

function binomialExpected(rows: number, n: number): number[] {
  const p = Math.pow(0.5, rows);
  return Array.from({ length: rows + 1 }, (_, k) => combination(rows, k) * p * n);
}

/** Simulate one round: returns winningSlot = count of right-bits over `rows`. */
function simulateSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  let slot = 0;
  for (let i = 0; i < rows; i++) {
    slot += generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
  }
  return slot;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 1 — Fresh random seeds
// ══════════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — PASS 1: fresh random seeds');
console.log(`  ${CONFIGS.length} configs (27 standard + WTF) × ${ROUNDS_PER_CONFIG.toLocaleString()} rounds`);
console.log('═'.repeat(60) + '\n');

interface Pass1Result {
  rows: number;
  riskLevel: number;
  wtf: boolean;
  serverSeed: string;
  clientSeed: string;
  slotChi2: number;
  slotDf: number;
  slotPValue: number;
  r1: number;
  r1Z: number;
  runsZ: number;
  runsPValue: number;
  theoreticalRTP: number;
  simRTP: number;
  /** Running mean RTP sampled every CONVERGENCE_STEP rounds — the convergence trace. */
  convergence: number[];
}

// Convergence samples: running mean RTP recorded every CONVERGENCE_STEP rounds per config.
// Single-sourced in src/config.ts (audit-rules 9.4) — the replay and the Step 16 verifier
// read the SAME constant, so the three cannot drift apart.

const pass1Results: Pass1Result[] = [];
const pass1Start = Date.now();
progressBar(0, CONFIGS.length, 'starting...', pass1Start);
startSpinner();

for (let ci = 0; ci < CONFIGS.length; ci++) {
  const { rows, riskLevel } = CONFIGS[ci];
  const table = payoutTable(cfg, rows, riskLevel);

  const serverSeed = randomBytes(16).toString('hex');
  const clientSeed = randomBytes(16).toString('hex');

  const slotFreq = new Array(rows + 1).fill(0);
  const winSequence = new Uint8Array(ROUNDS_PER_CONFIG);
  let payoutSum = 0;
  const convergence: number[] = [];

  for (let nonce = 0; nonce < ROUNDS_PER_CONFIG; nonce++) {
    const slot = simulateSlot(serverSeed, clientSeed, nonce, rows);
    slotFreq[slot]++;
    payoutSum += table[slot];
    winSequence[nonce] = slot > rows / 2 ? 0 : 1; // binary for serial test
    if ((nonce + 1) % CONVERGENCE_STEP === 0) convergence.push(payoutSum / (nonce + 1));
  }

  const expected = binomialExpected(rows, ROUNDS_PER_CONFIG);
  const { chi2, df, pValue } = chiSquaredTest([...slotFreq], expected);

  const seq = Array.from(winSequence) as number[];
  const r1 = lag1Autocorrelation(seq);
  const r1Z = r1 * Math.sqrt(ROUNDS_PER_CONFIG);
  const { z: runsZ, pValue: runsP } = runsTest(seq);

  pass1Results.push({
    rows, riskLevel, wtf: isWtf(riskLevel), serverSeed, clientSeed,
    slotChi2: chi2, slotDf: df, slotPValue: pValue,
    r1, r1Z, runsZ, runsPValue: runsP,
    theoreticalRTP: theoreticalRTP(cfg, rows, riskLevel),
    simRTP: payoutSum / ROUNDS_PER_CONFIG,
    convergence,
  });

  progressBar(ci + 1, CONFIGS.length, `rows=${rows} risk=${riskLevel}`, pass1Start);
}

stopSpinner();
clearLine();
progressBar(CONFIGS.length, CONFIGS.length, 'done', pass1Start);
process.stdout.write('\n');

// ── Pass 1 summary ────────────────────────────────────────────────────────────

const pass1ElapsedMs = Date.now() - pass1Start;
const bonAlpha = 0.01 / CONFIGS.length;
const bonZCrit = inverseCriticalZ(bonAlpha);
const pass1Chi2Fails = pass1Results.filter(r => r.slotPValue < 0.01).length;
const pass1Chi2FailsBon = pass1Results.filter(r => r.slotPValue < bonAlpha).length;
// Serial independence: uncorrected (α=0.05 two-sided / runs p<0.01) and Bonferroni-corrected.
const pass1SerialFailsUncorrected = pass1Results.filter(r => Math.abs(r.r1Z) > 1.96 || r.runsPValue < 0.01).length;
const pass1SerialFails = pass1Results.filter(r => Math.abs(r.r1Z) > bonZCrit || r.runsPValue < bonAlpha).length;
const meanSimRTP = pass1Results.reduce((s, r) => s + r.simRTP, 0) / pass1Results.length;
const meanTheoRTP = pass1Results.reduce((s, r) => s + r.theoreticalRTP, 0) / pass1Results.length;

console.log('');
console.log(`  FWER: Bonferroni α/N = ${bonAlpha.toExponential(3)} (N=${CONFIGS.length})`);
console.log(`  Slot chi-squared: ${pass1Chi2Fails}/${CONFIGS.length} fail at α=0.01 · ${pass1Chi2FailsBon}/${CONFIGS.length} at Bonferroni`);
console.log(`  Serial independence: ${pass1SerialFailsUncorrected}/${CONFIGS.length} uncorrected (|r₁z|>1.96 or runs p<0.01) · ${pass1SerialFails}/${CONFIGS.length} at Bonferroni (|r₁z|>${bonZCrit.toFixed(3)} or runs p<${bonAlpha.toExponential(2)})`);
console.log(`  Mean simulated RTP: ${(meanSimRTP * 100).toFixed(4)}%  (theoretical ${(meanTheoRTP * 100).toFixed(4)}%)`);
console.log(`  Time: ${(pass1ElapsedMs / 1000).toFixed(1)}s\n`);

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 2 — Casino seeds (cherry-pick test)
// ══════════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — PASS 2: casino seeds (cherry-pick test)');
console.log('═'.repeat(60) + '\n');

interface Pass2SeedResult {
  epoch: number;
  hashedServerSeed: string;
  rows: number;
  riskLevel: number;
  earlyPValue: number;
  latePValue: number;
  cherryPickFlag: boolean;
  // Payout-weighted window statistic (the economically relevant test — an operator
  // optimises window RTP, not the tail-merged slot chi²). z = (windowRTP − mu)/(sd/√n),
  // mu and sd exact per-config from the payout table and the independent binomial.
  zEarly: number;
  zLate: number;
  rtpEarly: number;
  rtpLate: number;
}

const pass2Results: Pass2SeedResult[] = [];
let seedsTested = 0;
let cherryPickFlags = 0;

// Revealed casino seeds + the per-epoch (rows, riskLevel) from the startup-verified,
// SHA-256-pinned dataset (loaded above through loadDataset — no unguarded re-read here).
// QA-06: board selection is an EXPLICIT NONCE RULE (the epoch's lowest-nonce bet),
// defined once in src/calibration.ts and read from there by the simulator, the
// calibration producer and the Step 17 verifier. It used to be file-array order, which
// meant a re-serialisation of the same records changed the board chosen for each of the
// ten mixed-board Phase D epochs — and therefore changed the scored null.
const ds = dataset;
const betsByEpochHash = betsByHash(ds.bets);
const boardByHash = new Map<string, { rows: number; riskLevel: number }>();
for (const [hash, epochBets] of betsByEpochHash) {
  const board = boardOfEpoch(epochBets);
  if (board) boardByHash.set(hash, board);
}
const revealedSeeds = ds.seeds.filter(s => s.serverSeed);

// Exact per-config payout mean/SD from the independent binomial and the pinned table.
// Defined ONCE in src/calibration.ts and read from there by the simulator, the
// calibration producer and the Step 17 verifier (audit-rules 9.4: one module per
// constant/derived predicate).

const half = Math.floor(PASS2_NONCES / 2);
let edgeHitsEarly = 0;
let edgeHitsLate = 0;
const pass2Start = Date.now();
progressBar(0, revealedSeeds.length, 'starting...', pass2Start);
startSpinner();

for (let si = 0; si < revealedSeeds.length; si++) {
  const s = revealedSeeds[si];
  const board = boardByHash.get(s.hashedServerSeed);
  const rows = board?.rows ?? 16;
  const risk = board?.riskLevel ?? 3;
  const table = payoutTable(cfg, rows, risk);
  const { mu, sd } = payoutMuSd(cfg, rows, risk);

  const earlyFreq = new Array(rows + 1).fill(0);
  const lateFreq = new Array(rows + 1).fill(0);
  let payEarly = 0, payLate = 0;
  for (let nonce = 0; nonce < PASS2_NONCES; nonce++) {
    const slot = simulateSlot(s.serverSeed as string, s.clientSeed, nonce, rows);
    const isEdge = slot === 0 || slot === rows;
    if (nonce < half) { earlyFreq[slot]++; payEarly += table[slot]; if (isEdge) edgeHitsEarly++; }
    else              { lateFreq[slot]++;  payLate  += table[slot]; if (isEdge) edgeHitsLate++; }
  }

  const earlyP = chiSquaredTest(earlyFreq, binomialExpected(rows, half)).pValue;
  const lateP = chiSquaredTest(lateFreq, binomialExpected(rows, PASS2_NONCES - half)).pValue;
  const flag = earlyP < 0.05 && lateP >= 0.05;
  if (flag) cherryPickFlags++;

  const nLate = PASS2_NONCES - half;
  const rtpEarly = payEarly / half;
  const rtpLate = payLate / nLate;
  const zEarly = sd > 0 ? (rtpEarly - mu) / (sd / Math.sqrt(half)) : 0;
  const zLate = sd > 0 ? (rtpLate - mu) / (sd / Math.sqrt(nLate)) : 0;
  seedsTested++;

  pass2Results.push({
    epoch: s.epoch, hashedServerSeed: s.hashedServerSeed, rows, riskLevel: risk,
    earlyPValue: earlyP, latePValue: lateP, cherryPickFlag: flag,
    zEarly, zLate, rtpEarly, rtpLate,
  });

  progressBar(si + 1, revealedSeeds.length, `epoch ${s.epoch}`, pass2Start);
}

stopSpinner();
clearLine();
progressBar(revealedSeeds.length, revealedSeeds.length, 'done', pass2Start);
process.stdout.write('\n');

const pass2ElapsedMs = Date.now() - pass2Start;
// Expected flags by chance: P(early<0.05 AND late>=0.05) = 0.05 × 0.95 = 0.0475 per seed.
//
// DECLARED ASSUMPTION (round-3 external review K8, disclosed not closed). This is a NOMINAL
// null: it takes the tail-merged slot chi² to have size exactly 0.05. The windows are disjoint
// nonce ranges, so the independence half is sound, but the size half is not derived anywhere —
// the statistic is a discrete multinomial goodness-of-fit with merged tails, whose true size at
// n = 5,000 is near 0.05 but board-dependent. `expectedFlagsByChance` and the binomial survival
// below are therefore nominal figures. The correction is immaterial at these counts (11 vs ~9.6
// is not a signal at any plausible size near 0.05) and the payout-weighted statistic — which IS
// calibrated exactly, see src/calibration.ts — agrees, but nothing here measures the size, and
// the chapters say so. Measuring it by exact-null Monte Carlo per board size and re-deriving the
// expectation is a listed future improvement (recommendations.md); it would require re-running
// the fresh-seeded Pass 1, which audit-rules 9.4 forbids once the report cites its output.
const expectedFlags = seedsTested * 0.05 * 0.95;
// Binomial survival: P(X >= observed) under H0 p=0.0475 — flag only if materially above
// chance. SINGLE-SOURCED in src/stats.ts (QA-16) because Step 17 recomputes this figure.
const cherryPickSurvival = binomialSurvival(cherryPickFlags, seedsTested, 0.0475);

// ── Payout-weighted window statistic (economically relevant cherry-pick test) ──
// An operator selecting a seed for a short session optimises window RTP, not the
// tail-merged slot chi² (which folds the money-carrying tail slots on high-risk
// boards). This measures window RTP against its exact per-config mean and SD.
// `normalCDF` is imported from src/stats.ts (QA-16). It used to be an inline copy of the
// Abramowitz–Stegun expression here; Step 17 recomputes pTwoSidedZEarlyMinusLate and a
// second copy of an approximation the two sides must agree on to 1e-6 is a latent
// divergence, not a convenience.
const zEarlyArr = pass2Results.map(r => r.zEarly);
const diffArr = pass2Results.map(r => r.zEarly - r.zLate);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sampleSd = (a: number[], m: number) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
const zEarlyMean = mean(zEarlyArr);
const zEarlySd = sampleSd(zEarlyArr, zEarlyMean);
const countZEarlyBelow = pass2Results.filter(r => r.zEarly < -Z_LEFT_TAIL).length;
const meanDiff = mean(diffArr);
const seDiff = sampleSd(diffArr, meanDiff) / Math.sqrt(diffArr.length);
const tDiff = seDiff > 0 ? meanDiff / seDiff : 0;
const pTwoSidedDiff = 2 * (1 - normalCDF(Math.abs(tDiff)));

// ── Calibrated null for the low-RTP count (FIX-19) ────────────────────────────
// The count used to be scored against Binom(n, 0.05) — "z is standard normal, so 5%
// of seeds fall below the 5% critical value". The window payout sum is a sum of
// `half` draws from a violently right-skewed distribution, so its standardised mean
// is NOT normal at this n and the true left-tail probability is per-config and well
// below 0.05. That naive null over-predicted the expected count by roughly a factor
// of two, which is a difference in the wrong direction: it makes an anomalously LOW
// count look normal. The null is now computed exactly (see src/calibration.ts) from
// the pinned payout tables and the board each captured epoch ran on, and the count is
// scored against a Poisson-binomial survival built from those per-epoch probabilities.
// Both the naive and the calibrated figures are written, so the size of the correction
// is visible in the artifact rather than asserted in prose.
const calibration = calibrateLeftTailCount(cfg, revealedEpochConfigs(ds.bets, ds.seeds), half, Z_LEFT_TAIL);
const expectedZEarlyBelowNaive = seedsTested * 0.05;
const expectedZEarlyBelowCalibrated = calibration.expectedZEarlyBelow1645Calibrated;
const zBelowCalibratedSurvival = calibratedSurvival(calibration, countZEarlyBelow);
// Retained for comparison only — NOT the scored rule any more.
const zBelowNaiveSurvival = binomialSurvival(countZEarlyBelow, seedsTested, 0.05);

console.log('');
console.log(`  Seeds tested: ${seedsTested} × ${PASS2_NONCES.toLocaleString()} nonces`);
console.log(`  Cherry-pick flags: ${cherryPickFlags} (expected ~${expectedFlags.toFixed(1)} by chance; survival P=${cherryPickSurvival.toFixed(4)})`);
console.log(`  Payout-weighted: zEarly mean ${zEarlyMean.toFixed(3)} sd ${zEarlySd.toFixed(3)}; ${countZEarlyBelow} seeds below z=-${Z_LEFT_TAIL} (calibrated expectation ${expectedZEarlyBelowCalibrated.toFixed(4)}, sd ${calibration.sdCalibrated.toFixed(4)}, Poisson-binomial P(X>=${countZEarlyBelow})=${zBelowCalibratedSurvival.toFixed(4)}; the superseded naive 0.05·n null gives ${expectedZEarlyBelowNaive.toFixed(1)}); early−late t=${tDiff.toFixed(2)} (mean ${meanDiff.toFixed(3)}, se ${seDiff.toFixed(3)}, two-sided P=${pTwoSidedDiff.toFixed(4)}); edge hits early/late ${edgeHitsEarly}/${edgeHitsLate}`);
console.log(`  Time: ${(pass2ElapsedMs / 1000).toFixed(1)}s\n`);

// ── Write outputs ─────────────────────────────────────────────────────────────

// ── QA-03: a fresh experiment does NOT overwrite the historical evidence ───────
// Round-4 client QA. This command draws fresh crypto.randomBytes seeds, so every run is
// a NEW EXPERIMENT — and it used to write straight over outputs/simulation-results.json,
// the artifact of record that two external reviewers independently reproduced, before any
// validation had run. A failed validation then left the canonical report associated with
// an artifact nobody had checked.
//
// A fresh run now writes into its OWN directory (outputs/fresh/ by default), and the
// historical output set is preserved. `npm run replay` is the command that re-executes
// the ORIGINAL experiment from its saved seeds and compares — that, not a fresh run, is
// what "reproducible" means for Pass 1.
//
// SIM_OUT_DIR=outputs is the explicit, deliberate re-baseline escape. It is a path the
// operator has to type; it is not the default, and it is not on the `npm test` path.
const OUTPUTS_DIR = path.join(__dirname, '..', process.env.SIM_OUT_DIR ?? 'outputs/fresh');
const CANONICAL_DIR = path.join(__dirname, '..', 'outputs');
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
if (path.resolve(OUTPUTS_DIR) === path.resolve(CANONICAL_DIR)) {
  console.log('  [WARNING] SIM_OUT_DIR points at outputs/ — this fresh experiment will OVERWRITE');
  console.log('            outputs/simulation-results.json, the artifact of record. Deliberate re-baseline only.');
}

const output = {
  audit: 'LIQD Plinko',
  generatedAt: new Date().toISOString(),
  algorithm: 'HMAC-SHA256 (key = hex-decoded serverSeed); each row draws bit 0|1 at cursor i+1; winningSlot = count of 1-bits; payout = table[winningSlot]',
  houseEdge: HOUSE_EDGE,
  pass1_fresh_seeds: {
    description: 'Auditor-generated fresh random seeds (crypto.randomBytes) per config. Validates slot distribution against independent binomial(rows, 0.5), serial independence, and simulated RTP at scale. Includes the WTF config (rows 13, risk 4).',
    configs: CONFIGS.length,
    roundsPerConfig: ROUNDS_PER_CONFIG,
    totalRounds: CONFIGS.length * ROUNDS_PER_CONFIG,
    executionTimeMs: pass1ElapsedMs,
    chi2FailsAtAlpha01: pass1Chi2Fails,
    chi2FailsBonferroni: pass1Chi2FailsBon,
    bonferroniAlpha: bonAlpha,
    bonferroniZCritical: bonZCrit,
    serialIndependenceFailsUncorrected: pass1SerialFailsUncorrected,
    serialIndependenceFailsBonferroni: pass1SerialFails,
    meanSimulatedRTP: meanSimRTP,
    meanTheoreticalRTP: meanTheoRTP,
    results: pass1Results,
  },
  pass2_casino_seeds: {
    description: "This experiment extends each of the 202 revealed server seeds to 10,000 nonces on the board of that epoch's lowest-nonce bet. Its early-versus-late slot and payout statistics are consistency checks. The commitment-ordering interpretation for 192 auditor-random-client-seed epochs depends on authentic timing and client-seed unpredictability. Nine epochs, 153-161, used predictable client seeds; epoch 152 remains unresolved. The synthetic fixed-board experiment does not replay the ten mixed-board epochs' actual payout schedule and does not establish universal protection against seed selection.",
    noncesPerSeed: PASS2_NONCES,
    seeds_tested: seedsTested,
    cherryPickFlags,
    expectedFlagsByChance: expectedFlags,
    cherryPickSurvivalP: cherryPickSurvival,
    payoutWeighted: {
      description: 'Window RTP against its exact per-config mean/SD (from the payout table × independent binomial). zEarly/zLate per seed; a short-window bias would push zEarly negative (fewer tail hits).',
      zEarlyMean,
      zEarlySd,
      countZEarlyBelow1645: countZEarlyBelow,
      // SUPERSEDED (FIX-19), retained only so the size of the correction is visible:
      // the naive null assumes zEarly is standard normal. It is not — see calibratedNullNote.
      expectedZEarlyBelow1645: expectedZEarlyBelowNaive,
      zEarlyBelowSurvivalP: zBelowNaiveSurvival,
      // THE SCORED NULL. Computed by src/calibration.ts from the pinned payout tables and
      // the board each revealed epoch ran on; recomputed independently by Step 17.
      expectedZEarlyBelow1645Calibrated: expectedZEarlyBelowCalibrated,
      sdZEarlyBelow1645Calibrated: calibration.sdCalibrated,
      zEarlyBelowCalibratedSurvivalP: zBelowCalibratedSurvival,
      calibratedNullMethod: CALIBRATION_METHOD,
      calibratedNullNote:
        'The window payout sum is a sum of ' + half + ' draws from a right-skewed payout distribution, so the '
        + 'standardised window mean is not normal and P(zEarly < -' + Z_LEFT_TAIL + ') is per-config, not 0.05. '
        + 'Full per-config and per-epoch breakdown in outputs/calibration-results.json (npm run calibrate).',
      meanZEarlyMinusLate: meanDiff,
      seZEarlyMinusLate: seDiff,
      tZEarlyMinusLate: tDiff,
      pTwoSidedZEarlyMinusLate: pTwoSidedDiff,
      edgeHitsEarly,
      edgeHitsLate,
    },
    executionTimeMs: pass2ElapsedMs,
    results: pass2Results,
  },
};

fs.writeFileSync(path.join(OUTPUTS_DIR, 'simulation-results.json'), JSON.stringify(output, null, 2));

// ── RTP convergence chart (running mean RTP per config toward theory) ──────────
// One polyline per config: running mean simulated RTP sampled every CONVERGENCE_STEP
// rounds, over the full 1M-round run. As n grows each trace tightens onto its own
// theoretical RTP; the bold reference line is the equal-weighted theoretical mean.

const W = 920, H = 460, PAD_L = 64, PAD_R = 24, PAD_T = 48, PAD_B = 52;
const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
const allConv = pass1Results.flatMap(r => r.convergence);
const yMinData = Math.min(...allConv, ...pass1Results.map(r => r.theoreticalRTP));
const yMaxData = Math.max(...allConv, ...pass1Results.map(r => r.theoreticalRTP));
// Pad the y-range a touch so no trace touches the frame.
const yPad = (yMaxData - yMinData) * 0.12 || 0.001;
const yMin = yMinData - yPad, yMax = yMaxData + yPad;
const nPts = Math.max(...pass1Results.map(r => r.convergence.length), 1);
const xAt = (i: number) => PAD_L + (nPts <= 1 ? plotW : (i / (nPts - 1)) * plotW);
const yAt = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

const traceColor = (r: Pass1Result) => r.wtf ? '#c0392b' : ['#3b82f6', '#8b5cf6', '#10b981'][r.riskLevel - 1] ?? '#888';
const polylines = pass1Results.map(r => {
  const pts = r.convergence.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="${traceColor(r)}" stroke-width="1" opacity="0.5"/>`;
}).join('\n    ');
const meanTheoY = yAt(meanTheoRTP);
// Y gridlines / labels at 5 evenly spaced RTP levels.
const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
const yGrid = yTicks.map(v => {
  const y = yAt(v).toFixed(1);
  return `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="#eee" stroke-width="1"/>` +
    `<text x="${PAD_L - 8}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${(v * 100).toFixed(2)}%</text>`;
}).join('\n    ');
// X labels: rounds at start / mid / end (in thousands).
const xTicks = [0, Math.floor((nPts - 1) / 2), nPts - 1];
const xGrid = xTicks.map(i => {
  const x = xAt(i).toFixed(1);
  const rounds = ((i + 1) * CONVERGENCE_STEP / 1000);
  return `<text x="${x}" y="${(PAD_T + plotH + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#666">${rounds}k</text>`;
}).join('\n    ');

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>LIQD PLINKO — PASS 1 RTP CONVERGENCE</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 980px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .sub { text-align: center; font-size: 12px; color: #777; margin-bottom: 16px; }
  svg { display: block; width: 100%; height: auto; }
  .legend { display: flex; gap: 18px; justify-content: center; font-size: 12px; color: #555; margin-top: 8px; flex-wrap: wrap; }
  .legend span::before { content: ''; display: inline-block; width: 14px; height: 3px; margin-right: 6px; vertical-align: middle; }
  .lo::before { background: #3b82f6; } .me::before { background: #8b5cf6; } .hi::before { background: #10b981; }
  .wt::before { background: #c0392b; } .th::before { background: #111; }
  .info { color: #555; font-size: 12px; margin-top: 14px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>LIQD Plinko — Pass 1 RTP Convergence</h1>
  <div class="sub">Running mean simulated RTP per configuration vs cumulative rounds (${CONFIGS.length} configs × ${ROUNDS_PER_CONFIG.toLocaleString()} rounds)</div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-config RTP convergence traces">
    <rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#ddd"/>
    ${yGrid}
    ${xGrid}
    ${polylines}
    <line x1="${PAD_L}" y1="${meanTheoY.toFixed(1)}" x2="${PAD_L + plotW}" y2="${meanTheoY.toFixed(1)}" stroke="#111" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="${(PAD_L + plotW).toFixed(1)}" y="${(meanTheoY - 6).toFixed(1)}" text-anchor="end" font-size="11" fill="#111">mean theoretical ${(meanTheoRTP * 100).toFixed(4)}%</text>
    <text x="${(PAD_L + plotW / 2).toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="12" fill="#444">Cumulative rounds</text>
  </svg>
  <div class="legend">
    <span class="lo">Low (risk 1)</span><span class="me">Medium (risk 2)</span><span class="hi">High (risk 3)</span><span class="wt">WTF (risk 4)</span><span class="th">Equal-weighted theoretical mean</span>
  </div>
  <p class="info">Each trace is one configuration's running mean RTP, sampled every ${(CONVERGENCE_STEP / 1000)}k rounds in the saved experiment. The per-configuration theoretical RTP range is 98.9063%–99.1602%; its equal-weighted mean is ${(meanTheoRTP * 100).toFixed(4)}%. Finite-run traces fluctuate around their theoretical values. Replaying the saved seeds reproduces these traces; generating a new experiment uses new seeds and produces different traces.</p>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

const outRel = path.relative(path.join(__dirname, '..'), OUTPUTS_DIR);
console.log('═'.repeat(60));
console.log(`  Written: ${outRel}/simulation-results.json`);
console.log(`  Written: ${outRel}/rtp-convergence.html`);
console.log('  This is a NEW EXPERIMENT with new random seeds, not a re-check of the');
console.log('  published one. To re-execute the ORIGINAL Pass 1 from its saved seeds and');
console.log('  compare, run `npm run replay`.');
console.log('═'.repeat(60) + '\n');

export {};
