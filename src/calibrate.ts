/**
 * LIQD Plinko — producer for outputs/calibration-results.json.
 * Run: npm run calibrate
 *
 * Computes the CALIBRATED null distribution for Pass 2's payout-weighted count
 * ("how many of the revealed seeds have an early-window RTP below z = −1.645?") and
 * writes it to its own artifact, at two window lengths.
 *
 * The top level is the PRIMARY window — `EXPECTED_EPOCH_SIZE` = 50 nonces, what was played
 * under each server seed in this capture. The capture rotated the seed pair every 50 bets (the
 * dataset header's meta.epochSize = 50; SEED_ROTATE_EVERY = 50 in the capture/ reference scripts);
 * nothing in the captured records shows LIQD limiting a seed pair to 50 bets. These are the
 * drops actually observed under each seed, so this is the window the audit scores, and its
 * observed count is recomputed here from the revealed seeds (`windowStats`), not read out of
 * simulation-results.json, which only ever measured the longer window.
 *
 * `extendedWindow` is the secondary figure: floor(noncesPerSeed / 2) = 5,000 nonces, the
 * synthetic long window Pass 2 extends each seed to. It has far more power against a seed
 * biased across its whole stream and it is kept for that reason, but 5,000 drops is a
 * hundred times what was played under any seed in this capture, so it is reported, not scored.
 *
 * WHY A SEPARATE ARTIFACT, NOT A FIELD IN simulation-results.json
 * ---------------------------------------------------------------
 * The calibrated null is a DETERMINISTIC property of (payout tables, window length,
 * which board each captured epoch ran on). It does not depend on the Monte Carlo at
 * all. Keeping it in its own file has three consequences that matter:
 *
 *   1. It is byte-reproducible — the artifact carries no run metadata at all, so a reader
 *      can regenerate it and diff the bytes. `simulation-results.json` cannot be: Pass 1
 *      draws fresh crypto-random seeds every run by design.
 *   2. It can be produced WITHOUT re-running the 28,000,000-round Pass 1. audit-rules
 *      9.4 forbids re-running a fresh-seed simulation once the report cites its output,
 *      and this fix does not require regenerating it — so the committed Pass 1 artifact
 *      stays exactly the one the external reviewers reproduced.
 *   3. The producer and the verifier read the same `src/calibration.ts`, so the number
 *      in the artifact, the number in the Step 17 detail string and the number in the
 *      chapters all come from one computation.
 *
 * The artifact records the SHA-256 of the simulation artifact it was paired with, so
 * Step 17 can refuse a calibration computed against a different Pass 2 run.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';

import { loadDataset, EXPECTED_DATASET_SHA256, EXPECTED_EPOCH_SIZE } from './loader';
import { loadPlinkoConfig, PLINKO_CONFIG_SHA256 } from './config';
import {
  Z_LEFT_TAIL,
  CALIBRATION_METHOD,
  calibrateLeftTailCount,
  calibratedSurvival,
  countBelowThreshold,
  revealedEpochConfigs,
  revealedSeedsByEpoch,
  windowStats,
} from './calibration';

const DATASET_PATH = path.join(__dirname, '..', 'data', 'plinko-master-10100bets.json');
// Single-sourced in src/loader.ts, like tests/verify.ts and src/simulate.ts.
const EXPECTED_DATASET_HASH = EXPECTED_DATASET_SHA256;
// `SIM_OUT_DIR` binds a calibration to the output set it was computed for. It
// defaults to `outputs` — the canonical set — so the published behaviour is unchanged.
// A fresh experiment writes to `outputs/fresh` (see src/simulate.ts), and its calibration
// must be produced with `SIM_OUT_DIR=outputs/fresh` so the pair stays together; pairing a
// fresh Pass 2 with the canonical calibration, or vice versa, is exactly the "outputs not
// bound to their inputs" defect the ticket names.
const SIM_DIR_REL = process.env.SIM_OUT_DIR ?? 'outputs';
const OUTPUTS_DIR = path.join(__dirname, '..', SIM_DIR_REL);
const SIM_PATH = path.join(OUTPUTS_DIR, 'simulation-results.json');

const cfg = loadPlinkoConfig();
const dataset = loadDataset(DATASET_PATH, EXPECTED_DATASET_HASH);

if (!fs.existsSync(SIM_PATH)) {
  console.error(`ERROR: ${SIM_DIR_REL}/simulation-results.json not found — run \`npm run simulate\` first.`);
  console.error('  The calibration is paired with a specific Pass 2 run (window length + observed count).');
  process.exit(1);
}
const simRaw = fs.readFileSync(SIM_PATH);
const simSha256 = createHash('sha256').update(simRaw).digest('hex');
const sim = JSON.parse(simRaw.toString('utf8'));
const pass2 = sim?.pass2_casino_seeds ?? {};
const pw = pass2?.payoutWeighted ?? {};

const noncesPerSeed = pass2.noncesPerSeed;
const observedCount = pw.countZEarlyBelow1645;
if (typeof noncesPerSeed !== 'number' || !Number.isFinite(noncesPerSeed) || noncesPerSeed <= 0) {
  console.error(`ERROR: pass2_casino_seeds.noncesPerSeed is ${JSON.stringify(noncesPerSeed)} — cannot calibrate.`);
  process.exit(1);
}
if (typeof observedCount !== 'number' || !Number.isInteger(observedCount) || observedCount < 0) {
  console.error(`ERROR: payoutWeighted.countZEarlyBelow1645 is ${JSON.stringify(observedCount)} — cannot calibrate.`);
  process.exit(1);
}

// ── The two windows ──────────────────────────────────────────────────────────
// PRIMARY: the EXPECTED_EPOCH_SIZE nonces played under each seed in this capture (the capture
// tool's rotation setting). They are the only drops observed under any seed, so this is the
// window the audit scores.
// EXTENDED: half the synthetic nonce stream Pass 2 extends each seed to. Retained as a
// secondary figure — far more power against a seed biased across its whole stream — but no
// seed in this capture was played that long, so it is not the result.
const primaryWindowNonces = EXPECTED_EPOCH_SIZE;
const extendedWindowNonces = Math.floor(noncesPerSeed / 2);

// Population from the DATASET, never from the artifact (G-BIND).
const epochs = revealedEpochConfigs(dataset.bets, dataset.seeds);
// The PRIMARY observed count is recomputed here from the revealed seeds rather than read
// from the simulation artifact, which only ever measured the extended window. Same module
// the verifier uses (src/calibration.ts `windowStats`), so the count and the null it is
// scored against cannot come from two different definitions of the statistic.
const seedByEpoch = revealedSeedsByEpoch(dataset.seeds);
const primaryStats = windowStats(cfg, epochs, seedByEpoch, primaryWindowNonces, Z_LEFT_TAIL);
const primaryObservedCount = countBelowThreshold(primaryStats);

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — CALIBRATED NULL FOR THE PAYOUT-WEIGHTED COUNT');
console.log('═'.repeat(60));
console.log(`  Revealed epochs: ${epochs.length}   z = ${Z_LEFT_TAIL}`);
console.log(`  Primary window : ${primaryWindowNonces.toLocaleString()} nonces (played per seed in this capture — scored)`);
console.log(`  Extended window: ${extendedWindowNonces.toLocaleString()} nonces (secondary)`);
console.log(`  Method: ${CALIBRATION_METHOD}`);
console.log('');

const t0 = Date.now();
const calibration = calibrateLeftTailCount(cfg, epochs, primaryWindowNonces, Z_LEFT_TAIL);
const extended = calibrateLeftTailCount(cfg, epochs, extendedWindowNonces, Z_LEFT_TAIL);
const elapsedMs = Date.now() - t0;
const survival = calibratedSurvival(calibration, primaryObservedCount);
const extendedSurvival = calibratedSurvival(extended, observedCount);
const naiveExpectation = calibration.expectedZEarlyBelow1645Naive;

for (const c of calibration.byConfig) {
  const cc = c.crossCheck
    ? `  [cross-check ${c.crossCheck.probability.toExponential(6)}, rel Δ ${c.crossCheck.relativeDifference.toExponential(2)}]`
    : '';
  console.log(
    `  ${c.config.padEnd(6)} ${String(c.epochs).padStart(3)} epoch(s)  `
    + `P(zEarly < −${Z_LEFT_TAIL}) = ${(c.leftTailProbability * 100).toFixed(4)}%  `
    + `(window RTP below ${(c.windowRtpThreshold * 100).toFixed(4)}%, lattice ${c.latticeUnit})${cc}`,
  );
}

console.log('');
console.log(`  PRIMARY (${primaryWindowNonces} nonces — played per seed in this capture)`);
console.log(`    Calibrated expectation : ${calibration.expectedZEarlyBelow1645Calibrated.toFixed(6)} (sd ${calibration.sdCalibrated.toFixed(6)})`);
console.log(`    Naive 0.05·n expectation: ${naiveExpectation.toFixed(6)}`);
console.log(`    Observed count          : ${primaryObservedCount}`);
console.log(`    P(X >= ${primaryObservedCount}) under the calibrated null: ${survival.toFixed(6)}`);
console.log(`  EXTENDED (${extendedWindowNonces} nonces — secondary)`);
console.log(`    Calibrated expectation : ${extended.expectedZEarlyBelow1645Calibrated.toFixed(6)} (sd ${extended.sdCalibrated.toFixed(6)})`);
console.log(`    Observed count          : ${observedCount}`);
console.log(`    P(X >= ${observedCount}) under the calibrated null: ${extendedSurvival.toFixed(6)}`);
console.log(`  Time: ${(elapsedMs / 1000).toFixed(1)}s`);

const output = {
  audit: 'LIQD Plinko',
  artifact: 'calibrated null for the Pass 2 payout-weighted window-RTP count',
  method: calibration.method,
  deterministic: true,
  note:
    'This artifact is deterministic: given plinkoConfig.json, the dataset and the window length it '
    + 'reproduces BYTE-FOR-BYTE. It carries no generation timestamp and no elapsed time, so there is '
    + 'no field a re-run can move and the published SHA-256 is a pin a reader can actually satisfy. '
    + 'It replaces the naive Binom(n, 0.05) null used before revision 2. '
    + 'Step 17 re-derives EVERY NUMERIC FIELD here from src/calibration.ts and FAILS if it '
    + 'disagrees: the method string, the top-line Poisson-binomial summary (expectation, sd, variance, '
    + 'the retained naive expectation, observed count and survival), the dataset/config/simulation '
    + 'source hashes, every byConfig field (rows, riskLevel, epochs, windowNonces, mu, sd, sumThreshold, '
    + 'windowRtpThreshold, latticeUnit, leftTailProbability and the whole crossCheck block, including '
    + 'its legitimate absence where the payout support is too large for the closed form), and all '
    + 'perEpoch rows, whose (rows, riskLevel) are re-derived from the DATASET rather than read here — '
    + 'for the primary window at the top level and for the extendedWindow block alike. '
    + 'The top level is the PRIMARY window: the 50 nonces played under each server seed in this '
    + 'capture (the capture rotated the seed pair every 50 bets; nothing in the captured records '
    + 'shows LIQD limiting a seed pair to 50 bets), whose observed count is recomputed from the revealed '
    + 'seeds, not read from the simulation artifact. '
    + 'extendedWindow is the secondary 5,000/5,000 split Pass 2 measured. '
    + 'Not re-derived: the source[].file path strings and the descriptive strings '
    + 'audit/artifact/note/deterministic/windowScope/extendedWindow.scope. No numeric field, and no '
    + 'timestamp, is exempt — there is no timestamp in this file to exempt.',
  source: {
    dataset: { file: 'data/plinko-master-10100bets.json', sha256: dataset.sha256 },
    config: { file: 'plinkoConfig.json', sha256: PLINKO_CONFIG_SHA256 },
    // the calibration names the output set it was paired with. `outputs` is the
    // canonical set; anything else is a fresh experiment and must not be mixed with it.
    // The SHA-256 is the whole identity of that pairing: it names the exact bytes Step 17
    // and `check-outputs` compare against the file on disk. No timestamp is copied in
    // beside it — a hash identifies the artifact, a clock reading does not.
    simulation: { file: `${SIM_DIR_REL}/simulation-results.json`, sha256: simSha256 },
  },
  zThreshold: calibration.zThreshold,
  noncesPerSeed,
  // ── The scored result: the nonces played under each seed in this capture ────────
  // The top level of this artifact is the PRIMARY calibration, at the capture's epoch size.
  // Its observed count is recomputed here from the revealed seeds; the extended-window
  // block below carries the 5,000/5,000 figures, whose observed count is Pass 2's.
  windowScope: 'primary — the nonces played under each server seed in this capture (EXPECTED_EPOCH_SIZE per seed; the capture rotated the seed pair every 50 bets)',
  windowNonces: calibration.windowNonces,
  epochs: calibration.epochs,
  expectedZEarlyBelow1645Calibrated: calibration.expectedZEarlyBelow1645Calibrated,
  sdZEarlyBelow1645Calibrated: calibration.sdCalibrated,
  varianceZEarlyBelow1645Calibrated: calibration.varianceCalibrated,
  expectedZEarlyBelow1645Naive: naiveExpectation,
  observedZEarlyBelow1645: primaryObservedCount,
  zEarlyBelowCalibratedSurvivalP: survival,
  // No `executionTimeMs` and no `generatedAt`. How long this machine took is a property of
  // the machine, not of the calibration, and a field that moves on every run makes the
  // artifact's published SHA-256 impossible for a reader to reproduce. The elapsed time is
  // printed to the console above, where it costs nobody a pin.
  byConfig: calibration.byConfig,
  perEpoch: calibration.perEpoch,
  // ── Secondary: the extended synthetic window ────────────────────────────────
  extendedWindow: {
    scope:
      'secondary — half of the synthetic nonce stream Pass 2 extends each seed to. More powerful '
      + 'against a seed biased across its whole stream, but 100x longer than what was played under '
      + 'any seed in this capture, so it is reported and not scored.',
    windowNonces: extended.windowNonces,
    epochs: extended.epochs,
    expectedZEarlyBelow1645Calibrated: extended.expectedZEarlyBelow1645Calibrated,
    sdZEarlyBelow1645Calibrated: extended.sdCalibrated,
    varianceZEarlyBelow1645Calibrated: extended.varianceCalibrated,
    expectedZEarlyBelow1645Naive: extended.expectedZEarlyBelow1645Naive,
    observedZEarlyBelow1645: observedCount,
    zEarlyBelowCalibratedSurvivalP: extendedSurvival,
    byConfig: extended.byConfig,
    perEpoch: extended.perEpoch,
  },
};

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUTS_DIR, 'calibration-results.json'), JSON.stringify(output, null, 2));
console.log('');
console.log('  Written: outputs/calibration-results.json');
console.log('═'.repeat(60) + '\n');

export {};
