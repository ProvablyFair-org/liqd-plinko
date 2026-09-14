/**
 * Replay the saved Pass 1 experiment from its recorded seeds.
 * Compares all numerical results and convergence points without writing evidence.
 * `npm run replay` uses the development toolchain; `node replay.js` is standalone.
 * REPLAY_CONFIGS limits a local diagnostic run and makes it exit nonzero as partial.
 * Floating-point comparisons use relative 1e-12 and absolute 1e-14 tolerances.
 */

import * as fs from 'fs';
import * as path from 'path';

import { generateProvablyFairNumber } from './rng';
import { combination, chiSquaredTest, lag1Autocorrelation, runsTest } from './stats';
import { loadPlinkoConfig, allConfigs, payoutTable, theoreticalRTP, CONVERGENCE_STEP } from './config';

const cfg = loadPlinkoConfig();
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const SIM_PATH = path.join(OUTPUTS_DIR, 'simulation-results.json');

/** Relative tolerance for floating-point statistics; 0 for integers and strings. */
const RTOL = 1e-12;
const ATOL = 1e-14;

function agree(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= ATOL + RTOL * Math.max(Math.abs(a), Math.abs(b));
}

function simulateSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  let slot = 0;
  for (let i = 0; i < rows; i++) slot += generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
  return slot;
}

function binomialExpected(rows: number, n: number): number[] {
  const p = Math.pow(0.5, rows);
  return Array.from({ length: rows + 1 }, (_, k) => combination(rows, k) * p * n);
}

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — PASS 1 HISTORICAL REPLAY');
console.log('  Re-executes the COMMITTED experiment from its saved seeds.');
console.log('  Reads outputs/simulation-results.json. Writes nothing.');
console.log('═'.repeat(60) + '\n');

if (!fs.existsSync(SIM_PATH)) {
  console.error('  [ERROR] outputs/simulation-results.json not found — nothing to replay.');
  process.exit(1);
}

interface Pass1Row {
  rows: number;
  riskLevel: number;
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
  convergence: number[];
}

const sim = JSON.parse(fs.readFileSync(SIM_PATH, 'utf-8'));
const pass1 = sim.pass1_fresh_seeds ?? {};
const rows: Pass1Row[] = pass1.results ?? [];
const roundsPerConfig: number = pass1.roundsPerConfig ?? 0;

// ── The population comes from the PINNED CONFIG, not from the artifact (G-BIND) ──
// A replay that only walks the rows the artifact happens to carry would report a clean
// reproduction of a truncated experiment. The row SET must equal allConfigs(cfg).
const expected = allConfigs(cfg);
const key = (r: number, k: number) => `${r}r/${k}`;
const wantKeys = expected.map(c => key(c.rows, c.riskLevel));
const gotKeys = rows.map(r => key(r.rows, r.riskLevel));
const missing = wantKeys.filter(k => !gotKeys.includes(k));
const strangers = [...new Set(gotKeys.filter(k => !wantKeys.includes(k)))];
const duplicates = [...new Set(gotKeys.filter((k, i) => gotKeys.indexOf(k) !== i))];

const problems: string[] = [];
if (!(roundsPerConfig > 0)) problems.push(`roundsPerConfig is ${roundsPerConfig}`);
if (missing.length) problems.push(`${missing.length} configuration(s) absent from the artifact: ${missing.slice(0, 6).join(', ')}`);
if (strangers.length) problems.push(`${strangers.length} row(s) on a board the config does not declare: ${strangers.join(', ')}`);
if (duplicates.length) problems.push(`${duplicates.length} board(s) present more than once: ${duplicates.join(', ')}`);
if (problems.length) {
  console.error('  [ERROR] the committed Pass 1 artifact is not a replayable experiment:');
  for (const p of problems) console.error(`          ${p}`);
  process.exit(1);
}

// REPLAY_CONFIGS is a LOCAL convenience for a quick smoke run; a partial replay is
// reported as PARTIAL and exits non-zero so it can never be mistaken for the real thing.
const limitEnv = process.env.REPLAY_CONFIGS;
const limit = limitEnv !== undefined ? parseInt(limitEnv, 10) : rows.length;
const partial = !(Number.isFinite(limit) && limit >= rows.length);
const toReplay = partial ? rows.slice(0, Math.max(0, limit)) : rows;

console.log(`  ${toReplay.length}/${rows.length} configurations × ${roundsPerConfig.toLocaleString()} rounds`
  + (partial ? '  [PARTIAL — REPLAY_CONFIGS is set; this is not a publication replay]' : '') + '\n');

const failures: string[] = [];
let fieldsCompared = 0;
let convergencePoints = 0;
let maxRelDiff = 0;
const started = Date.now();

