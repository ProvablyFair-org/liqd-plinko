/**
 * LIQD Plinko — Verification suite
 * Run: npm run verify
 *
 * Loads the captured master dataset (SHA-256 guarded), runs all scored steps, and writes THIS
 * RUN's results — pass or fail — under `outputs/run/`, leaving every committed artifact
 * byte-identical.
 *
 * ── VERIFICATION DOES NOT WRITE THE EVIDENCE IT SCORES ──────────────────────────────────────────
 * A verifier that ended by overwriting `outputs/verification-results.json`,
 * `outputs/verification-stats.json` and `outputs/coverage-results.json` would destroy the record
 * it just scored. All three are artifacts of record — `MANIFEST.md#evidence` names
 * `verification-stats.json` as THE producing artifact for figures quoted in the chapters — and
 * `artifactHashes` inside `verification-results.json` pins the other two by SHA-256, so one run
 * would replace both the evidence AND the hashes of the evidence. A run that disagreed with the
 * committed evidence would replace the evidence of the disagreement, and the next run would pass:
 * FAIL on one Node line, PASS on the re-run, nothing left to show the first result. Repeated
 * testing must not be able to erase an original disagreement.
 *
 * Two modes, deliberately distinct:
 *   • `npm run verify`  — scores the committed artifacts, writes ONLY under `outputs/run/`
 *                         (this run's results, stats and coverage, plus a field-level diff against
 *                         the committed artifacts). Committed bytes are never touched. Run it
 *                         twice on unchanged input and you get the same outcome twice.
 *   • `PF_EMIT=1 …`     — the same run as an EXPLICIT, intentional regeneration of the committed
 *                         artifacts, to be reviewed as a diff before publishing. It keeps every
 *                         pre-existing refusal: a hard fail (P0.2) and an emission divergence
 * both still leave the canonical files exactly as found.
 *
 * The emission-divergence guard below (`emissionDivergence`) is unchanged and is NOT the same
 * thing as the diff: it is a scored refusal that stops the run, whereas `outputs/run/diff.json`
 * records every field on which this run and the committed artifacts disagree, including the
 * scored-step results themselves, which no guard compares.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import { loadDataset, EXPECTED_DATASET_SHA256 } from '../src/loader';
import { loadPlinkoConfig, PLINKO_CONFIG_SHA256, configSha256 } from '../src/config';
import { SIMULATION_RESULTS_SHA256, CALIBRATION_RESULTS_SHA256 } from '../src/artifact-pins';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED } from '../src/rtp-claim';
import type { Bet, Seed } from '../src/types';
import type { VerifyContext, InfoItem } from './steps/context';

import * as commitment    from './steps/commitment';
import * as determinism   from './steps/determinism';
import * as payouts       from './steps/payouts';
import * as dataset       from './steps/dataset';
import * as antiCirc      from './steps/anti-circularity';
import * as phaseD        from './steps/phase-d';
import * as wtf           from './steps/wtf';
import * as simulation    from './steps/simulation';
import * as statistical   from './steps/statistical';
import * as coverage       from './steps/coverage';
import * as standardization from './steps/standardization';
import * as liveFit        from './steps/live-fit';

const DATASET_PATH         = path.join(__dirname, '../data/plinko-master-10100bets.json');
// Single-sourced in src/loader.ts — never re-typed here (audit-rules 9.4).
const EXPECTED_DATASET_HASH = EXPECTED_DATASET_SHA256;
const OUTPUTS_DIR          = path.join(__dirname, '../outputs');
/** This run's results. Never a committed artifact; gitignored. */
const RUN_DIR              = path.join(OUTPUTS_DIR, 'run');
/** PF_EMIT=1 is the ONLY thing that rewrites a committed artifact. */
const EMIT                 = process.env.PF_EMIT === '1';

console.log('\n══════════════════════════════════════════════════════════');
console.log('  LIQD PLINKO — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(EMIT
  ? '  MODE: REPORT GENERATION (PF_EMIT=1) — the committed artifacts WILL be rewritten'
  : '  MODE: verification — committed artifacts are read-only; results go to outputs/run/');

// ── Dataset presence guard (graceful) ─────────────────────────────────────────
if (!fs.existsSync(DATASET_PATH)) {
  console.log('\n  [ERROR] Dataset not found at data/plinko-master-10100bets.json');
  console.log('  Cannot run verification without the captured master dataset.');
  console.log('\n══════════════════════════════════════════════════════════\n');
  process.exit(1);
}

// ── Load dataset (SHA-256 guard exits(1) on mismatch) ─────────────────────────
const ds = loadDataset(DATASET_PATH, EXPECTED_DATASET_HASH);
const bets: Bet[]  = ds.bets;
const seeds: Seed[] = ds.seeds;
const cfg = loadPlinkoConfig();

