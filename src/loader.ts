import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { Dataset, Seed, Bet } from './types';

/**
 * SHA-256 pin of the captured master dataset — the integrity anchor for the whole audit.
 *
 * ONE DEFINITION (audit-rules 9.4). It used to be re-declared as a literal in
 * `tests/verify.ts` and again in `src/simulate.ts`, and adding `src/calibrate.ts` would have
 * made three copies of a 64-character string that must never diverge. Every consumer imports
 * it from here, and `scripts/check-outputs.mjs` reads it out of THIS file when it re-asserts
 * that the committed artifacts match the pin.
 */
export const EXPECTED_DATASET_SHA256 = '871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════
 *  THE AUDITED POPULATION — G-BIND. A ROW COUNT IS NOT AN IDENTITY.
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 * The SHA-256 above proves the dataset has not changed since WE pinned it. It does NOT prove
 * that the file is the capture. Shrink `bets[]`, drop the matching `seeds[]` rows, edit
 * `meta.plannedTotal` / `meta.epochSize` / `meta.phases` to agree, re-pin — and the repository
 * is internally consistent again on a smaller population than the one this report describes.
 *
 * Until revision 4 the only statement of how big this audit is lived INSIDE the file being
 * audited: `tests/steps/dataset.ts` destructured `epochSize` and `phasesMeta` off the context,
 * both of which came straight from `meta`, and compared the observed counts against them. The
 * binding was destructured rather than written as `=== meta.epochSize`, which is why it survived
 * three review rounds; it was found by this repository's own class sweep on K1/K2 and disclosed
 * in revision 3 (round-3 ledger §D.6) before being closed here.
 *
 * A reviewer executed the consequence on the sibling `dice` audit on 2026-09-09: delete nonces
 * 30–49 from every epoch (6,700 → 4,020 bets), set `meta.epochSize = 30`, `meta.plannedTotal =
 * 4020`, rewrite `meta.phases`, set every `seeds[].nonceEnd = 29`, re-pin the dataset hash and
 * regenerate the simulation — 21/21 PROVABLY FAIR — Full Pass on a 4,020-bet dataset.
 *
 * These four constants are the audit's own statement of its population. Steps 11 and 12 compare
 * the loaded data against them AND reconcile the dataset's header against them, so a doctored
 * header is a hard fail rather than simply an unread field. Changing them is a visible source
 * edit in the same commit as the dataset — which is exactly the property `meta` lacks.
 *
 * If a re-capture changes the plan, change these, and then every figure in the report that quotes
 * them has to change too. That cost is the point.
 */

/** Bets in the delivered capture. Quoted throughout the report as "10,100 drops". */
export const EXPECTED_BETS = 10100;

/** Seed epochs in the delivered capture. Quoted throughout as "202 epochs / 202 seeds". */
export const EXPECTED_SEEDS = 202;

/** Bets per epoch — nonces 0..49 under one (serverSeed, clientSeed) pair. */
export const EXPECTED_EPOCH_SIZE = 50;

/**
 * Planned bets per capture phase. The plan, in code — not `meta.phases`, which is inside the
 * evidence. `EXPECTED_BETS` must be their sum, and `EXPECTED_SEEDS × EXPECTED_EPOCH_SIZE` must
 * equal it too; both are asserted by Steps 11 and 12 so the constants cannot drift apart.
 */
export const EXPECTED_PHASE_BETS: Readonly<Record<'A' | 'B' | 'C' | 'D' | 'E', number>> =
  { A: 5400, B: 2000, C: 200, D: 500, E: 2000 };

export interface LoadedDataset extends Dataset {
  sha256: string;
  path: string;
}

export function loadDataset(path: string, expectedSha256?: string): LoadedDataset {
  if (!existsSync(path)) {
    console.error(`ERROR: dataset not found at ${path}`);
    process.exit(1);
  }
  const raw = readFileSync(path);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) {
    console.error(`ERROR: dataset SHA-256 mismatch`);
    console.error(`  expected: ${expectedSha256}`);
    console.error(`  actual:   ${sha256}`);
    process.exit(1);
  }
  const parsed = JSON.parse(raw.toString('utf8')) as Dataset;
  return { ...parsed, sha256, path };
}

/** O(1) lookup: hashedServerSeed → its Seed entry (with revealed serverSeed once rotated). */
export function revealedSeedMap(seeds: Seed[]): Map<string, Seed> {
  const m = new Map<string, Seed>();
  for (const s of seeds) m.set(s.hashedServerSeed, s);
  return m;
}

/** epoch index → Seed entry. */
export function seedByEpoch(seeds: Seed[]): Map<number, Seed> {
  const m = new Map<number, Seed>();
  for (const s of seeds) m.set(s.epoch, s);
  return m;
}

/** epoch index → its bets. */
export function betsByEpoch(bets: Bet[]): Map<number, Bet[]> {
  const m = new Map<number, Bet[]>();
  for (const b of bets) {
    const a = m.get(b.epoch);
    if (a) a.push(b); else m.set(b.epoch, [b]);
  }
  return m;
}

export function phaseBets(bets: Bet[], phase: string): Bet[] {
  return bets.filter((b) => b.phase === phase);
}