for (let i = 0; i < toReplay.length; i++) {
  const row = toReplay[i];
  const label = key(row.rows, row.riskLevel);
  if (typeof row.serverSeed !== 'string' || typeof row.clientSeed !== 'string'
      || !/^[0-9a-f]{32}$/.test(row.serverSeed) || row.clientSeed.length === 0) {
    failures.push(`${label}: the row carries no usable saved seeds, so it cannot be replayed`);
    continue;
  }

  const table = payoutTable(cfg, row.rows, row.riskLevel);
  const slotFreq = new Array(row.rows + 1).fill(0);
  const winSequence = new Uint8Array(roundsPerConfig);
  let payoutSum = 0;
  const convergence: number[] = [];

  for (let nonce = 0; nonce < roundsPerConfig; nonce++) {
    const slot = simulateSlot(row.serverSeed, row.clientSeed, nonce, row.rows);
    slotFreq[slot]++;
    payoutSum += table[slot];
    winSequence[nonce] = slot > row.rows / 2 ? 0 : 1;
    if ((nonce + 1) % CONVERGENCE_STEP === 0) convergence.push(payoutSum / (nonce + 1));
  }

  const { chi2, df, pValue } = chiSquaredTest([...slotFreq], binomialExpected(row.rows, roundsPerConfig));
  const seq = Array.from(winSequence) as number[];
  const r1 = lag1Autocorrelation(seq);
  const r1Z = r1 * Math.sqrt(roundsPerConfig);
  const { z: runsZ, pValue: runsP } = runsTest(seq);
  const simRTP = payoutSum / roundsPerConfig;
  const theory = theoreticalRTP(cfg, row.rows, row.riskLevel);

  const cmp = (name: string, rec: number, stored: unknown) => {
    fieldsCompared++;
    if (typeof stored !== 'number' || !Number.isFinite(stored) || !agree(rec, stored)) {
      failures.push(`${label} ${name}: replayed ${rec} vs committed ${String(stored)}`);
      return;
    }
    const rel = rec === stored ? 0 : Math.abs(rec - stored) / Math.max(1e-300, Math.abs(rec), Math.abs(stored));
    if (rel > maxRelDiff) maxRelDiff = rel;
  };
  cmp('slotChi2', chi2, row.slotChi2);
  cmp('slotDf', df, row.slotDf);
  cmp('slotPValue', pValue, row.slotPValue);
  cmp('r1', r1, row.r1);
  cmp('r1Z', r1Z, row.r1Z);
  cmp('runsZ', runsZ, row.runsZ);
  cmp('runsPValue', runsP, row.runsPValue);
  cmp('simRTP', simRTP, row.simRTP);
  // Recomputed from the pinned config, so a doctored theory column fails here too.
  cmp('theoreticalRTP', theory, row.theoreticalRTP);

  const storedConv = Array.isArray(row.convergence) ? row.convergence : [];
  if (storedConv.length !== convergence.length) {
    failures.push(`${label} convergence: replayed ${convergence.length} point(s) vs committed ${storedConv.length}`);
  } else {
    for (let j = 0; j < convergence.length; j++) {
      convergencePoints++;
      cmp(`convergence[${j}]`, convergence[j], storedConv[j]);
    }
  }

  process.stdout.write(`\r  replayed ${i + 1}/${toReplay.length} — ${label.padEnd(8)} `
    + `${failures.length === 0 ? 'no differences so far' : `${failures.length} difference(s)`}   `);
}
process.stdout.write('\n\n');

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log('═'.repeat(60));
console.log(`  Configurations replayed: ${toReplay.length}/${rows.length}`);
console.log(`  Numeric fields compared: ${fieldsCompared} (of which ${convergencePoints} convergence points)`);
console.log(`  Max relative difference: ${maxRelDiff.toExponential(3)} (tolerance ${RTOL.toExponential(0)} relative, ${ATOL.toExponential(0)} absolute)`);
console.log(`  Time: ${elapsed}s`);
if (failures.length > 0) {
  console.log(`\n  REPLAY FAILED — ${failures.length} difference(s):`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  if (failures.length > 20) console.log(`    +${failures.length - 20} more`);
  console.log('═'.repeat(60) + '\n');
  process.exit(1);
}
if (partial) {
  console.log('\n  PARTIAL REPLAY — REPLAY_CONFIGS was set, so this is not a reproduction of the');
  console.log('  published experiment. Re-run without REPLAY_CONFIGS.');
  console.log('═'.repeat(60) + '\n');
  process.exit(1);
}
console.log('\n  REPLAY OK — the committed Pass 1 experiment reproduces from its saved seeds.');
console.log('  This is numerical reproducibility. It does not establish who ran the original');
console.log('  experiment or when; that is provenance, and no offline artifact settles it.');
console.log('═'.repeat(60) + '\n');
export {};