// seedMap: hashedServerSeed → revealed serverSeed
const seedMap = new Map<string, string>();
for (const s of seeds) {
  if (s.serverSeed) seedMap.set(s.hashedServerSeed, s.serverSeed);
}

// byHash: hashedServerSeed → bets[]
const byHash = new Map<string, Bet[]>();
for (const b of bets) {
  const arr = byHash.get(b.hashedServerSeed) ?? [];
  arr.push(b);
  byHash.set(b.hashedServerSeed, arr);
}

const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseDBets = bets.filter(b => b.phase === 'D');
const phaseE = bets.filter(b => b.phase === 'E');

if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

console.log(`  Dataset: ${bets.length} bets | Seeds: ${seeds.length} | SHA-256 verified`);
console.log(`  Phase A:${phaseA.length} B:${phaseB.length} C:${phaseC.length} D:${phaseDBets.length} E:${phaseE.length}\n`);

const ctx: VerifyContext = {
  bets, seeds, cfg, seedMap, byHash,
  phaseA, phaseB, phaseC, phaseD: phaseDBets, phaseE,
  // The header, for RECONCILIATION only (G-BIND) — Steps 11/12 take the audited population from
  // src/loader.ts and hard-fail a header that disagrees. No step may read a count out of here.
  meta: ds.meta,
  outputsDir: OUTPUTS_DIR,
  datasetSha256: ds.sha256,
  expectedDatasetHash: EXPECTED_DATASET_HASH,
  preCapture: ds.meta.preCapture,
};

// ── Run scored steps ──────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),     // Steps  1– 4
  ...determinism.run(ctx),    // Steps  5– 6
  ...payouts.run(ctx),        // Steps  7–10
  ...dataset.run(ctx),        // Steps 11–12
  ...antiCirc.run(ctx),       // Step  13
  ...phaseD.run(ctx),         // Step  14
  ...wtf.run(ctx),            // Step  15
  ...simulation.run(ctx),     // Steps 16–17: scores outputs/simulation-results.json (pass1 + pass2)
  ...standardization.run(ctx),// Steps 18–20
  ...liveFit.run(ctx),        // Step  21: epoch-window slot fit (live drops vs binomial)
];

// ── Profile labels ────────────────────────────────────────────────────────────
// Each scored step says which ProvablyFair.org Plinko profile check it implements, so the
// conformance matrix is DERIVED from the artifact rather than written by hand and left to go
// stale. The label is attached here, to the emitted record only: `src/profile-map.ts` cannot
// change what any step asserts, and a step that answers no profile check says so explicitly.
const labelled = results.map(r => ({ ...r, ...labelFor(r.step) }));

// ── Informational items ───────────────────────────────────────────────────────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── Payout-table coverage (informational block, not a scored step) ────────────
const coverageReport = coverage.run(ctx);

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; 1.1.0 2026-10-01, 1.2.0 2026-10-14) ────────────────
// The per-setting exact RTP table held to the published claim (src/rtp-settings.ts). While the
// package switch RTP_CLAIM_RULE_ENFORCED (src/rtp-claim-switch.ts) is false this is printed only and no step moves; when it
// is true a miss (gate status OVERSTATED) marks the step carrying PLINKO-19 OVERSTATED: not a draw FAIL, not counted in
// hardFail, verdict RTP FIGURE OVERSTATED, exit 5 (decision D3, 2026-10-14). A committed table that no longer equals this
// run (or its pin) is a reproduction failure either way (gate status FAIL → step FAIL, exit 1).
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
if (rtpClaim.status === 'FAIL' || rtpClaim.status === 'OVERSTATED') {
  // `labelled` (the emitted record) was copied from `results` above: mark the step in both, or the
  // artifact would carry it as PASS under another verdict.
  const status = rtpClaim.status;
  for (const list of [results, labelled] as any[][]) {
    const s = list.find(r => r.step === RTP_CLAIM_STEP);
    if (s) {
      s.status = status;
      s.detail += status === 'FAIL' ? ' — RTP-CLAIM: the committed table does not match this run or its pin (reproduction failure)'
        : ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM 1.2.0, enforced): ${rtpClaim.result.minimalFix}`;
    }
  }
  // The step's marker was printed when the step ran, as PASS or FLAG. Print the status it ends
  // with, so the console never shows a PASS that the scored record contradicts (2026-10-02 QA,
  // code item 1). scripts/mutate.mjs reads the scored record, and cross-checks it against the
  // LAST marker printed for each step.
  console.log(`  [${status === 'FAIL' ? 'FAIL' : RTP_FIGURE_OVERSTATED}] Step ${RTP_CLAIM_STEP} — re-scored by the enforced RTP-CLAIM rule `
    + `(outcome ${rtpClaim.result.outcome}; committed table ${rtpClaim.tableMatches ? 'matches this run' : 'does NOT match this run or its pin'})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
const overstated = results.filter(r => r.status === 'OVERSTATED').length;
// INFO (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29): reported, never counted
// as a flag, never enters the verdict or the exit code.
const informational = results.filter(r => r.status === 'INFO').length;
// The rule's ranking (src/rtp-claim.ts rtpClaimVerdict): draw fail 1 > INCOMPLETE 3 > RTP FIGURE OVERSTATED 5 >
// Conditional Pass 2 (any FLAG in this package) > Full Pass 0. Every step has run by this line, so the run is complete.
const { verdict, exit: verdictExit } = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: overstated > 0, opFlags: flags });

