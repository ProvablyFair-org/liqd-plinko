#!/usr/bin/env node
/**
 * check-outputs — pre-push guard (P0.2)
 *
 * Re-asserts, against the COMMITTED canonical outputs/verification-results.json,
 * that the shipped run is a clean full pass AND that the committed artifacts on disk
 * are the exact ones the canonical run scored. Exits 1 (blocking) unless ALL hold:
 *   - summary.hardFail === 0
 *   - summary.verdict === the Full Pass string
 *   - the scored-step count equals the suite's expected N (EXPECTED_STEPS), AND the entries
 *     are N DISTINCT steps: ids 1..N each exactly once, each under the name tests/steps
 *     declares for it (QA-16 — a count is not an identity)
 *   - the recorded dataset/config pins equal the pins in source (verify.ts / config.ts)
 *     AND equal the live SHA-256 of the committed data/plinko-master-10100bets.json
 *     and plinkoConfig.json (closes the "stale canonical vs re-pinned working tree" hole)
 *   - artifactHashes.config.match === true
 *   - the recorded simulation sha256 equals the live SHA-256 of the committed
 *     outputs/simulation-results.json (the sim artifact scored is the one on disk)
 *   - the same for outputs/calibration-results.json, outputs/verification-stats.json and
 *     outputs/coverage-results.json — all six committed artifacts, none exempt (R3-K5)
 *   - the canonical run was produced in full publication mode: runMode.attest === "full"
 *     and runMode.emitBaseline === false, i.e. no ATTEST_SAMPLE and no EMIT_BASELINE
 *     escape (R3-K4)
 *   - the document describes the WHOLE COMMAND, not just the scored steps (QA-05):
 *     summary.overallStatus === "PASS", summary.completed === true,
 *     summary.validationErrors === [], and summary.scored reconciles with steps[]
 *   - Step 16 recomputed every Pass 1 row's theoretical RTP from the pinned config and
 *     the artifact's header scalars reconcile with its own rows (QA-01)
 *
 * Run it before every push (see AUDIT_CONTEXT.md#reproduction-and-testing).
 *
 * Usage: npm run check-outputs
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'outputs', 'verification-results.json');
const FULL_PASS_VERDICT = 'PROVABLY FAIR — Full Pass';
const EXPECTED_STEPS = 21;

function fail(msg) {
  console.error(`  [check-outputs] FAIL: ${msg}`);
  process.exit(1);
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

if (!fs.existsSync(CANONICAL)) {
  fail(`canonical file missing: ${path.relative(process.cwd(), CANONICAL)}`);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(CANONICAL, 'utf-8'));
} catch (e) {
  fail(`canonical file is not valid JSON: ${e.message}`);
}

const summary = doc.summary ?? {};
const steps = Array.isArray(doc.steps) ? doc.steps : [];
const scored = steps.length;
const failSteps = steps.filter(s => s.status === 'FAIL');
// A clean 21/21 Full Pass means EVERY step is PASS — a FLAG is not a pass. Rejecting only
// FAIL let a hand-edited canonical with one FLAG (passed:20, flags:1) keep the "Full Pass"
// string and slip through; require every step PASS and flags === 0 as well.
const flagSteps = steps.filter(s => s.status !== 'PASS');
const passCount = steps.filter(s => s.status === 'PASS').length;

if (summary.hardFail !== 0) {
  fail(`summary.hardFail is ${summary.hardFail} (expected 0)`);
}
if (failSteps.length !== 0) {
  fail(`${failSteps.length} step(s) have status FAIL: ${failSteps.map(s => s.step).join(', ')}`);
}
if (flagSteps.length !== 0) {
  fail(`${flagSteps.length} step(s) are not PASS: ${flagSteps.map(s => `${s.step}:${s.status}`).join(', ')}`);
}
if (summary.verdict !== FULL_PASS_VERDICT) {
  fail(`verdict is ${JSON.stringify(summary.verdict)} (expected ${JSON.stringify(FULL_PASS_VERDICT)})`);
}
if (scored !== EXPECTED_STEPS) {
  fail(`scored-step count is ${scored} (expected ${EXPECTED_STEPS})`);
}

// ── QA-16 (round-5 client QA, EXECUTED): A COUNT IS NOT AN IDENTITY ───────────
// G-BIND, applied to the step list itself. The check above counted entries, so replacing
// Step 5 — the outcome recomputation, which is the step that re-derives every drop path and
// slot from the seeds — with a second copy of Step 4 produced "21/21 Full Pass" and exit 0
// on a run in which only 20 distinct steps executed. The missing step was the one a reader
// would call the audit.
//
// The fix is to require IDENTITY, not arithmetic: exactly the ids 1..21, each exactly once,
// each carrying the NAME the suite declares for it. The names are parsed out of the step
// modules in `tests/steps/*.ts` — SOURCE, not the artifact being checked — so a duplicate
// renumbered to fill the hole is caught too, and a renamed or renumbered step forces this
// table to be regenerated from the code rather than silently accepted.
const declared = new Map();
{
  const stepsDir = path.join(ROOT, 'tests', 'steps');
  if (!fs.existsSync(stepsDir)) fail('tests/steps is missing — cannot establish the declared step set');
  for (const f of fs.readdirSync(stepsDir).filter(f => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(stepsDir, f), 'utf8');
    for (const m of src.matchAll(/\bstep\(\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
      const id = Number(m[1]);
      const name = m[2].replace(/\\'/g, "'");
      const prev = declared.get(id);
      if (prev !== undefined && prev !== name) {
        fail(`tests/steps declares Step ${id} under two different names (${JSON.stringify(prev)} and ${JSON.stringify(name)}) — the declared step set is ambiguous`);
      }
      declared.set(id, name);
    }
  }
  const declaredIds = [...declared.keys()].sort((a, b) => a - b);
  const wantIds = Array.from({ length: EXPECTED_STEPS }, (_, i) => i + 1);
  if (declaredIds.length !== EXPECTED_STEPS || declaredIds.some((v, i) => v !== wantIds[i])) {
    fail(`tests/steps declares step ids [${declaredIds.join(', ')}] but the suite expects 1..${EXPECTED_STEPS} — `
      + 'the guard cannot check step identity against an incomplete declaration');
  }
}
{
  const seen = new Map();
  for (const s of steps) {
    if (seen.has(s.step)) {
      fail(`Step ${s.step} appears ${seen.get(s.step) + 1} times in the canonical run — `
        + `${scored} entries are present but they are not ${EXPECTED_STEPS} DISTINCT steps. A count is not an identity.`);
    }
    seen.set(s.step, 1);
  }
  const missing = [...declared.keys()].filter(id => !seen.has(id)).sort((a, b) => a - b);
  if (missing.length) {
    fail(`the canonical run has no result for Step ${missing.join(', ')} — that step did not run, or its entry was replaced`);
  }
  const strangers = [...seen.keys()].filter(id => !declared.has(id)).sort((a, b) => a - b);
  if (strangers.length) {
    fail(`the canonical run carries Step ${strangers.join(', ')}, which tests/steps does not declare`);
  }
  const misnamed = steps
    .filter(s => s.name !== declared.get(s.step))
    .map(s => `Step ${s.step} is named ${JSON.stringify(s.name)} but tests/steps declares ${JSON.stringify(declared.get(s.step))}`);
  if (misnamed.length) {
    fail(`${misnamed.length} step(s) do not carry the name the suite declares: ${misnamed.slice(0, 3).join('; ')}`);
  }
}
// Summary counters must be internally consistent with the steps array — a hand edit that
// flips a step status but leaves summary.passed/flags/hardFail untouched (or vice-versa)
// is caught here.
if (summary.passed !== passCount) {
  fail(`summary.passed is ${summary.passed} but ${passCount} steps have status PASS`);
}
if (summary.flags !== flagSteps.length - failSteps.length) {
  fail(`summary.flags is ${summary.flags} but ${flagSteps.length - failSteps.length} steps have status FLAG`);
}
if (summary.hardFail !== failSteps.length) {
  fail(`summary.hardFail is ${summary.hardFail} but ${failSteps.length} steps have status FAIL`);
}
if (passCount !== EXPECTED_STEPS) {
  fail(`only ${passCount}/${EXPECTED_STEPS} steps are PASS`);
}

// ── QA-05: the document must describe the WHOLE COMMAND, not just the scored steps ──
// Round-4 client QA: a run whose emission validation failed wrote a `.failed.json` whose
// CONTENTS still read `passed: 21, hardFail: 0, verdict: "PROVABLY FAIR — Full Pass"`,
// because the report was constructed before the final guard and written unchanged. The
// verifier now finalises status after every required validation and records it; this
// re-asserts that record on the canonical file, so a document that merely LOOKS like a
// pass cannot be published as one.
if (summary.overallStatus !== 'PASS') {
  fail(`summary.overallStatus is ${JSON.stringify(summary.overallStatus)} (expected "PASS") — regenerate with the current verify.ts`);
}
if (summary.completed !== true) {
  fail(`summary.completed is ${JSON.stringify(summary.completed)} (expected true) — the canonical run did not complete every required validation`);
}
if (!Array.isArray(summary.validationErrors) || summary.validationErrors.length !== 0) {
  fail(`summary.validationErrors is ${JSON.stringify(summary.validationErrors)} (expected [])`);
}
if (summary.scoredVerdict !== FULL_PASS_VERDICT) {
  fail(`summary.scoredVerdict is ${JSON.stringify(summary.scoredVerdict)} (expected ${JSON.stringify(FULL_PASS_VERDICT)})`);
}
const scoredBlock = summary.scored ?? {};
if (scoredBlock.passed !== passCount || scoredBlock.hardFail !== failSteps.length
    || scoredBlock.flags !== flagSteps.length - failSteps.length || scoredBlock.of !== scored) {
  fail(`summary.scored ${JSON.stringify(scoredBlock)} does not reconcile with the steps array `
    + `(${passCount} PASS, ${flagSteps.length - failSteps.length} FLAG, ${failSteps.length} FAIL, ${scored} scored)`);
}

// ── QA-01: the Pass 1 theory column was recomputed from the pinned config ──────
// Step 16 now derives each row's theoretical RTP from plinkoConfig.json instead of
// trusting the artifact's own column, and records how many rows survived that comparison
// plus whether the header scalars and convergence traces reconcile. A canonical run that
// predates the fix, or one where the reconciliation did not hold, must not be published.
const s16 = steps.find(s => s.step === 16);
const d16 = s16?.data ?? {};
if (typeof d16.theoryRowsAgreeingWithPinnedConfig !== 'number' || typeof d16.resultRows !== 'number') {
  fail('Step 16 data is missing theoryRowsAgreeingWithPinnedConfig/resultRows — regenerate outputs with the current verify.ts');
}
if (d16.theoryRowsAgreeingWithPinnedConfig !== d16.resultRows || !(d16.resultRows > 0)) {
  fail(`Step 16 recomputed the theoretical RTP for only ${d16.theoryRowsAgreeingWithPinnedConfig} of ${d16.resultRows} Pass 1 rows`);
}
if (d16.aggregatesReconcile !== true) {
  fail(`Step 16 data.aggregatesReconcile is ${JSON.stringify(d16.aggregatesReconcile)} (expected true) — the simulation artifact's header scalars do not reconcile with its own rows`);
}

// ── QA-13: value domains on the canonical artifact itself ─────────────────────
// Steps 16/17 domain-check the artifacts they consume and Step 20 domain-checks the two
// committed emission artifacts, but `verification-results.json` is written AFTER the last
// step runs, so no step can validate the copy its own run produced. The invariants that
// matter here are already enforced above by exact reconciliation against a recomputed
// truth (counters vs the steps array, 21/21, overallStatus/completed). What was still
// missing was the raw impossibility check — the shape that let `totalConfigs = -1` through
// on the coverage artifact — so the counters and step numbers are bounds-checked directly.
// Bounds come from EXPECTED_STEPS and the steps array length, never from the summary.
const nonNegInt = (v) => Number.isInteger(v) && v >= 0;
for (const [k, v] of [['passed', summary.passed], ['flags', summary.flags], ['hardFail', summary.hardFail]]) {
  if (!nonNegInt(v) || v > scored) {
    fail(`summary.${k} is ${JSON.stringify(v)} — not an integer in [0, ${scored}]; a count outside its physical range is impossible, not merely wrong`);
  }
}
for (const s of steps) {
  if (!Number.isInteger(s.step) || s.step < 1 || s.step > EXPECTED_STEPS) {
    fail(`a step is numbered ${JSON.stringify(s.step)} — outside [1, ${EXPECTED_STEPS}]`);
  }
  if (!['PASS', 'FLAG', 'FAIL'].includes(s.status)) {
    fail(`step ${s.step} has status ${JSON.stringify(s.status)}, which is not PASS/FLAG/FAIL`);
  }
}

// ── Artifact-pin consistency (FIX-18) ─────────────────────────────────────────
const ah = doc.artifactHashes ?? {};

// Pins as declared in source. Each has exactly ONE definition — the dataset pin in
// src/loader.ts, the config pin in src/config.ts — and this guard reads them from there.
const loaderTs = fs.readFileSync(path.join(ROOT, 'src', 'loader.ts'), 'utf8');
const configTs = fs.readFileSync(path.join(ROOT, 'src', 'config.ts'), 'utf8');
const datasetPin = (loaderTs.match(/EXPECTED_DATASET_SHA256\s*=\s*'([0-9a-f]{64})'/) ?? [])[1];
const configPin = (configTs.match(/PLINKO_CONFIG_SHA256\s*=\s*'([0-9a-f]{64})'/) ?? [])[1];
if (!datasetPin) fail('could not read EXPECTED_DATASET_SHA256 from src/loader.ts');
if (!configPin) fail('could not read PLINKO_CONFIG_SHA256 from src/config.ts');

// Recorded dataset pin must equal the source pin AND the live file hash.
if (ah.dataset?.sha256 !== datasetPin) {
  fail(`recorded dataset sha256 ${ah.dataset?.sha256} != source pin ${datasetPin}`);
}
const liveDatasetSha = sha256File(path.join(ROOT, 'data', 'plinko-master-10100bets.json'));
if (liveDatasetSha !== datasetPin) {
  fail(`committed dataset sha256 ${liveDatasetSha} != pin ${datasetPin}`);
}

// Config: recorded match flag AND live file hash vs pin.
if (ah.config?.match !== true) {
  fail(`artifactHashes.config.match is ${ah.config?.match} (expected true)`);
}
const liveConfigSha = sha256File(path.join(ROOT, 'plinkoConfig.json'));
if (liveConfigSha !== configPin) {
  fail(`committed plinkoConfig.json sha256 ${liveConfigSha} != pin ${configPin}`);
}

// Simulation artifact: the sha256 the run recorded must equal the file on disk.
if (!ah.simulation || typeof ah.simulation.sha256 !== 'string') {
  fail('artifactHashes.simulation.sha256 missing — regenerate outputs with the current verify.ts');
}
const liveSimSha = sha256File(path.join(ROOT, 'outputs', 'simulation-results.json'));
if (ah.simulation.sha256 !== liveSimSha) {
  fail(`recorded simulation sha256 ${ah.simulation.sha256} != committed outputs/simulation-results.json ${liveSimSha}`);
}

// Calibration artifact (FIX-19): Step 17's scored null is computed against it, so the same
// treatment as the simulation artifact — it must exist, be the file the canonical run
// scored, and be paired with the committed simulation artifact and dataset.
const calPath = path.join(ROOT, 'outputs', 'calibration-results.json');
if (!fs.existsSync(calPath)) {
  fail('outputs/calibration-results.json missing — run `npm run calibrate`');
}
if (!ah.calibration || typeof ah.calibration.sha256 !== 'string') {
  fail('artifactHashes.calibration.sha256 missing — regenerate outputs with the current verify.ts');
}
const liveCalSha = sha256File(calPath);
if (ah.calibration.sha256 !== liveCalSha) {
  fail(`recorded calibration sha256 ${ah.calibration.sha256} != committed outputs/calibration-results.json ${liveCalSha}`);
}
let cal;
try {
  cal = JSON.parse(fs.readFileSync(calPath, 'utf-8'));
} catch (e) {
  fail(`outputs/calibration-results.json is not valid JSON: ${e.message}`);
}
if (cal.source?.simulation?.sha256 !== liveSimSha) {
  fail(`calibration was computed against simulation ${cal.source?.simulation?.sha256} != committed ${liveSimSha}`);
}
if (cal.source?.dataset?.sha256 !== datasetPin) {
  fail(`calibration dataset sha256 ${cal.source?.dataset?.sha256} != pin ${datasetPin}`);
}
if (!Number.isFinite(cal.expectedZEarlyBelow1645Calibrated) || !Number.isFinite(cal.zEarlyBelowCalibratedSurvivalP)) {
  fail('calibration artifact is missing expectedZEarlyBelow1645Calibrated / zEarlyBelowCalibratedSurvivalP');
}

// ── Derived emission artifacts (R3-K5) ────────────────────────────────────────
// Round-3 external review: this guard pinned four artifacts and IGNORED the other two —
// `outputs/verification-stats.json`, which evidence.md declares to be THE producing
// artifact for the figures quoted in the chapters, and `outputs/coverage-results.json`.
// Neither had a pin, a presence check or an `artifactHashes` entry, so forging both and
// running this script returned OK, exit 0. They get the same treatment as the rest: the
// hash the canonical run recorded must equal the file on disk.
for (const [key, rel] of [
  ['verificationStats', 'outputs/verification-stats.json'],
  ['coverage', 'outputs/coverage-results.json'],
]) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(`${rel} missing — run \`npm run verify\``);
  }
  if (!ah[key] || typeof ah[key].sha256 !== 'string') {
    fail(`artifactHashes.${key}.sha256 missing — regenerate outputs with the current verify.ts`);
  }
  const live = sha256File(p);
  if (ah[key].sha256 !== live) {
    fail(`recorded ${key} sha256 ${ah[key].sha256} != committed ${rel} ${live}`);
  }
}

// ── Run mode (R3-K4) ──────────────────────────────────────────────────────────
// `ATTEST_SAMPLE=<n>` and `EMIT_BASELINE=1` are local-only escapes. Before this check the
// only thing keeping them off the publication path was a comment in the source asking
// nicely: `ATTEST_SAMPLE=2 npm run verify` produced a 21/21 Full Pass that this script
// signed off, with Step 17 having recomputed 2 of 202 epochs.
const runMode = doc.runMode ?? {};
if (runMode.attest !== 'full') {
  fail(`runMode.attest is ${JSON.stringify(runMode.attest)} (expected "full") — the canonical run used ATTEST_SAMPLE. `
    + 'Re-run `npm run verify` with no ATTEST_SAMPLE set.');
}
if (runMode.emitBaseline !== false) {
  fail(`runMode.emitBaseline is ${JSON.stringify(runMode.emitBaseline)} (expected false) — the canonical run was produced with `
    + 'EMIT_BASELINE=1, which SKIPS the emission-divergence guard. Re-run `npm run verify` with it unset.');
}
// Belt and braces: the scored step must itself carry the mode, not just the header.
const s17 = steps.find(s => s.step === 17);
if (!s17 || !s17.data || s17.data.attestMode !== 'full') {
  fail(`Step 17 data.attestMode is ${JSON.stringify(s17?.data?.attestMode)} (expected "full")`);
}
if (s17.data.attestChecked !== s17.data.attestPopulation || !(s17.data.attestChecked > 0)) {
  fail(`Step 17 attested ${s17.data.attestChecked} of ${s17.data.attestPopulation} epochs`);
}

console.log(`  [check-outputs] OK: ${scored}/${EXPECTED_STEPS} steps, hardFail 0, verdict "${summary.verdict}"`);
console.log(`  [check-outputs] step identity OK: ids 1..${EXPECTED_STEPS} each present exactly once, every name matching the ${declared.size} step(s) declared in tests/steps/`);
console.log(`  [check-outputs] run outcome OK: overallStatus=${summary.overallStatus}, completed=${summary.completed}, validationErrors=${summary.validationErrors.length}, scoredVerdict="${summary.scoredVerdict}"`);
console.log(`  [check-outputs] Pass 1 theory OK: ${d16.theoryRowsAgreeingWithPinnedConfig}/${d16.resultRows} rows recomputed from the pinned config at ${Number(d16.theoryRecomputeTolerance).toExponential(0)}, header scalars and convergence traces reconcile`);
console.log(`  [check-outputs] pins OK: dataset ${datasetPin.slice(0, 12)}…, config ${configPin.slice(0, 12)}…, sim ${liveSimSha.slice(0, 12)}…, calibration ${liveCalSha.slice(0, 12)}…`);
console.log(`  [check-outputs] emissions OK: verification-stats ${ah.verificationStats.sha256.slice(0, 12)}…, coverage-results ${ah.coverage.sha256.slice(0, 12)}…`);
console.log(`  [check-outputs] run mode OK: attest=${runMode.attest} (${s17.data.attestChecked}/${s17.data.attestPopulation} epochs), emitBaseline=${runMode.emitBaseline}`);
console.log(`  [check-outputs] calibrated null: expected ${cal.expectedZEarlyBelow1645Calibrated.toFixed(6)} vs observed ${cal.observedZEarlyBelow1645}, P(X>=obs)=${cal.zEarlyBelowCalibratedSurvivalP.toFixed(6)}`);
process.exit(0);
