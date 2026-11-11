#!/usr/bin/env node
/**
 * check-outputs — pre-push guard (P0.2)
 *
 * Re-asserts, against the COMMITTED canonical outputs/verification-results.json,
 * that the shipped run is a clean full pass (or RTP FIGURE OVERSTATED, see below) AND that the
 * committed artifacts on disk are the exact ones the canonical run scored. Exits 1 (blocking)
 * unless ALL hold:
 *   - summary.hardFail === 0
 *   - summary.verdict === the Full Pass string, or "RTP FIGURE OVERSTATED" when (and only when)
 *     the RTP-claim step (src/rtp-settings.ts RTP_CLAIM_STEP) is the one OVERSTATED step and the
 *     committed outputs/rtp-claim-table.json records the miss (outcome FAIL)
 *   - the scored-step count equals the suite's expected N (EXPECTED_STEPS), AND the entries
 *     are N DISTINCT steps: ids 1..N each exactly once, each under the name tests/steps
 * declares for it (— a count is not an identity)
 *   - the recorded dataset/config pins equal the pins in source (verify.ts / config.ts)
 *     AND equal the live SHA-256 of the committed scored dataset (src/loader.ts DATASET_FILE)
 *     and plinkoConfig.json (closes the "stale canonical vs re-pinned working tree" hole)
 *   - artifactHashes.config.match === true
 *   - the recorded simulation sha256 equals the live SHA-256 of the committed
 *     outputs/simulation-results.json (the sim artifact scored is the one on disk)
 *   - the same for outputs/calibration-results.json, outputs/verification-stats.json and
 *     outputs/coverage-results.json — all six committed artifacts, none exempt (R3-K5)
 *   - the canonical run was produced in full publication mode: runMode.attest === "full"
 *     and runMode.emitBaseline === false, i.e. no ATTEST_SAMPLE and no EMIT_BASELINE
 *     escape (R3-K4)
 * - the document describes the WHOLE COMMAND, not just the scored steps:
 *     outcome.overallStatus === "PASS", outcome.completed === true,
 *     outcome.validationErrors === [], and outcome.scored reconciles with steps[]
 *   - summary.operatorFlags + summary.captureFlags === summary.flags
 *   - Step 16 recomputed every Pass 1 row's theoretical RTP from the pinned config and
 * the artifact's header scalars reconcile with its own rows
 *
 * Run it before every push (see MANIFEST.md#reproduce-the-audit / README).
 *
 * Usage: npm run check-outputs
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'outputs', 'verification-results.json');
const FULL_PASS_VERDICT = 'PROVABLY FAIR — Full Pass';
/**
 * RTP FIGURE OVERSTATED is a shippable verdict (Methodology v1.1, RTP-CLAIM 1.2.0,
 * 2026-10-14; keno's release manifest takes the same position). An enforced RTP-CLAIM miss marks the
 * RTP-claim step OVERSTATED, which is not a hard fail: the audit publishes that verdict, exit 5.
 * Accepted here only in its exact shape: one OVERSTATED step, it is the step carrying PLINKO-19
 * (RTP_CLAIM_STEP, read from src/rtp-settings.ts), every other step PASS (or INFO on an
 * informational step), the verdict string is this one, and the committed rule table records the
 * miss. A hard fail is still refused, and so is a FLAG (this package's own rule: no Conditional
 * Pass is pushed).
 */
const OVERSTATED_VERDICT = 'RTP FIGURE OVERSTATED';
// The suite's own step count, single-sourced in tests/steps/context.ts (tests/verify.ts holds every run to it).
const EXPECTED_STEPS = Number((fs.readFileSync(path.join(ROOT, 'tests', 'steps', 'context.ts'), 'utf8')
  .match(/export const EXPECTED_STEPS = (\d+);/) ?? [])[1]);
