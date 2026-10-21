/**
 * LIQD Plinko — the REGENERATION DIFF (profile PLINKO-28), second half of `npm run test:full`.
 *
 * `npm run test:full` regenerates the published simulation with the generator itself:
 *
 *   SIM_SEEDS_FROM=outputs/simulation-results.json SIM_OUT_DIR=outputs/run/regen npm run simulate
 *   SIM_OUT_DIR=outputs/run/regen npm run calibrate
 *
 * — the same src/simulate.ts and src/calibrate.ts that wrote the committed artifacts, playing the
 * Pass-1 seed pairs saved in the committed rows (Pass 2 and the calibration are deterministic from
 * the pinned dataset and config). Nothing in outputs/ is touched; everything goes to outputs/run/,
 * which is gitignored. This file then compares the regeneration with the committed artifacts:
 *
 *   simulation-results.json   field by field (src/diff.ts fieldDiff): integers and strings exact,
 *                             other numbers within 1e-14 + 1e-12·max(|a|,|b|);
 *   calibration-results.json  the same, except the two leaves that identify the simulation file
 *                             it was paired with: `source.simulation.file`, which is necessarily
 *                             a different path for a regeneration, and `source.simulation.sha256`,
 *                             the hash of that file, which differs whenever the regenerated
 *                             simulation is not byte-identical to the committed one (on another
 *                             machine one p-value can differ in its last digit, which the field
 *                             comparison above tolerates). The check below still requires the
 *                             regenerated calibration to name the regenerated simulation by its
 *                             SHA-256;
 *   rtp-convergence.html      byte for byte.
 *
 * It writes outputs/run/diff-simulation.json (every differing field, the maxima, the Node runtime),
 * adds its verdict to outputs/run/diff.json when that run record exists, and exits 1 if anything
 * is beyond tolerance or missing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from './diff';

const ROOT = path.join(__dirname, '..');
const COMMITTED = path.join(ROOT, 'outputs');
const REGEN_REL = process.env.SIM_OUT_DIR ?? 'outputs/run/regen';
const REGEN = path.join(ROOT, REGEN_REL);
const RUN_DIR = path.join(ROOT, 'outputs', 'run');

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const problems: string[] = [];
const read = (dir: string, f: string): Buffer | null => {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { problems.push(`${path.relative(ROOT, p)} is missing`); return null; }
  return fs.readFileSync(p);
};

const report: Record<string, unknown> = {
  runtime: process.versions.node,
  regeneratedInto: REGEN_REL,
  tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: 'integers and strings exact; other numbers |a-b| <= atol + rtol*max(|a|,|b|)' },
};

for (const [file, ignore] of [
  ['simulation-results.json', [] as string[]],
  ['calibration-results.json', ['source.simulation.file', 'source.simulation.sha256']],
] as Array<[string, string[]]>) {
  const a = read(COMMITTED, file), b = read(REGEN, file);
  if (!a || !b) continue;
  const diffs = fieldDiff(JSON.parse(a.toString('utf8')), JSON.parse(b.toString('utf8')), ignore);
  const beyond = beyondTolerance(diffs);
  report[file] = {
    committedSha256: sha(a), regeneratedSha256: sha(b), byteIdentical: a.equals(b),
    fieldsDiffering: diffs.length, fieldsBeyondTolerance: beyond.length,
    largestNumericGap: maxima(diffs), ignoredLeaves: ignore,
    differences: diffs.slice(0, 200),
  };
  for (const d of beyond.slice(0, 10)) problems.push(`${file} ${d.path}: committed ${String(d.committed)} vs regenerated ${String(d.thisRun)}`);
  if (beyond.length > 10) problems.push(`${file}: +${beyond.length - 10} more field(s) beyond tolerance`);
}
{
  // The calibration's simulation twin: the regeneration's calibration must name the regenerated
  // simulation by its SHA-256, and that must be the hash the committed calibration names.
  const c = read(COMMITTED, 'calibration-results.json'), r = read(REGEN, 'calibration-results.json');
  const s = read(REGEN, 'simulation-results.json');
  if (c && r && s) {
    const cs = JSON.parse(c.toString('utf8')).source?.simulation?.sha256;
    const rs = JSON.parse(r.toString('utf8')).source?.simulation?.sha256;
    if (rs !== sha(s)) problems.push(`regenerated calibration names simulation ${rs}, the regenerated simulation hashes to ${sha(s)}`);
    report.calibrationSimulationTwin = { committed: cs, regenerated: rs, equal: cs === rs };
  }
}
{
  const a = read(COMMITTED, 'rtp-convergence.html'), b = read(REGEN, 'rtp-convergence.html');
  if (a && b) {
    report['rtp-convergence.html'] = { committedSha256: sha(a), regeneratedSha256: sha(b), byteIdentical: a.equals(b) };
    if (!a.equals(b)) problems.push('rtp-convergence.html: the regenerated chart differs from the committed one');
  }
}

report.problems = problems;
report.verdict = problems.length === 0 ? 'REPRODUCED' : 'NOT REPRODUCED';
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.writeFileSync(path.join(RUN_DIR, 'diff-simulation.json'), JSON.stringify(report, null, 2) + '\n');
// The run record of the verifier (outputs/run/diff.json, written by the `npm test` that precedes
// this in `npm run test:full`) also carries the regeneration's verdict, so one file records both
// the committed-vs-this-run diff and the committed-vs-regenerated diff, each with its runtime.
const runDiffPath = path.join(RUN_DIR, 'diff.json');
if (fs.existsSync(runDiffPath)) {
  const runDiff = JSON.parse(fs.readFileSync(runDiffPath, 'utf8'));
  runDiff.regeneration = {
    record: 'outputs/run/diff-simulation.json', runtime: report.runtime, verdict: report.verdict,
    problems: problems.length,
    fieldsBeyondTolerance: ['simulation-results.json', 'calibration-results.json']
      .map(f => (report[f] as { fieldsBeyondTolerance?: number } | undefined)?.fieldsBeyondTolerance ?? null),
  };
  fs.writeFileSync(runDiffPath, JSON.stringify(runDiff, null, 2) + '\n');
}

console.log('═'.repeat(60));
console.log('  LIQD PLINKO — REGENERATION DIFF (committed outputs/ vs ' + REGEN_REL + ')');
for (const f of ['simulation-results.json', 'calibration-results.json']) {
  const r = report[f] as { byteIdentical: boolean; fieldsDiffering: number; fieldsBeyondTolerance: number; largestNumericGap: unknown } | undefined;
  if (r) console.log(`  ${f}: ${r.byteIdentical ? 'byte-identical' : `${r.fieldsDiffering} field(s) differ, ${r.fieldsBeyondTolerance} beyond tolerance, largest gap ${JSON.stringify(r.largestNumericGap)}`}`);
}
const h = report['rtp-convergence.html'] as { byteIdentical: boolean } | undefined;
if (h) console.log(`  rtp-convergence.html: ${h.byteIdentical ? 'byte-identical' : 'DIFFERS'}`);
console.log(`  Node ${process.versions.node} — ${report.verdict}${problems.length ? `:\n    ${problems.join('\n    ')}` : ''}`);
console.log('  Record: outputs/run/diff-simulation.json');
console.log('═'.repeat(60));
process.exit(problems.length ? 1 : 0);