if (infoItems.length > 0) {
  console.log('');
  console.log('  ┌── Informational Context (not scored) ──');
  for (const item of infoItems) console.log(`  │ ${item.label}: ${item.detail}`);
  console.log('  └──');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
if (overstated) console.log(`  RTP figure overstated: Step ${RTP_CLAIM_STEP} (RTP-CLAIM 1.2.0, enforced; not a draw fail)`);
console.log(`  Flags:      ${flags}`);
if (informational > 0) console.log(`  Informational deviations: ${informational} (reported, not counted, verdict unchanged)`);
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

const cfgActualSha = configSha256();
// Record exactly which simulation artifact these steps scored: the sha256 of the
// file as read. A hash is the artifact's identity; a stale or substituted file is detectable
// because `check-outputs` re-hashes the file on disk and compares it with what is recorded
// here. Nothing derived from a clock is stored — this document is pinned, and a timestamp
// inside a pinned document makes the pin unsatisfiable for every reader who regenerates it.
const simFilePath = path.join(OUTPUTS_DIR, 'simulation-results.json');
let simArtifact: { file: string; sha256: string | null } = {
  file: 'outputs/simulation-results.json', sha256: null,
};
if (fs.existsSync(simFilePath)) {
  simArtifact = {
    file: 'outputs/simulation-results.json',
    sha256: createHash('sha256').update(fs.readFileSync(simFilePath)).digest('hex'),
  };
}
// Same treatment for the calibrated-null artifact: Step 17 scores against it,
// so which file it scored has to be recorded, and check-outputs re-asserts that the
// recorded hash is the file on disk.
const calFilePath = path.join(OUTPUTS_DIR, 'calibration-results.json');
let calArtifact: { file: string; sha256: string | null } = {
  file: 'outputs/calibration-results.json', sha256: null,
};
if (fs.existsSync(calFilePath)) {
  calArtifact = {
    file: 'outputs/calibration-results.json',
    sha256: createHash('sha256').update(fs.readFileSync(calFilePath)).digest('hex'),
  };
}

// ── PLINKO-27: the scored artifacts are pinned in source ──────────────────────
// simArtifact/calArtifact above are what the run scored; src/artifact-pins.ts holds the
// checked-in identity of each. A substituted or stale simulation/calibration file is caught
// here against a source constant, not merely against the value the run itself recorded.
for (const [label, actual, expected] of [
  ['simulation-results.json', simArtifact.sha256, SIMULATION_RESULTS_SHA256],
  ['calibration-results.json', calArtifact.sha256, CALIBRATION_RESULTS_SHA256],
] as const) {
  if (actual !== null && actual !== expected) {
    throw new Error(
      `Pinned artifact mismatch: outputs/${label} hashes to ${actual} but src/artifact-pins.ts ` +
      `pins ${expected}. The scored artifact on disk is not the one this audit pins. If the change ` +
      `was sanctioned, re-pin src/artifact-pins.ts in the same commit.`,
    );
  }
}
// ── Derived emission artifacts, built BEFORE the report so they can be pinned ────
// `outputs/coverage-results.json` and `outputs/verification-stats.json` carry, as machine
// values, the figures the coverage block and the scored steps compute. They exist because
// `verification-results.json`'s `detail` fields are authored SENTENCES and cannot serve as
// the producing artifact for a number quoted in a chapter.
//
// Round-3 external review R3-K5: `check-outputs` pinned the dataset, the config, the
// simulation and the calibration — and never looked at these two, although MANIFEST.md#evidence
// declares verification-stats.json to be THE producing artifact for the chapter figures.
// Forging both and running `npm run check-outputs` returned OK, exit 0. They are hashed
// here, recorded in `artifactHashes`, and re-asserted by the publication guard.
const stepStats: Record<string, unknown> = {};
for (const r of results) if (r.data) stepStats[`step${r.step}`] = { name: r.name, ...r.data };
const infoStats: Record<string, unknown> = {};
for (const i of infoItems) if (i.data) infoStats[i.label] = i.data;
//
// Neither document carries a generation timestamp. Both are pinned — in
// `artifactHashes` below, in RELEASE-MANIFEST.json, and by `check-outputs` — and a clock
// reading inside a pinned document is a field that changes on every regeneration even when
// every figure is identical, which makes the published hash impossible to reproduce. What
// identifies a run is the dataset hash they both carry and the content itself.
const statsDoc = {
  audit: 'LIQD Plinko',
  artifact: 'machine-readable numerics emitted by the scored steps and informational items',
  datasetSha256: ds.sha256,
  steps: stepStats,
  info: infoStats,
};
const coverageDoc = {
  audit: 'LIQD Plinko',
  artifact: 'payout-table cell coverage (informational, not a scored step)',
  datasetSha256: ds.sha256,
  ...coverageReport,
};
const statsJson = JSON.stringify(statsDoc, null, 2);
const coverageJson = JSON.stringify(coverageDoc, null, 2);
const sha = (s: string): string => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// ── Run mode (R3-K4) ──────────────────────────────────────────────────────────
// The two local-only escapes are recorded as machine values so the publication guard can
// refuse them. Previously the only trace of `ATTEST_SAMPLE` was the word "sample=2" inside
// a prose detail string, and `EMIT_BASELINE` left no trace at all.
const step17Data = (results.find(r => r.step === 17)?.data ?? {}) as Record<string, unknown>;
const runMode = {
  attest: typeof step17Data.attestMode === 'string' ? step17Data.attestMode : 'unknown',
  emitBaseline: process.env.EMIT_BASELINE === '1',
};

// ── the machine-readable verdict describes the WHOLE COMMAND ────────────
// Round-4 client QA. The report used to be built ONCE, here, and written unchanged to a
// `.failed.json` filename when a later validation failed. Its contents therefore read
// `passed: 21`, `hardFail: 0`, `verdict: "PROVABLY FAIR — Full Pass"` on a run that
// exited 1 because emission validation failed. A consumer reading the file — and nothing
// in it says the command failed — infers success from a failed validation run.
//
// The report is now BUILT AT THE END, after every required validation, by
// `buildReport(...)`. The 21 scored checks are kept as a SUBORDINATE result
// (`outcome.scored`, `outcome.scoredVerdict`); `summary.verdict`, `outcome.overallStatus`
// and `outcome.completed` describe the command. No document a failing run writes can
// carry a top-level Full Pass. `summary` is the one shape every package writes
// (passed, flags, operatorFlags, captureFlags, hardFail, verdict — Framework 1.0 review
// item 14, F20); everything else about the run lives in `outcome`.
const NOT_COMPLETED_VERDICT = 'RUN NOT VALID — artifact validation failed; this is not an audit result';
function buildReport(overall: {
  status: 'PASS' | 'FAIL';
  completed: boolean;
  verdict: string;
  validationErrors: string[];
}): string {
  return JSON.stringify({
    totalBets: bets.length,
    totalSeeds: seeds.length,
    datasetSha256: ds.sha256,
    runMode,
    artifactHashes: {
      dataset: { file: 'data/plinko-master-10100bets.json', sha256: ds.sha256 },
      config: { file: 'plinkoConfig.json', expected: PLINKO_CONFIG_SHA256, actual: cfgActualSha, match: cfgActualSha === PLINKO_CONFIG_SHA256 },
      simulation: simArtifact,
      calibration: calArtifact,
      verificationStats: { file: 'outputs/verification-stats.json', sha256: sha(statsJson) },
      coverage: { file: 'outputs/coverage-results.json', sha256: sha(coverageJson) },
    },
    steps: labelled,
    profileCoverage: profileCoverageBlock(),
    info: infoItems,
    coverage: coverageReport,
    // The ONE summary shape shared by every package (scripts/release-bar.mjs, SUMMARY_KEYS).
    // Plinko's steps carry no origin classification, so every FLAG is an operator flag and
    // captureFlags is 0; `verdict` is the command's outcome.
    summary: {
      passed, flags,
      operatorFlags: flags,
      captureFlags: 0,
      hardFail,
      verdict: overall.verdict,
    },
    // The command's outcome in full, and the 21 scored checks kept subordinate to it.
    outcome: {
      scoredVerdict: verdict,
      scored: { passed, flags, hardFail, of: results.length },
      overallStatus: overall.status,
      completed: overall.completed,
      validationErrors: overall.validationErrors,
    },
  }, null, 2);
}

// ── Ship-safety write guard (P0.2, extended by D1) ────────────────────────────
// A run with any hard fail must NEVER overwrite the canonical results file, so
// outputs/verification-results.json can only ever hold a passing (hardFail === 0) run.
// `npm run check-outputs` is the pre-push guard that re-asserts this on the committed file.
//
// More generally, NO verification run reaches a committed path at all, passing or failing: the
// quarantined document is written to outputs/run/ rather than beside the evidence, and that
// directory is where everything a verification run produces lives. On the emission path
// (PF_EMIT=1) the refusal still holds — a hard fail leaves the canonical file exactly as found.
const hardFailErrors = results.filter(r => r.status === 'FAIL').map(r => `Step ${r.step} (${r.name}) FAILED`);

// ── The guard that keeps the emission artifacts honest ────────────────────────
// A committed emission file nobody re-derives can be edited, and the chapters would then
// cite a forged file while the scored record still held the truth.
//
// the determinism claim, stated correctly. These files are
// deterministic given the pinned dataset, the pinned config AND THE COMMITTED SIMULATION
// AND CALIBRATION ARTIFACTS. They are NOT deterministic given the dataset and config
// alone, because Step 16's `data` carries statistics derived from the Pass 1 experiment,
// and Pass 1 draws fresh seeds per run. That is why `npm run simulate` now writes a fresh
// experiment to its own directory and `npm test` runs `npm run replay` instead: comparing
// a NEW experiment's statistics against the OLD experiment's exact values was an invalid
// comparison between two different experiments, not a reproduction check. Under the
// replay path this guard is comparing like with like, which is what it always claimed.
//
// The guard is to recompute them and compare: if a committed copy differs from what this
// run just computed beyond the declared tolerances (see `semanticDiff`) — or is ABSENT —
// the run is a hard fail and the canonical artifact is NOT overwritten. `EMIT_BASELINE=1`
// re-baselines them after a deliberate change to a step's numerics (and is the bootstrap
// for a tree that has none yet); it is a local-only escape exactly like ATTEST_SAMPLE, and
// like ATTEST_SAMPLE it is now recorded in `runMode` and refused by `check-outputs`.

// ── semantic comparison, not byte-equality ─────────────────────────────
// Round-4 client QA. The comparison was `JSON.stringify(a) === JSON.stringify(b)`, i.e.
// EXACT equality on every leaf including floating-point diagnostics. Step 17 already
// accepts an attestation residual up to 1e-9, so the final guard could REJECT a
// computation the numerical check correctly ACCEPTS: a saved residual of 0 against a
// recomputed 5.551115123125783e-16 (a real cross-runtime libm difference) fails
// byte-equality while sitting nine orders of magnitude inside the declared bound. That is
// a portability defect in the comparator, not evidence of a different outcome algorithm.
// (The Node 24 canonical run reported by the reviewer passed, so no claim is made here
// that "any Node other than 22.23.1 fails" — the defect is that the comparator CAN reject
// a conforming run, which is enough.)
//
// The replacement is field-specific and does NOT lower any bar:
//   * SHAPE is exact — the key set at every level must match, so no field can appear,
//     vanish or change type. Strings, booleans, nulls, arrays lengths and INTEGERS
//     (identities, counts, hashes, configuration sets, epoch lists) compare exactly.
//   * NON-INTEGER numbers compare within |a-b| <= ATOL + RTOL*max(|a|,|b|), with
//     ATOL = 1e-14 and RTOL = 1e-12. Both are far below the precision at which any figure
//     in this package is published and far above cross-runtime ULP drift.
//   * DECLARED BOUNDS are enforced on the FRESH value regardless of the committed one:
//     the non-negative attestation residual must satisfy Step 17's own 1e-9, so this path
//     can never accept a residual the scored step would reject.
// Raw bytes and their SHA-256 remain the record: `artifactHashes` still pins the exact
// bytes written, and `check-outputs` still re-asserts them. Semantic comparison is used
// only to decide whether a RECOMPUTATION is acceptable.
const EMIT_ATOL = 1e-14;
const EMIT_RTOL = 1e-12;
/** Leaves with a bound that must hold on the fresh value, whatever the committed copy says. */
const DECLARED_BOUNDS: { path: string; max: number; why: string }[] = [
  { path: 'steps.step17.attestMaxAbsDiff', max: 1e-9, why: "Step 17's own attestation tolerance" },
];

function numbersAgree(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  // Two DISTINCT integers are never "close enough": counts, epoch numbers, step numbers and
  // populations must match exactly, and this is the line that says so.
  //
  // What this must NOT do is demand an integer on one side and a float on the other be equal.
  // The attestation residual is exactly that case — `0` on the machine that produced the
  // committed copy, `5.551115123125783e-16` on another runtime — and `Number.isInteger(0)` is
  // true while `Number.isInteger(5.55e-16)` is false. An earlier draft of this function keyed
  // exactness on "either side is an integer" and would have rejected precisely the run 
  // is about. Only an integer PAIR is held to exact equality; everything else gets the
  // tolerance, which is still far tighter than any distinct pair of integers could satisfy
  // (two integers differ by at least 1; the tolerance at the largest value here,
  // totalRounds = 28,000,000, is 2.8e-5).
  if (Number.isInteger(a) && Number.isInteger(b)) return false;
  return Math.abs(a - b) <= EMIT_ATOL + EMIT_RTOL * Math.max(Math.abs(a), Math.abs(b));
}

/** Structural + numeric comparison. Returns every disagreement, deepest key path first. */
function semanticDiff(a: unknown, b: unknown, at = ''): string[] {
  const where = at || '(root)';
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (typeof a === 'number' && typeof b === 'number') {
      return numbersAgree(a, b) ? [] : [`${where}: committed ${a} vs recomputed ${b}`];
    }
    return Object.is(a, b) ? [] : [`${where}: committed ${JSON.stringify(a)} vs recomputed ${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) !== Array.isArray(b)) return [`${where}: array/object shape differs`];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${where}: committed ${a.length} element(s) vs recomputed ${b.length}`];
    return a.flatMap((v, i) => semanticDiff(v, (b as unknown[])[i], `${at}[${i}]`));
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  const out: string[] = [];
  // No key is exempt. The emission artifacts carry no run metadata, so there is nothing in
  // them that differs by construction; a key that appears on one side and not the other is
  // a real structural change and is reported as one.
  for (const k of keys) {
    const inA = Object.prototype.hasOwnProperty.call(ao, k);
    const inB = Object.prototype.hasOwnProperty.call(bo, k);
    if (!inA) { out.push(`${at}${at ? '.' : ''}${k}: absent from the committed copy`); continue; }
    if (!inB) { out.push(`${at}${at ? '.' : ''}${k}: present in the committed copy but this run does not produce it`); continue; }
    out.push(...semanticDiff(ao[k], bo[k], `${at}${at ? '.' : ''}${k}`));
  }
  return out;
}

function leafAt(doc: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) =>
    (o !== null && typeof o === 'object') ? (o as Record<string, unknown>)[k] : undefined, doc);
}