if (!Number.isInteger(EXPECTED_STEPS) || EXPECTED_STEPS <= 0) {
  console.error('  [check-outputs] FAIL: could not read EXPECTED_STEPS from tests/steps/context.ts');
  process.exit(1);
}
/**
 * Steps whose profile policy is INFORMATIONAL: they report PASS or INFO and can never FLAG or
 * FAIL. Step 21, the epoch-window slot fit (PLINKO-22; informational in every package since the
 * 2026-09-29 decision — tests/steps/live-fit.ts). An INFO on one of these is a reported deviation
 * that does not stop a Full Pass, exactly as tests/verify.ts scores it. An INFO on any other step
 * is impossible by construction and is refused.
 */
const INFORMATIONAL_STEPS = [21];

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
const outcome = doc.outcome ?? {};
const steps = Array.isArray(doc.steps) ? doc.steps : [];
const scored = steps.length;
const failSteps = steps.filter(s => s.status === 'FAIL');
// A clean Full Pass means every scored step is PASS — a FLAG is not a pass. Rejecting only
// FAIL let a hand-edited canonical with one FLAG (passed:20, flags:1) keep the "Full Pass"
// string and slip through; require every step PASS and flags === 0 as well. The one exception is
// INFO on an INFORMATIONAL step (INFORMATIONAL_STEPS above): reported, never counted, and it does
// not stop a Full Pass. Every rule below follows that one policy: the
// filter here, the pass count and the status-domain check below treat INFO the same way.
const infoSteps = steps.filter(s => s.status === 'INFO');
const overstatedSteps = steps.filter(s => s.status === 'OVERSTATED');
const flagSteps = steps.filter(s => s.status !== 'PASS' && s.status !== 'INFO' && s.status !== 'OVERSTATED');
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
// The RTP-claim step, from source (never from the artifact being checked).
const RTP_CLAIM_STEP = Number((fs.readFileSync(path.join(ROOT, 'src', 'rtp-settings.ts'), 'utf8')
  .match(/export const RTP_CLAIM_STEP\s*=\s*(\d+)/) ?? [])[1]);
if (!Number.isInteger(RTP_CLAIM_STEP) || RTP_CLAIM_STEP < 1) fail('could not read RTP_CLAIM_STEP from src/rtp-settings.ts');
const wantVerdict = overstatedSteps.length ? OVERSTATED_VERDICT : FULL_PASS_VERDICT;
if (overstatedSteps.length > 1 || overstatedSteps.some(s => s.step !== RTP_CLAIM_STEP)) {
  fail(`step(s) ${overstatedSteps.map(s => s.step).join(', ')} are OVERSTATED; only the RTP-claim step ${RTP_CLAIM_STEP} can be`);
}
if (summary.verdict !== wantVerdict) {
  fail(`verdict is ${JSON.stringify(summary.verdict)} (expected ${JSON.stringify(wantVerdict)}`
    + `${overstatedSteps.length ? ` — Step ${RTP_CLAIM_STEP} is OVERSTATED` : ''})`);
}
{
  // The OVERSTATED status must be the committed rule table's own outcome, both ways: a step marked
  // OVERSTATED over a table that holds, or a Full Pass over a table that records a miss, is refused.
  const tablePath = path.join(ROOT, 'outputs', 'rtp-claim-table.json');
  let table;
  try { table = JSON.parse(fs.readFileSync(tablePath, 'utf8')); } catch (e) { fail(`outputs/rtp-claim-table.json unreadable: ${e.message}`); }
  const miss = table.outcome === 'FAIL';
  if (miss !== (overstatedSteps.length === 1)) {
    fail(`outputs/rtp-claim-table.json outcome is ${JSON.stringify(table.outcome)} but Step ${RTP_CLAIM_STEP} is `
      + `${JSON.stringify(steps.find(s => s.step === RTP_CLAIM_STEP)?.status)} — the step's status and the rule table disagree`);
  }
}
if (scored !== EXPECTED_STEPS) {
  fail(`scored-step count is ${scored} (expected ${EXPECTED_STEPS})`);
}

// ── (EXECUTED): A COUNT IS NOT AN IDENTITY ───────────
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
// The one summary shape: flags = operatorFlags + captureFlags.
if (summary.operatorFlags + summary.captureFlags !== summary.flags) {
  fail(`summary.flags ${summary.flags} is not operatorFlags ${summary.operatorFlags} + captureFlags ${summary.captureFlags}`);
}
if (passCount + infoSteps.length + overstatedSteps.length !== EXPECTED_STEPS) {
  fail(`only ${passCount}/${EXPECTED_STEPS} steps are PASS`
    + (infoSteps.length ? ` and ${infoSteps.length} INFO (informational)` : '')
    + (overstatedSteps.length ? ` and ${overstatedSteps.length} OVERSTATED` : ''));
}

