/**
 * Field-level diffs between a verification run and the committed artifacts it evaluated.
 *
 * ── WHY (client QA 2026-09-10, D1 — swept to Plinko 2026-09-11) ─────────────────────────────────
 * `npm run verify` used to overwrite `outputs/verification-results.json`,
 * `outputs/verification-stats.json` and `outputs/coverage-results.json` at the end of every run.
 * All three are artifacts of record — `evidence.md` names `verification-stats.json` as THE
 * producing artifact for figures quoted in the chapters — and the `artifactHashes` block inside
 * `verification-results.json` pins the other two, so a single run replaced both the evidence and
 * the hashes of the evidence.
 *
 * The defect was found and fixed on the sibling Dice audit first: a reviewer ran the suite on
 * Node 24, got a FAIL, re-ran it, got a PASS, and nothing was left to show the first result —
 * because the failing run had already rewritten the file the second run compared against.
 * Repeated testing must not be able to erase an original disagreement. Phase 9 of the audit
 * methodology requires a closed finding to be swept as a CLASS across sibling games; this file is
 * that sweep applied to Plinko, and it is a copy of `dice/src/diff.ts` by intent.
 *
 * Verification now writes nothing into the committed paths. It writes this run's results — pass or
 * fail — under `outputs/run/`, together with a field-level diff against the committed artifacts, so
 * the disagreement is recorded rather than resolved in favour of the newest run. Producing a
 * replacement for the committed artifacts is a separate, explicit command (`PF_EMIT=1`).
 */

export type Leaf = string | number | boolean | null;

/** Flatten a JSON value to `dotted.path` → leaf. Arrays index as `path[0]`. */
export function flattenLeaves(value: unknown, prefix = '', out: Map<string, Leaf> = new Map()): Map<string, Leaf> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, value as Leaf);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, '<empty array>');
    value.forEach((v, i) => flattenLeaves(v, `${prefix}[${i}]`, out));
    return out;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) out.set(prefix, '<empty object>');
  for (const k of keys) flattenLeaves((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

export interface FieldDiff {
  path: string;
  committed: Leaf | '<absent>';
  thisRun: Leaf | '<absent>';
}

/**
 * Every leaf on which `committed` and `thisRun` disagree, by path. `ignore` drops paths whose
 * dotted name matches exactly — used for `generatedAt`, which differs by construction on every run
 * and would otherwise be the only entry in every diff.
 */
export function fieldDiff(committed: unknown, thisRun: unknown, ignore: readonly string[] = []): FieldDiff[] {
  const a = flattenLeaves(committed);
  const b = flattenLeaves(thisRun);
  const skip = new Set(ignore);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: FieldDiff[] = [];
  for (const p of paths) {
    if (skip.has(p)) continue;
    const inA = a.has(p), inB = b.has(p);
    const va = inA ? a.get(p)! : '<absent>';
    const vb = inB ? b.get(p)! : '<absent>';
    if (!Object.is(va, vb)) out.push({ path: p, committed: va, thisRun: vb });
  }
  return out;
}
