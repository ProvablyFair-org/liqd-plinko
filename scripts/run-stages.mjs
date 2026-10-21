#!/usr/bin/env node
/**
 * run-stages.mjs — run EVERY stage of `npm test` and report each one. The same runner the LIQD Keno and Mines packages
 * use (their scripts/run-stages.mjs); only the stage list differs. Added to this package 2026-10-14 so that
 * `check-outputs` and `release-manifest --check` still run when the verdict is RTP FIGURE OVERSTATED (exit 5).
 *
 * WHY (QA list of 2026-10-03, A-6). `npm test` was the chain `a && b && c && d`. `&&` stops at the first non-zero exit,
 * and the verifier's exit code is the VERDICT — 0 Full Pass, 2 Conditional Pass, 5 RTP FIGURE OVERSTATED, 1 NOT PROVABLY
 * FAIR — so on any
 * verdict other than a Full Pass the chain never reached `release-manifest.mjs --check`, the release stage.
 *
 * WHAT IT DOES. Runs every stage in order, whatever the previous ones returned, prints one line per stage with its
 * exit code, and exits with:
 *   1                          if any stage OTHER than the verdict stage exited non-zero — that stage failed, and the
 *                              verdict printed above it is not this package's result;
 *   the verdict stage's code   otherwise (0 Full Pass, 2 Conditional Pass, 5 RTP FIGURE OVERSTATED, 1 NOT PROVABLY FAIR).
 * On this package's committed record the verdict is PROVABLY FAIR — Full Pass, exit 0. The RESULT line says whether
 * every other stage passed.
 *
 * Plain Node, no dependencies — `npm test` stays zero-install.
 *
 * Usage:  node scripts/run-stages.mjs test        (npm test)
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;

/** Each stage: a label, the argv, and whether its exit code is the verdict. */
const LISTS = {
  test: [
    { label: 'stale-build and report-count gate', cmd: NODE, args: ['scripts/check-standalone.mjs'] },
    { label: 'bundled unit specs', cmd: NODE, args: ['test.js'] },
    { label: 'bundled verifier (verdict)', cmd: NODE, args: ['verify.js'], verdict: true },
    { label: 'committed outputs (check-outputs)', cmd: NODE, args: ['scripts/check-outputs.mjs'] },
    { label: 'release manifest and release bar', cmd: NODE, args: ['scripts/release-manifest.mjs', '--check'] },
  ],
};

const which = process.argv[2];
const stages = LISTS[which];
if (!stages) {
  console.error(`run-stages: unknown list ${JSON.stringify(which)} — expected one of ${Object.keys(LISTS).join(', ')}`);
  process.exit(1);
}

const results = [];
for (const s of stages) {
  console.log(`\n▶ [${which}] ${s.label}: ${[path.basename(s.cmd), ...s.args].join(' ')}`);
  const r = spawnSync(s.cmd, s.args, { cwd: ROOT, stdio: 'inherit' });
  const code = r.error ? 1 : (r.status ?? 1);
  if (r.error) console.error(`run-stages: could not start ${s.label}: ${r.error.message}`);
  if (r.signal) console.error(`run-stages: ${s.label} was stopped by ${r.signal}`);
  results.push({ ...s, code });
}

const verdictStage = results.find(s => s.verdict);
const failed = results.filter(s => !s.verdict && s.code !== 0);
const exitCode = failed.length > 0 ? 1 : verdictStage.code;
const meaning = { 0: 'Full Pass', 1: 'NOT PROVABLY FAIR, or a reproduction beyond tolerance', 2: 'Conditional Pass', 5: 'RTP FIGURE OVERSTATED' };

console.log(`\n── run-stages: ${which} ── every stage ran`);
for (const s of results) {
  const tag = s.verdict ? `exit ${s.code} (verdict: ${meaning[s.code] ?? 'unexpected code'})` : (s.code === 0 ? 'ok' : `FAILED, exit ${s.code}`);
  console.log(`  ${s.label.padEnd(44)} ${tag}`);
}
console.log(failed.length > 0
  ? `  RESULT: exit 1 — ${failed.map(s => s.label).join('; ')} failed; the verdict above is not this package's result until ${failed.length === 1 ? 'it passes' : 'they pass'}`
  : `  RESULT: exit ${exitCode} — every other stage passed; the exit code is the verifier's verdict code`);
process.exit(exitCode);