// ── the document must describe the WHOLE COMMAND, not just the scored steps ──
// A run whose emission validation failed could write a `.failed.json` whose
// CONTENTS still read `passed: 21, hardFail: 0, verdict: "PROVABLY FAIR — Full Pass"`,
// because the report was constructed before the final guard and written unchanged. The
// verifier now finalises status after every required validation and records it; this
// re-asserts that record on the canonical file, so a document that merely LOOKS like a
// pass cannot be published as one.
if (outcome.overallStatus !== 'PASS') {
  fail(`outcome.overallStatus is ${JSON.stringify(outcome.overallStatus)} (expected "PASS") — regenerate with the current verify.ts`);
}
if (outcome.completed !== true) {
  fail(`outcome.completed is ${JSON.stringify(outcome.completed)} (expected true) — the canonical run did not complete every required validation`);
}
if (!Array.isArray(outcome.validationErrors) || outcome.validationErrors.length !== 0) {
  fail(`outcome.validationErrors is ${JSON.stringify(outcome.validationErrors)} (expected [])`);
}
if (outcome.scoredVerdict !== wantVerdict) {
  fail(`outcome.scoredVerdict is ${JSON.stringify(outcome.scoredVerdict)} (expected ${JSON.stringify(wantVerdict)})`);
}
const scoredBlock = outcome.scored ?? {};
if (scoredBlock.passed !== passCount || scoredBlock.hardFail !== failSteps.length
    || scoredBlock.flags !== flagSteps.length - failSteps.length || scoredBlock.of !== scored) {
  fail(`outcome.scored ${JSON.stringify(scoredBlock)} does not reconcile with the steps array `
    + `(${passCount} PASS, ${flagSteps.length - failSteps.length} FLAG, ${failSteps.length} FAIL, ${scored} scored)`);
}

// ── the Pass 1 theory column was recomputed from the pinned config ──────
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

// ── value domains on the canonical artifact itself ─────────────────────
// Steps 16/17 domain-check the artifacts they consume and Step 20 domain-checks the two
// committed emission artifacts, but `verification-results.json` is written AFTER the last
// step runs, so no step can validate the copy its own run produced. The invariants that
// matter here are already enforced above by exact reconciliation against a recomputed
// truth (counters vs the steps array, 21/21, overallStatus/completed). What was still
// missing was the raw impossibility check — the shape that let `totalConfigs = -1` through
// on the coverage artifact — so the counters and step numbers are bounds-checked directly.
// Bounds come from EXPECTED_STEPS and the steps array length, never from the summary.
const nonNegInt = (v) => Number.isInteger(v) && v >= 0;
for (const [k, v] of [['passed', summary.passed], ['flags', summary.flags], ['operatorFlags', summary.operatorFlags], ['captureFlags', summary.captureFlags], ['hardFail', summary.hardFail]]) {
  if (!nonNegInt(v) || v > scored) {
    fail(`summary.${k} is ${JSON.stringify(v)} — not an integer in [0, ${scored}]; a count outside its physical range is impossible, not merely wrong`);
  }
}
for (const s of steps) {
  if (!Number.isInteger(s.step) || s.step < 1 || s.step > EXPECTED_STEPS) {
    fail(`a step is numbered ${JSON.stringify(s.step)} — outside [1, ${EXPECTED_STEPS}]`);
  }
  if (s.status === 'INFO' && !INFORMATIONAL_STEPS.includes(s.step)) {
    fail(`step ${s.step} has status "INFO", but only the informational step(s) ${INFORMATIONAL_STEPS.join(', ')} can report INFO`);
  }
  if (!['PASS', 'FLAG', 'FAIL', 'INFO', 'OVERSTATED'].includes(s.status)) {
    fail(`step ${s.step} has status ${JSON.stringify(s.status)}, which is not PASS/FLAG/FAIL/INFO/OVERSTATED`);
  }
}