/** Compare a committed emission file with what this run computed, field by field. */
function emissionDivergence(file: string, fresh: unknown): string | null {
  const p = path.join(OUTPUTS_DIR, file);
  // R3-K6: absent is NOT clean. `return null` here meant deleting both files gave 21/21,
  // exit 0, and a silent regeneration — the guard was a divergence check with no presence
  // check behind it, and (R3-K5) nothing else looked at these files at all. This is a
  // CROSS-REPO class: the same "absent artifact ⇒ pass" shape exists in the sibling mines
  // and blackjack suites.
  if (!fs.existsSync(p)) {
    return `${file}: committed copy is MISSING — an absent emission artifact is not a clean run `
      + `(bootstrap a tree that has none with EMIT_BASELINE=1 npm run verify)`;
  }
  let existing: unknown;
  try { existing = JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { return `${file}: committed copy is not valid JSON (${(e as Error).message})`; }

  // Declared bounds, checked on THIS RUN's value — independent of the committed copy.
  for (const b of DECLARED_BOUNDS) {
    const v = leafAt(fresh, b.path);
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > b.max) {
      return `${file}: ${b.path} = ${String(v)} violates its declared bound ${b.max.toExponential(0)} (${b.why})`;
    }
  }

  const diffs = semanticDiff(existing, fresh);
  return diffs.length === 0
    ? null
    : `${file}: the committed copy does not match what this run computed from the pinned dataset — `
      + `${diffs.length} field(s) differ beyond tolerance (atol ${EMIT_ATOL.toExponential(0)}, rtol ${EMIT_RTOL.toExponential(0)}, `
      + `integers and non-numeric leaves exact): ${diffs.slice(0, 6).join(' | ')}${diffs.length > 6 ? ` | +${diffs.length - 6} more` : ''}`;
}

