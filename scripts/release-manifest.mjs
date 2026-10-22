#!/usr/bin/env node
/**
 * LIQD Plinko — generator for RELEASE-MANIFEST.json.
 *
 * ── Why this script exists ───────────────────────────────────────────────────
 * The manifest was written BY HAND. Every hash in it was a transcription, and every
 * re-pin of an artifact silently invalidated one — a manifest that lists a hash the file
 * no longer has is worse than no manifest, because it looks like a check and is not one.
 *
 * So the rule here is the same one the audit applies to every other published number:
 *
 *     NOTHING MEASURABLE IS TYPED. Artifact hashes are computed from the bytes on disk;
 *     the verdict and the scored counts are read out of outputs/verification-results.json;
 *     the capture window and the host come out of the dataset's own header.
 *
 * What remains typed is the set of facts no file can supply — the audit's identity and the
 * release it is being cut as. Those are DECLARATIONS, they live in `DECLARED` below, and a
 * change to one is a visible source edit. The audit ID is also cross-checked
 * against every document that publishes it, so the manifest and the report cannot disagree.
 *
 * `--check` also runs the release bar (scripts/release-bar.mjs: LICENSE, second-machine workflow,
 * self-contained pinned pages, one summary shape), so the gate fails without any of them. The
 * runtime of the second-machine job comes out of .nvmrc.
 *
 * Usage:
 *   node scripts/release-manifest.mjs            write RELEASE-MANIFEST.json
 *   node scripts/release-manifest.mjs --check     exit 1 if the committed file is stale or the bar fails
 *
 * `--check` is the last command of `npm test` and runs in `npm run gate`, so a release cannot be
 * cut with a stale manifest or without the release bar.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkReleaseBar, WORKFLOW } from './release-bar.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'RELEASE-MANIFEST.json');
const CHECK = process.argv.includes('--check');

/**
 * The facts no file in this package can supply.
 *
 * `signature` stays `null` until the release is actually signed — a generator must never
 * invent one, and a `null` here is an honest "unsigned", not a missing field. `auditIdStatus`
 * records that ProvablyFair.org has confirmed the audit ID that README and MANIFEST both state
 * (PF-2026-LQ03). `v1.0.1` is an errata release on `v1.0.0`, the first public release (ProvablyFair-org/liqd-plinko, one commit);
 * `v1.0.1` supersedes `v1.0.0`. `signature` is the fingerprint of the SSH key that signs the release commit
 * and tag.
 */
const DECLARED = {
  auditId: 'PF-2026-LQ03',
  auditIdStatus: 'confirmed by ProvablyFair.org',
  game: 'plinko',
  casino: 'liqd',
  release: 'v1.0.1',
  framework: '1.1',
  /** `stage` and `qualifier` describe what the captured host WAS, which no artifact records. */
  environmentStage: 'pre-production',
  environmentQualifier: 'provisional',
  supersedes: 'v1.0.0',
  signature: 'SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY',
};

/**
 * WHICH REPRODUCIBILITY CLAIM THIS PACKAGE MAKES.
 *
 * Reproducibility is a parameter of an audit, not a property of all of them, and a reader cannot
 * tell two audits apart by looking at their artifacts. A sibling Plinko audit pins its simulation
 * seeds, so its experiment is deterministic and its committed artifact is re-derived by running
 * the simulation again. This one does not: Pass 1 draws fresh seeds, so `npm run simulate` with
 * no saved seeds is a NEW experiment rather than a reproduction. What attests
 * `simulation-results.json` is its saved seeds: every row stores the seed pair it was produced
 * with, Step 16 (inside `npm test`) and `npm run replay` re-execute the committed experiment from
 * them, and `npm run regen` regenerates the file with `src/simulate.ts` itself from the same seeds
 * so `npm run diff-simulation` can compare it with the committed file field by field. The file
 * carries no `generatedAt` and no `executionTimeMs` (removed 2026-09-21, PLINKO-27), so a
 * regeneration on the machine that produced it is byte-identical; on another machine one p-value
 * can differ in its last digit, which the field comparison tolerates. (This note used to say the file still carried run
 * metadata and could not be byte-reproduced; both stopped being true when that metadata was
 * removed — 2026-10-02 QA, code item 4.)
 */
