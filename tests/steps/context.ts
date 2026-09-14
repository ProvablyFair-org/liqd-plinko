import type { Bet, Seed, PlinkoConfigData, PreCapture, DatasetMeta } from '../../src/types';

/**
 * Machine-readable numerics a step emitted, keyed by name.
 *
 * WHY THIS EXISTS. `detail` is a SENTENCE — it ships to the client, it is quoted back at
 * us, and it is authored prose however many of its numbers are interpolated. That makes it
 * unusable as the producing artifact for a figure cited in a chapter: a check that accepts
 * it as a source accepts any literal someone types into a step label, which is exactly the
 * hole round-2 finding N1 came through. `data` is the same figures as machine values, and
 * `verify.ts` writes them to `outputs/verification-stats.json` so every number quoted in the
 * report traces to a file that code wrote rather than to a sentence.
 */
export type StepData = Record<string, number | string | boolean | number[] | string[] | Record<string, number>>;

export interface StepResult {
  step: number;
  name: string;
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
  data?: StepData;
}

export interface InfoItem {
  label: string;
  detail: string;
  data?: StepData;
}

export interface VerifyContext {
  bets: Bet[];
  seeds: Seed[];
  cfg: PlinkoConfigData;
  /** hashedServerSeed → revealed serverSeed (only for revealed epochs). */
  seedMap: Map<string, string>;
  /** hashedServerSeed → bets in that epoch. */
  byHash: Map<string, Bet[]>;
  phaseA: Bet[];
  phaseB: Bet[];
  phaseC: Bet[];
  phaseD: Bet[];
  phaseE: Bet[];   // WTF mode (riskLevel 4, rows 13)
  /**
   * The dataset's own header, VERBATIM — evidence to be reconciled, never the plan.
   *
   * G-BIND. Until revision 4 this context carried `epochSize` and `phasesMeta`, lifted out of
   * `meta` and handed to Steps 11/12 as their expectation. That made the audited population
   * self-referential: shrink the data, doctor the header, re-pin, and every count agreed again.
   * The expectation now comes from `src/loader.ts` (`EXPECTED_BETS`, `EXPECTED_SEEDS`,
   * `EXPECTED_EPOCH_SIZE`, `EXPECTED_PHASE_BETS`) and this field exists so those steps can hard-
   * fail a header that DISAGREES with them. Nothing may take a cardinality from it.
   */
  meta: DatasetMeta;
  outputsDir: string;
  /** Recomputed SHA-256 of the loaded dataset file. */
  datasetSha256: string;
  /** The dataset hash pinned in verify.ts (the integrity anchor). */
  expectedDatasetHash: string;
  /** Pre-capture commitment record (meta.preCapture), if present in the dataset. */
  preCapture?: PreCapture;
}

export function step(
  num: number,
  name: string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string,
  data?: StepData,
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
}