// A hard fail short-circuits the emission guard exactly as it did when it exited here: the
// divergence question is meaningless once a scored step has already failed.
const baselineMode = process.env.EMIT_BASELINE === '1';
const emissionFailures = (hardFail > 0 || baselineMode) ? [] : [
  emissionDivergence('verification-stats.json', statsDoc),
  emissionDivergence('coverage-results.json', coverageDoc),
].filter((m): m is string => m !== null);

if (emissionFailures.length > 0) {
  console.log('');
  console.log('  [ERROR] Derived emission artifact mismatch — the committed file is not what this run produced:');
  for (const m of emissionFailures) console.log(`          ${m}`);
  console.log('          Re-baseline with EMIT_BASELINE=1 PF_EMIT=1 npm run verify only if the change was deliberate.');
}

// ── The command's own outcome, stated after every required validation ─────────────────
// `EMIT_BASELINE=1` SKIPS the emission guard, so a baseline run is explicitly recorded as
// not-completed and check-outputs refuses it (it already refuses runMode.emitBaseline).
const overall = hardFail > 0
  ? {
    status: 'FAIL' as const,
    completed: true,
    verdict,                       // already 'NOT PROVABLY FAIR' when hardFail > 0
    validationErrors: hardFailErrors,
  }
  : emissionFailures.length > 0
    ? {
      // the quarantined document says the run was NOT valid. It does not carry a
      // top-level Full Pass while the command exits 1.
      status: 'FAIL' as const,
      completed: false,
      verdict: NOT_COMPLETED_VERDICT,
      validationErrors: emissionFailures,
    }
    : baselineMode
      ? {
        status: 'FAIL' as const,
        completed: false,
        verdict: 'RUN NOT VALID — produced with EMIT_BASELINE=1, which skips the emission-divergence guard',
        validationErrors: ['EMIT_BASELINE=1 skipped the derived-emission-artifact validation'],
      }
      : { status: 'PASS' as const, completed: true, verdict, validationErrors: [] };