// ── Artifact-pin consistency ─────────────────────────────────────────
const ah = doc.artifactHashes ?? {};

// Pins as declared in source. Each has exactly ONE definition — the dataset pin in
// src/loader.ts, the config pin in src/config.ts — and this guard reads them from there.
const loaderTs = fs.readFileSync(path.join(ROOT, 'src', 'loader.ts'), 'utf8');
const configTs = fs.readFileSync(path.join(ROOT, 'src', 'config.ts'), 'utf8');
const datasetPin = (loaderTs.match(/EXPECTED_DATASET_SHA256\s*=\s*'([0-9a-f]{64})'/) ?? [])[1];
const configPin = (configTs.match(/PLINKO_CONFIG_SHA256\s*=\s*'([0-9a-f]{64})'/) ?? [])[1];
if (!datasetPin) fail('could not read EXPECTED_DATASET_SHA256 from src/loader.ts');
// The scored Pass 2 window — the first 50 nonces of every server seed in this capture, the shortest
// epoch of the capture plan — read from the same source of truth for the same
// reason: this script must not carry its own copy of a constant the audit declares in code.
const PRIMARY_WINDOW_NONCES = Number((loaderTs.match(/PRIMARY_WINDOW_NONCES\s*=\s*(\d+)/) ?? [])[1]);
if (!Number.isInteger(PRIMARY_WINDOW_NONCES) || PRIMARY_WINDOW_NONCES <= 0) fail('could not read PRIMARY_WINDOW_NONCES from src/loader.ts');
if (!configPin) fail('could not read PLINKO_CONFIG_SHA256 from src/config.ts');

// Recorded dataset pin must equal the source pin AND the live file hash.
if (ah.dataset?.sha256 !== datasetPin) {
  fail(`recorded dataset sha256 ${ah.dataset?.sha256} != source pin ${datasetPin}`);
}
const DATASET_FILE = (loaderTs.match(/export const DATASET_FILE = '([^']+)'/) ?? [])[1];
if (!DATASET_FILE) fail('could not read DATASET_FILE from src/loader.ts');
const liveDatasetSha = sha256File(path.join(ROOT, DATASET_FILE ?? 'missing'));
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

// Calibration artifact: Step 17's scored null is computed against it, so the same
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
// The top level of this artifact is the PRIMARY window — the first 50 nonces played under each seed in
// this capture (the capture tool's rotation setting, not a rule shown to be LIQD's) — and the
// 5,000-nonce split lives in `extendedWindow`. Both are published, so a copy of the artifact that
// has quietly lost the secondary block is not the record.
if (cal.windowNonces !== PRIMARY_WINDOW_NONCES) {
  fail(`calibration windowNonces ${cal.windowNonces} != PRIMARY_WINDOW_NONCES ${PRIMARY_WINDOW_NONCES} — the scored window must be the first nonces every seed in this capture played`);
}
if (!cal.extendedWindow || !Number.isFinite(cal.extendedWindow.expectedZEarlyBelow1645Calibrated)
    || !Number.isFinite(cal.extendedWindow.zEarlyBelowCalibratedSurvivalP)) {
  fail('calibration artifact is missing the secondary extendedWindow block');
}

// ── Derived emission artifacts (R3-K5) ────────────────────────────────────────
// Pinning four artifacts alone would IGNORE the other two —
// `outputs/verification-stats.json`, which MANIFEST.md#evidence declares to be THE producing
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
// signed off, with Step 17 having recomputed only a sample of the epochs.
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

// Step 16 must have replayed the WHOLE Pass-1 experiment (PLINKO-20). PF_P1_REPLAY=off is a
// local escape for the mutation battery; a canonical run made with it is refused here even though
// Step 16 already caps itself at FLAG in that mode.
if (!s16 || !s16.data || s16.data.replayMode !== 'full' || s16.data.replayConfigs !== 28
    || s16.data.replayRoundsPerConfig !== 1000000 || s16.data.replayFiguresBeyondTolerance !== 0) {
  fail(`Step 16 replay: mode ${JSON.stringify(s16?.data?.replayMode)}, ${JSON.stringify(s16?.data?.replayConfigs)} configs × `
    + `${JSON.stringify(s16?.data?.replayRoundsPerConfig)} rounds, ${JSON.stringify(s16?.data?.replayFiguresBeyondTolerance)} beyond tolerance `
    + '(expected full, 28 × 1000000, 0) — the canonical run did not replay the whole Pass-1 experiment. Re-run with PF_P1_REPLAY unset.');
}

