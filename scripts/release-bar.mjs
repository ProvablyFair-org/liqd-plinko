/**
 * release-bar.mjs — the package-level release bar (Framework 1.0 review of 2026-09-28, item 14:
 * F12 second-machine reproduction, F15 LICENSE + manifest by script, F16 no CDN script in a
 * pinned chart, F20 one summary shape).
 *
 * This file is byte-identical in every audit package of this release. `scripts/release-manifest.mjs`
 * imports it, so `node scripts/release-manifest.mjs --check` (the last command of `npm test`)
 * fails whenever any of the four is missing. The bar is a gate, not a note: a package that
 * loses its LICENSE, loads a chart library from a CDN, writes a different summary shape or
 * drops its second-machine workflow cannot pass `npm test`.
 *
 * Plain Node, no dependencies. Reads only; never writes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/** SHA-256 of the MIT LICENSE every ProvablyFair.org audit package ships. */
export const LICENSE_SHA256 = '46f66577b80a1b1bf0d228bb6dc41d651218ea3ba2ad9968c82f039f426bb697';

/**
 * The ONE summary shape of outputs/verification-results.json, in this key order.
 *   passed        steps with status PASS
 *   flags         steps with status FLAG  (= operatorFlags + captureFlags)
 *   operatorFlags FLAGs that downgrade the verdict
 *   captureFlags  FLAGs that are verdict-neutral (capture-origin). An INFO step (profile policy
 *                 INFORMATIONAL — the live-sample fit, 2026-09-29) is not a flag and is not
 *                 counted in any of these keys.
 *   hardFail      steps with status FAIL
 *   verdict       the verdict string
 * Anything else a package wants to say about the run lives OUTSIDE `summary`.
 */
export const SUMMARY_KEYS = ['passed', 'flags', 'operatorFlags', 'captureFlags', 'hardFail', 'verdict'];

/** The second-machine job: a clean ubuntu-latest runner, Node from .nvmrc, npm ci && npm test. */
export const WORKFLOW = '.github/workflows/reproduce.yml';
const WORKFLOW_MUST_CONTAIN = ['runs-on: ubuntu-latest', 'node-version-file: .nvmrc', 'npm ci', 'npm test'];

/** A pinned page must be self-contained: no script or stylesheet fetched from another host. */
const EXTERNAL_ASSET = /<(script|link)\b[^>]*\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i;

export function checkReleaseBar(root) {
  const problems = [];
  const abs = (rel) => path.join(root, rel);
  const has = (rel) => fs.existsSync(abs(rel));

  // F15 — LICENSE present and the standard text.
  if (!has('LICENSE')) problems.push('LICENSE is missing');
  else {
    const h = createHash('sha256').update(fs.readFileSync(abs('LICENSE'))).digest('hex');
    if (h !== LICENSE_SHA256) problems.push(`LICENSE sha256 ${h} is not the standard LICENSE (${LICENSE_SHA256})`);
  }

  // F12 — the second-machine run is part of the package, with the runtime it pins.
  if (!has('.nvmrc')) problems.push('.nvmrc is missing — the second machine cannot pin the runtime');
  if (!has(WORKFLOW)) problems.push(`${WORKFLOW} is missing — no second-machine reproduction`);
  else {
    const wf = fs.readFileSync(abs(WORKFLOW), 'utf8');
    for (const s of WORKFLOW_MUST_CONTAIN) if (!wf.includes(s)) problems.push(`${WORKFLOW} does not contain "${s}"`);
  }

  // F16 — every committed page under outputs/ is self-contained.
  if (has('outputs')) {
    for (const f of fs.readdirSync(abs('outputs'))) {
      if (!/\.html?$/i.test(f)) continue;
      const m = fs.readFileSync(abs(`outputs/${f}`), 'utf8').match(EXTERNAL_ASSET);
      if (m) problems.push(`outputs/${f} loads an external asset (${m[0].slice(0, 80)}) — inline it`);
    }
  }

  // F20 — one summary shape, and its counts agree with the steps it summarises.
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(abs('outputs/verification-results.json'), 'utf8')); }
  catch (e) { problems.push(`outputs/verification-results.json unreadable: ${e.message}`); }
  if (doc) {
    const s = doc.summary;
    if (!s || typeof s !== 'object') problems.push('outputs/verification-results.json has no summary block');
    else {
      const keys = Object.keys(s);
      if (JSON.stringify(keys) !== JSON.stringify(SUMMARY_KEYS)) {
        problems.push(`summary keys ${JSON.stringify(keys)} are not the one summary shape ${JSON.stringify(SUMMARY_KEYS)}`);
      }
      for (const k of SUMMARY_KEYS.slice(0, 5)) {
        if (!Number.isInteger(s[k]) || s[k] < 0) problems.push(`summary.${k} is ${JSON.stringify(s[k])} — not a non-negative integer`);
      }
      if (typeof s.verdict !== 'string' || !s.verdict) problems.push('summary.verdict is not a non-empty string');
      if (s.flags !== s.operatorFlags + s.captureFlags) problems.push(`summary.flags ${s.flags} ≠ operatorFlags ${s.operatorFlags} + captureFlags ${s.captureFlags}`);
      const steps = Array.isArray(doc.steps) ? doc.steps : [];
      const count = (st) => steps.filter((x) => x.status === st).length;
      for (const [k, st] of [['passed', 'PASS'], ['flags', 'FLAG'], ['hardFail', 'FAIL']]) {
        if (s[k] !== count(st)) problems.push(`summary.${k} is ${s[k]} but ${count(st)} steps have status ${st}`);
      }
    }
  }
  return problems;
}