const report = buildReport(overall);

const VERIFICATION_FILE = 'verification-results.json';
const STATS_FILE        = 'verification-stats.json';
const COVERAGE_FILE     = 'coverage-results.json';
const readJsonOrNull = (p: string): unknown => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/**
 * Fields on which this run disagrees with the committed artifacts BEYOND the reproduction
 * tolerance. Zero on the emission path, which is regenerating those artifacts rather than
 * checking against them.
 */
let reproductionFailures = 0;

if (EMIT) {
  // ── EXPLICIT REPORT GENERATION (PF_EMIT=1) ──────────────────────────────────────────────────
  // The only path that rewrites a committed artifact. It is a separate mode precisely so that
  // replacing evidence is an act somebody chose, reviewed as a diff, rather than a side effect of
  // testing (D1). Every pre-existing refusal still applies: a hard fail (P0.2) and an emission
  // divergence both leave the canonical files exactly as found, and the quarantined
  // document is written under outputs/run/ instead.
  if (hardFail > 0 || emissionFailures.length > 0) {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUN_DIR, 'verification-results.failed.json'), report);
    console.log(`  Output: outputs/run/verification-results.failed.json (overallStatus FAIL, verdict "${overall.verdict}" — canonical outputs/${VERIFICATION_FILE} NOT overwritten)`);
  } else {
    // The exact bytes hashed into `artifactHashes` above are the bytes written here.
    fs.writeFileSync(path.join(OUTPUTS_DIR, VERIFICATION_FILE), report);
    console.log(`  REPORT GENERATION: rewrote outputs/${VERIFICATION_FILE}`);
    fs.writeFileSync(path.join(OUTPUTS_DIR, STATS_FILE), statsJson);
    console.log(`  REPORT GENERATION: rewrote outputs/${STATS_FILE}`);
    fs.writeFileSync(path.join(OUTPUTS_DIR, COVERAGE_FILE), coverageJson);
    console.log(`  REPORT GENERATION: rewrote outputs/${COVERAGE_FILE}`);
    console.log('  Review the diff before publishing — these are artifacts of record.');
  }
} else {
  // ── VERIFICATION (`npm run verify`) ─────────────────────────────────────────────────────────
  // This run's results, pass or fail, plus a field-level diff against the committed artifacts. A
  // disagreement is RECORDED here; it is not resolved in favour of whichever run wrote last.
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const runReportName = (hardFail > 0 || emissionFailures.length > 0)
    ? 'verification-results.failed.json'
    : VERIFICATION_FILE;
  fs.writeFileSync(path.join(RUN_DIR, runReportName), report);
  fs.writeFileSync(path.join(RUN_DIR, STATS_FILE), statsJson);
  fs.writeFileSync(path.join(RUN_DIR, COVERAGE_FILE), coverageJson);

  // TWO paths are excluded from the diff, and no others. No document compared here carries a
  // timestamp, so nothing is excluded for being "a field that always moves".
  //
  //   • `artifactHashes.verificationStats.sha256` / `artifactHashes.coverage.sha256` — these are
  //     EXACT digests over documents whose leaves are compared NUMERICALLY, with the tolerance
  //     argued for below. A digest cannot carry a tolerance: one unit in the last place of one
  //     double — the same result computed on different hardware — changes every byte of it. So
  //     comparing the digest exactly would re-impose exact equality on figures this file has
  //     deliberately decided not to hold to exact equality, and would report a red for a
  //     non-difference. The documents themselves are compared leaf by leaf in
  //     `verificationStatsDiff` / `coverageResultsDiff` below, which is the stronger check: a
  //     digest tells you THAT something changed, those tell you WHAT, and to what extent.
  //
  // The digests are not unchecked — `check-outputs` re-hashes both files on disk and requires
  // them to equal what the canonical run recorded. That is a byte-integrity check on one tree,
  // which is what a digest is good for; this is a cross-run reproduction check, which it is not.
  const committedVerification = readJsonOrNull(path.join(OUTPUTS_DIR, VERIFICATION_FILE));
  const committedStats        = readJsonOrNull(path.join(OUTPUTS_DIR, STATS_FILE));
  const committedCoverage     = readJsonOrNull(path.join(OUTPUTS_DIR, COVERAGE_FILE));
  const thisRunDoc = JSON.parse(report) as Record<string, unknown>;
  const verificationDiff = fieldDiff(committedVerification, thisRunDoc, [
    'artifactHashes.verificationStats.sha256',
    'artifactHashes.coverage.sha256',
  ]);
  const statsDiff    = fieldDiff(committedStats, statsDoc, []);
  const coverageDiff = fieldDiff(committedCoverage, coverageDoc, []);

  // THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD".
  // Exact equality was the wrong bar and said so out loud: this run recorded
  // `steps.step17.attestMaxAbsDiff` as 0 on the machine that wrote the committed copy and
  // 5.551115123125783e-16 on another, and reported it as a disagreement. That is one unit in
  // the last place of a double — the same result on different hardware — and treating it as
  // evidence of drift trains a reader to ignore the diff, which is the one outcome that makes
  // the artifact useless. The tolerance is declared in src/diff.ts and is far below the
  // precision of any published figure; anything outside it is a different result and exits 1.
  const realVerification = beyondTolerance(verificationDiff);
  const realStats        = beyondTolerance(statsDiff);
  const realCoverage     = beyondTolerance(coverageDiff);
  const realTotal        = realVerification.length + realStats.length + realCoverage.length;
  const allDiffs         = [...verificationDiff, ...statsDiff, ...coverageDiff];

  // `outputs/run/` is a record of one local run, not audit evidence — it is gitignored and
  // nothing pins it — so stamping the clock on it costs no reader a reproduction.
  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    ranAt: new Date().toISOString(),
    runtime: process.versions.node,
    verdict,
    overallStatus: overall.status,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: maxima(allDiffs),
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. The committed artifacts '
      + 'carry no run metadata, so nothing is excluded for differing by construction; the only two '
      + 'excluded paths are the self-digests of verification-stats.json and coverage-results.json, '
      + 'which are exact hashes over documents compared leaf by leaf, with a tolerance, right here. '
      + 'Entries marked `withinTolerance` are the same result computed on different '
      + 'hardware and are recorded, not scored. Any entry NOT so marked means this run disagrees '
      + 'with the committed evidence — investigate it; do not re-run until it goes away, and do '
      + 'not regenerate the committed artifact to make it go away.',
    committedReadable: {
      [`outputs/${VERIFICATION_FILE}`]: committedVerification !== null,
      [`outputs/${STATS_FILE}`]: committedStats !== null,
      [`outputs/${COVERAGE_FILE}`]: committedCoverage !== null,
    },
    verificationResultsDiff: verificationDiff,
    verificationStatsDiff: statsDiff,
    coverageResultsDiff: coverageDiff,
  }, null, 2));

  console.log(`  Output (this run only): outputs/run/${runReportName}, outputs/run/${STATS_FILE}, outputs/run/${COVERAGE_FILE}, outputs/run/diff.json`);
  console.log('  Committed artifacts NOT modified. Use `PF_EMIT=1 npm run verify` to propose replacements.');
  const gap = maxima(allDiffs);
  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  if (realTotal > 0) {
    console.log(`  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE — ${realVerification.length} field(s) in ${VERIFICATION_FILE}, ${realStats.length} in ${STATS_FILE}, ${realCoverage.length} in ${COVERAGE_FILE}. See outputs/run/diff.json.`);
    for (const d of [...realVerification, ...realStats, ...realCoverage].slice(0, 6)) {
      console.log(`      ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
    }
  }
  reproductionFailures = realTotal;
}

// Framework 1.1 exit contract: FAIL -> 1, RTP FIGURE OVERSTATED (enforced RTP-CLAIM 1.2.0 miss) -> 5,
// FLAG -> 2, otherwise 0. A FLAG that exits 0
// is invisible to CI, so a Conditional Pass reads as a clean run to anything automated.
// Reproduction beyond tolerance is a FAIL, not a warning: README Reproduce tells a reader
// this comparison is the gate, and a gate that only prints is not one.
if (hardFail > 0 || emissionFailures.length > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
// 5 RTP FIGURE OVERSTATED, 2 Conditional Pass, 0 Full Pass — the code rtpClaimVerdict ranked above.
if (verdictExit !== 0) process.exit(verdictExit);
export {};