const SIMULATION = {
  seeding: 'fresh',
  seedsStored: true,
  attestation: 'replay',
  replayCommand: 'npm run replay',
  note: 'Pass 1 draws fresh crypto.randomBytes seeds per configuration, so npm run simulate with no saved seeds runs a new experiment with different numbers. Each row of outputs/simulation-results.json stores the seed pair it was produced with: Step 16 (inside npm test) and npm run replay re-execute the committed experiment from those seeds and require every derived quantity to reproduce, writing nothing, and npm run regen regenerates the file with src/simulate.ts from the same saved seeds so that npm run diff-simulation can compare it with the committed file field by field. The file carries no generatedAt and no executionTimeMs, so a regeneration on the machine that produced it is byte-identical; on another machine one p-value can differ in its last digit, which the field comparison tolerates.',
};

/** Every file whose bytes the release is a claim about. Order is the manifest's order. */
const ARTIFACTS = [
  'outputs/calibration-results.json',
  'outputs/coverage-results.json',
  'outputs/simulation-results.json',
  'outputs/verification-results.json',
  'outputs/rtp-claim-table.json',   // RTP-CLAIM per-setting table (src/rtp-settings.ts pins it)
  'outputs/verification-stats.json',
  'data/plinko-master-10100bets.json',
  'plinkoConfig.json',
];

/** Documents that publish the audit ID. If any disagrees, the release is incoherent. */
// Since the 4 October 2026 consolidation the package carries exactly two Markdown documents.
const AUDIT_ID_DOCS = ['README.md', 'MANIFEST.md'];

const problems = [];
const fail = (msg) => problems.push(msg);

const sha256 = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`${rel} is missing — cannot hash an artifact that is not there`); return null; }
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
};

const readJson = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`${rel} is missing`); return null; }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    fail(`${rel} is not valid JSON: ${e.message}`);
    return null;
  }
};

// ── The release bar (Framework 1.0 review item 14) ────────────────────────────

for (const p of checkReleaseBar(ROOT)) fail(`release bar: ${p}`);

// ── Measured, not typed ───────────────────────────────────────────────────────

const results = readJson('outputs/verification-results.json');
const dataset = readJson('data/plinko-master-10100bets.json');

const artifacts = {};
for (const rel of ARTIFACTS) {
  const h = sha256(rel);
  if (h) artifacts[rel] = h;
}

// The verdict and the counts are the RUN's, read out of the artifact the run wrote. A
// manifest that asserted a verdict of its own would be a second, unverified source for the
// one claim the whole package exists to make.
const summary = results?.summary ?? {};
const outcome = results?.outcome ?? {};
const verdict = summary.verdict;
const scored = outcome.scored;
if (typeof verdict !== 'string' || !verdict) {
  fail('outputs/verification-results.json has no summary.verdict — run `npm test` before cutting a release');
}
if (!scored || typeof scored.passed !== 'number' || typeof scored.of !== 'number') {
  fail('outputs/verification-results.json has no outcome.scored block');
}
// A release must not be cut from a run that did not complete or that failed its own guards.
if (outcome.overallStatus !== 'PASS' || outcome.completed !== true) {
  fail(`the committed run is overallStatus=${JSON.stringify(outcome.overallStatus)} completed=${JSON.stringify(outcome.completed)} — a release manifest may only describe a completed PASS`);
}

// The dataset SHA-256 is computed here AND cross-checked against what the verifier recorded,
// so a manifest can never name a dataset the audit did not actually run on.
const datasetSha256 = artifacts['data/plinko-master-10100bets.json'] ?? null;
if (datasetSha256 && results?.datasetSha256 && results.datasetSha256 !== datasetSha256) {
  fail(`dataset on disk hashes to ${datasetSha256} but the verification run recorded ${results.datasetSha256}`);
}

