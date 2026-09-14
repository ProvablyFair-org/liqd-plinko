/**
 * LIQD Plinko — producer for outputs/calibration-results.json (FIX-19).
 * Run: npm run calibrate
 *
 * Computes the CALIBRATED null distribution for Pass 2's payout-weighted count
 * ("how many of the revealed seeds have an early-window RTP below z = −1.645?") and
 * writes it to its own artifact.
 *
 * WHY A SEPARATE ARTIFACT, NOT A FIELD IN simulation-results.json
 * ---------------------------------------------------------------
 * The calibrated null is a DETERMINISTIC property of (payout tables, window length,
 * which board each captured epoch ran on). It does not depend on the Monte Carlo at
 * all. Keeping it in its own file has three consequences that matter:
 *
 *   1. It is byte-reproducible (modulo `generatedAt`), so a reader can regenerate it
 *      and diff. `simulation-results.json` cannot be: Pass 1 draws fresh crypto-random
 *      seeds every run by design.
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

import { loadDataset, EXPECTED_DATASET_SHA256 } from './loader';
import { loadPlinkoConfig, PLINKO_CONFIG_SHA256 } from './config';
import {
  Z_LEFT_TAIL,
  CALIBRATION_METHOD,
  calibrateLeftTailCount,
  calibratedSurvival,
  revealedEpochConfigs,
} from './calibration';

const DATASET_PATH = path.join(__dirname, '..', 'data', 'plinko-master-10100bets.json');
// Single-sourced in src/loader.ts, like tests/verify.ts and src/simulate.ts.
const EXPECTED_DATASET_HASH = EXPECTED_DATASET_SHA256;
// QA-03: `SIM_OUT_DIR` binds a calibration to the output set it was computed for. It
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

// The statistic is computed on the EARLY window, which is half the nonce stream —
// exactly as src/simulate.ts splits it.
const windowNonces = Math.floor(noncesPerSeed / 2);

// Population from the DATASET, never from the artifact (G-BIND).
const epochs = revealedEpochConfigs(dataset.bets, dataset.seeds);

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — CALIBRATED NULL FOR THE PAYOUT-WEIGHTED COUNT');
console.log('═'.repeat(60));
console.log(`  Revealed epochs: ${epochs.length}   window: ${windowNonces.toLocaleString()} nonces   z = ${Z_LEFT_TAIL}`);
console.log(`  Method: ${CALIBRATION_METHOD}`);
console.log('');

const t0 = Date.now();
const calibration = calibrateLeftTailCount(cfg, epochs, windowNonces, Z_LEFT_TAIL);
const elapsedMs = Date.now() - t0;
const survival = calibratedSurvival(calibration, observedCount);
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
console.log(`  Calibrated expectation : ${calibration.expectedZEarlyBelow1645Calibrated.toFixed(6)} (sd ${calibration.sdCalibrated.toFixed(6)})`);
console.log(`  Naive 0.05·n expectation: ${naiveExpectation.toFixed(6)}`);
console.log(`  Observed count          : ${observedCount}`);
console.log(`  P(X >= ${observedCount}) under the calibrated null: ${survival.toFixed(6)}`);
console.log(`  Time: ${(elapsedMs / 1000).toFixed(1)}s`);

const output = {
  audit: 'LIQD Plinko',
  artifact: 'calibrated null for the Pass 2 payout-weighted window-RTP count',
  generatedAt: new Date().toISOString(),
  method: calibration.method,
  deterministic: true,
  note: "The calibration uses exact lattice convolution and Poisson-binomial aggregation. Step 17 re-derives the method, source hashes, per-configuration values, per-epoch assignments and numerical summaries, including closed-form cross-checks where applicable. Capture and execution timestamps, measured runtime and descriptive metadata are not numerical calibration checks.",
  source: {
    dataset: { file: 'data/plinko-master-10100bets.json', sha256: dataset.sha256 },
    config: { file: 'plinkoConfig.json', sha256: PLINKO_CONFIG_SHA256 },
    // QA-03: the calibration names the output set it was paired with. `outputs` is the
    // canonical set; anything else is a fresh experiment and must not be mixed with it.
    simulation: { file: `${SIM_DIR_REL}/simulation-results.json`, sha256: simSha256, generatedAt: sim?.generatedAt ?? null },
  },
  zThreshold: calibration.zThreshold,
  noncesPerSeed,
  windowNonces: calibration.windowNonces,
  epochs: calibration.epochs,
  expectedZEarlyBelow1645Calibrated: calibration.expectedZEarlyBelow1645Calibrated,
  sdZEarlyBelow1645Calibrated: calibration.sdCalibrated,
  varianceZEarlyBelow1645Calibrated: calibration.varianceCalibrated,
  expectedZEarlyBelow1645Naive: naiveExpectation,
  observedZEarlyBelow1645: observedCount,
  zEarlyBelowCalibratedSurvivalP: survival,
  executionTimeMs: elapsedMs,
  byConfig: calibration.byConfig,
  perEpoch: calibration.perEpoch,
};

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUTS_DIR, 'calibration-results.json'), JSON.stringify(output, null, 2));
console.log('');
console.log('  Written: outputs/calibration-results.json');
console.log('═'.repeat(60) + '\n');

export {};
