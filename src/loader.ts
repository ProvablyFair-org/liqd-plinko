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
export const EXPECTED_DATASET_SHA256 = '83965cdc5381db3ad99bf7c1c1e1d2e0d90f574132f96642027599c0edea8a16';

/**
 * The scored dataset: the PRODUCTION captures on liqd.com, three runs on one account (rounds of 7, 9 and 10
 * November 2026), converted from the runner's exports by the private workshop's converter into one file. The
 * file's own `meta.captures` names each source file with its SHA-256 and `meta.conversion` states where every
 * field came from.
 */
export const DATASET_FILE = 'data/plinko-prod-9750bets.json';

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
 * The statement of how big this audit is must NOT live inside the file being audited. If the
 * step that checks the population takes its expectation from `meta` — `epochSize`, `plannedTotal`,
 * `phases` — the audited data defines its own pass condition, and the check is vacuous however
 * strict it looks. A destructured binding hides this especially well: `const { epochSize } = ctx`
 * reads like a constant and is in fact a field of the evidence.
 *
 * The consequence is a doctored capture that passes cleanly. Delete nonces 30–49 from every epoch,
 * set the header's epoch sizes to 30, adjust `meta.plannedTotal`, rewrite `meta.phases`, set every
 * `seeds[].nonceEnd = 29`, re-pin the dataset hash and regenerate the simulation, and a suite
 * bound to `meta` returns a clean Full Pass on a dataset missing 40% of its drops.
 *
 * These four constants are the audit's own statement of its population. Steps 11 and 12 compare
 * the loaded data against them AND reconcile the dataset's header against them, so a doctored
 * header is a hard fail rather than simply an unread field. Changing them is a visible source
 * edit in the same commit as the dataset — which is exactly the property `meta` lacks.
 *
 * If a re-capture changes the plan, change these, and then every figure in the report that quotes
 * them has to change too. That cost is the point.
 */

/** Bets in the delivered captures. Quoted throughout the report as "9,750 drops". */
export const EXPECTED_BETS = 9750;

/** Seed epochs in the delivered captures. Quoted throughout as "52 epochs / 52 seeds". */
export const EXPECTED_SEEDS = 52;

/** The phase letters the production plan declares. */
export const EXPECTED_PHASES = ['A', 'B', 'C', 'D', 'E'] as const;
export type PlanPhase = typeof EXPECTED_PHASES[number];

/**
 * THE PRODUCTION PLAN, one entry per plan id, in the order played. The plan, in code — not `meta.phases`,
 * which is inside the evidence.
 *
 *   id      the runner's plan entry. Equal to the phase letter except 'A+W': the 50 Phase A drops on the WTF
 *           board (risk 4, 13 rows), played so that the 28th configuration also meets the Phase A floor.
 *   phase   the phase letter the entry belongs to.
 *   capture 1-based index of the capture file that holds it (meta.captures).
 *   bets, epochs, epochSize   bets = epochs × epochSize, asserted by Step 12.
 *   stake   the stake of every drop of the entry, as the served 8-dp string.
 *
 * Capture 1 (rounds 7 Nov 2026): A. Capture 2 (9 Nov): D, B, A+W, E in that order. Capture 3 (10 Nov): C.
 * Every epoch of an entry has the same length; the lengths differ between entries (200, 100, 50), so there is no
 * single epoch size: Steps 4 and 12 hold each epoch to the length of its own entry.
 */
export interface PlanEntry {
  id: string; phase: PlanPhase; capture: number; bets: number; epochs: number; epochSize: number; stake: string;
}
export const EXPECTED_PLAN: readonly PlanEntry[] = [
  { id: 'A',   phase: 'A', capture: 1, bets: 5000, epochs: 25, epochSize: 200, stake: '0.10000000' },
  { id: 'D',   phase: 'D', capture: 2, bets: 500,  epochs: 5,  epochSize: 100, stake: '0.10000000' },
  { id: 'B',   phase: 'B', capture: 2, bets: 2000, epochs: 10, epochSize: 200, stake: '0.10000000' },
  { id: 'A+W', phase: 'A', capture: 2, bets: 50,   epochs: 1,  epochSize: 50,  stake: '0.10000000' },
  { id: 'E',   phase: 'E', capture: 2, bets: 2000, epochs: 10, epochSize: 200, stake: '0.10000000' },
  { id: 'C',   phase: 'C', capture: 3, bets: 200,  epochs: 1,  epochSize: 200, stake: '10.00000000' },
];

/**
 * Planned epoch length per plan id, in drops. Steps 4 and 12 compare every epoch's observed length with this
 * code constant, never with a length read from the dataset (G-BIND). Built from EXPECTED_PLAN, so the two
 * cannot disagree: A 200, D 100, B 200, A+W 50, E 200, C 200.
 */
export const EXPECTED_EPOCH_SIZE: Readonly<Record<string, number>> =
  Object.freeze(Object.fromEntries(EXPECTED_PLAN.map(e => [e.id, e.epochSize])));

/** The plan entry of a plan id, or undefined for an id the plan never declared. */
export function planEntry(id: string): PlanEntry | undefined {
  return EXPECTED_PLAN.find(e => e.id === id);
}

/**
 * Planned bets per phase letter. `EXPECTED_BETS` must be their sum and must equal Σ epochs × epochSize over
 * EXPECTED_PLAN; both are asserted by Steps 11 and 12 so the constants cannot drift apart.
 * A = 5,000 on the 27 standard settings + 50 on the WTF board (plan id A+W).
 */
export const EXPECTED_PHASE_BETS: Readonly<Record<PlanPhase, number>> =
  { A: 5050, B: 2000, C: 200, D: 500, E: 2000 };

/** Capture files in the dataset (meta.captures) and the epochs each contributes, in order. */
export const EXPECTED_CAPTURE_EPOCHS: readonly number[] = [25, 26, 1];

/**
 * The shortest epoch of the plan, in drops: the longest nonce window that EVERY one of the 52 seeds actually
 * played (epochs ran 200, 100 or 50 drops). It is the primary, scored window of Pass 2 (Step 17,
 * src/calibrate.ts). Step 12 asserts it equals the minimum epochSize of EXPECTED_PLAN.
 */
export const PRIMARY_WINDOW_NONCES = 50;

/**
 * Minimum Phase-A bets required per configuration (framework Plinko profile PLINKO-15 floor: "Bets per config
 * (Phase A) ≥ 50"). Declared here in code — the plan, not the evidence — so Step 9 asserts the per-config
 * sample floor against a constant rather than against a count read from the dataset it is scoring. Phase A
 * runs 185 or 186 drops on each of the 27 standard settings and 50 on the WTF board (plan id A+W).
 */
export const MIN_PHASE_A_BETS_PER_CONFIG = 50;

/** Minimum distinct player-set client seeds in Phase D (profile PLINKO-06 floor). */
export const MIN_PHASE_D_PLAYER_SEEDS = 2;

/** Minimum elevated-stake bets in Phase C (profile PLINKO-12 floor). */
export const MIN_PHASE_C_BETS = 100;

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