console.log(`  [check-outputs] OK: ${scored}/${EXPECTED_STEPS} steps, hardFail 0, verdict "${summary.verdict}"`
  + (overstatedSteps.length ? ` (Step ${RTP_CLAIM_STEP} OVERSTATED: RTP-CLAIM 1.2.0 enforced miss, recorded by outputs/rtp-claim-table.json; exit 5 is the verifier's)` : '')
  + (infoSteps.length ? ` (${passCount} PASS, ${infoSteps.length} INFO on informational Step ${infoSteps.map(s => s.step).join(', ')} — reported, not counted)` : ''));
console.log(`  [check-outputs] step identity OK: ids 1..${EXPECTED_STEPS} each present exactly once, every name matching the ${declared.size} step(s) declared in tests/steps/`);
console.log(`  [check-outputs] run outcome OK: overallStatus=${outcome.overallStatus}, completed=${outcome.completed}, validationErrors=${outcome.validationErrors.length}, scoredVerdict="${outcome.scoredVerdict}"`);
console.log(`  [check-outputs] Pass 1 theory OK: ${d16.theoryRowsAgreeingWithPinnedConfig}/${d16.resultRows} rows recomputed from the pinned config at ${Number(d16.theoryRecomputeTolerance).toExponential(0)}, header scalars and convergence traces reconcile`);
console.log(`  [check-outputs] pins OK: dataset ${datasetPin.slice(0, 12)}…, config ${configPin.slice(0, 12)}…, sim ${liveSimSha.slice(0, 12)}…, calibration ${liveCalSha.slice(0, 12)}…`);
console.log(`  [check-outputs] emissions OK: verification-stats ${ah.verificationStats.sha256.slice(0, 12)}…, coverage-results ${ah.coverage.sha256.slice(0, 12)}…`);
console.log(`  [check-outputs] run mode OK: attest=${runMode.attest} (${s17.data.attestChecked}/${s17.data.attestPopulation} epochs), emitBaseline=${runMode.emitBaseline}`);
console.log(`  [check-outputs] Pass 1 replay OK: ${s16.data.replayMode}, ${s16.data.replayConfigs} configs × ${s16.data.replayRoundsPerConfig} rounds, ${s16.data.replayFiguresCompared} committed figures compared, ${s16.data.replayFiguresBeyondTolerance} beyond tolerance, census ${String(s16.data.replayCensusSha256).slice(0, 12)}…`);
console.log(`  [check-outputs] calibrated null, PRIMARY window ${cal.windowNonces} nonces (the first nonces of every seed, all played — scored): expected ${cal.expectedZEarlyBelow1645Calibrated.toFixed(6)} vs observed ${cal.observedZEarlyBelow1645}, P(X>=obs)=${cal.zEarlyBelowCalibratedSurvivalP.toFixed(6)}`);
console.log(`  [check-outputs] calibrated null, EXTENDED window ${cal.extendedWindow.windowNonces} nonces (secondary): expected ${cal.extendedWindow.expectedZEarlyBelow1645Calibrated.toFixed(6)} vs observed ${cal.extendedWindow.observedZEarlyBelow1645}, P(X>=obs)=${cal.extendedWindow.zEarlyBelowCalibratedSurvivalP.toFixed(6)}`);
// The three extract documents (evidence.md, exploit-testing.md, SUMMARY.md) must be exactly what
// scripts/build-docs.mjs cuts out of MANIFEST.md and the mutation registries: one source, no drift.
{
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-docs.mjs'), '--check'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('  [check-outputs] FAIL: an extract document does not equal its source (node scripts/build-docs.mjs)');
    process.exit(1);
  }
}
process.exit(0);