// Capture window and host come out of the dataset's own header — the capture is the thing
// being described, so it is the thing that gets to say when it ran and where.
const meta = dataset?.meta ?? {};
if (!meta.startedAt || !meta.finishedAt) fail('dataset meta is missing startedAt / finishedAt');
if (!meta.platform) fail('dataset meta is missing platform');

// ── Declared, and held consistent with the documents ─────────────────────────

for (const doc of AUDIT_ID_DOCS) {
  const abs = path.join(ROOT, doc);
  if (!fs.existsSync(abs)) { fail(`${doc} is missing`); continue; }
  if (!fs.readFileSync(abs, 'utf8').includes(DECLARED.auditId)) {
    fail(`${doc} does not carry the declared audit ID ${DECLARED.auditId}`);
  }
}

const nvmrc = fs.existsSync(path.join(ROOT, '.nvmrc')) ? fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim() : null;

// ── The manifest ──────────────────────────────────────────────────────────────
// No "$schema": the URL it used to carry
// (provablyfair.org/framework/1.0/release-manifest.schema.json) does not resolve to a
// document. A dead schema reference is a claim of validation that nothing performs, so the
// key is absent until a schema is actually published at a resolvable address.

const manifest = {
  auditId: DECLARED.auditId,
  auditIdStatus: DECLARED.auditIdStatus,
  game: DECLARED.game,
  casino: DECLARED.casino,
  release: DECLARED.release,
  framework: DECLARED.framework,
  simulation: SIMULATION,
  datasetSha256,
  artifacts,
  verdict,
  scored,
  capturedAt: { from: meta.startedAt ?? null, to: meta.finishedAt ?? null },
  environment: {
    host: meta.platform ?? null,
    stage: DECLARED.environmentStage,
    qualifier: DECLARED.environmentQualifier,
  },
  // The second-machine run the release bar requires: what runs, where, on which runtime. The run's
  // own result is written by that job, never typed here.
  reproduction: { workflow: WORKFLOW, runner: 'ubuntu-latest', node: nvmrc, command: 'npm ci && npm test' },
  supersedes: DECLARED.supersedes,
  signature: DECLARED.signature,
};

if (problems.length > 0) {
  console.error('  [release-manifest] cannot produce a manifest:');
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}

const rendered = `${JSON.stringify(manifest, null, 2)}\n`;

if (CHECK) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('  [release-manifest] RELEASE-MANIFEST.json is missing — run `npm run release-manifest`');
    process.exit(1);
  }
  const committed = fs.readFileSync(MANIFEST_PATH, 'utf8');
  if (committed !== rendered) {
    console.error('  [release-manifest] RELEASE-MANIFEST.json is STALE — it does not match the files in the working tree.');
    // Name the fields that moved, so the operator sees WHAT went stale rather than "it differs".
    let before;
    try { before = JSON.parse(committed); } catch { before = null; }
    if (before) {
      const walk = (a, b, prefix) => {
        const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
        for (const k of keys) {
          const va = a?.[k];
          const vb = b?.[k];
          const p = prefix ? `${prefix}.${k}` : k;
          if (va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va)) walk(va, vb, p);
          else if (JSON.stringify(va) !== JSON.stringify(vb)) {
            console.error(`    ${p}: committed ${JSON.stringify(va)} vs working tree ${JSON.stringify(vb)}`);
          }
        }
      };
      walk(before, manifest, '');
    }
    console.error('  Regenerate with `npm run release-manifest`.');
    process.exit(1);
  }
  console.log(`  [release-manifest] OK: release bar met; ${Object.keys(artifacts).length} artifact hashes match disk, verdict "${verdict}", scored ${scored.passed}/${scored.of}`);
  process.exit(0);
}

fs.writeFileSync(MANIFEST_PATH, rendered);
console.log(`  [release-manifest] wrote RELEASE-MANIFEST.json — ${Object.keys(artifacts).length} artifacts, verdict "${verdict}", scored ${scored.passed}/${scored.of} (flags ${scored.flags}, hardFail ${scored.hardFail})`);
