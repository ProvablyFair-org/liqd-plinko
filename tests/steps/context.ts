import type { Bet, Seed, PlinkoConfigData, CaptureRecord, DatasetMeta } from '../../src/types';

/**
 * Machine-readable numerics a step emitted, keyed by name.
 *
 * WHY THIS EXISTS. `detail` is a SENTENCE — it ships to the client, it is quoted back at
 * us, and it is authored prose however many of its numbers are interpolated. That makes it
 * unusable as the producing artifact for a figure cited in a chapter: a check that accepts
 * it as a source accepts any literal someone types into a step label, which is exactly how
 * a hard-coded expected count could pass unchecked. `data` is the same figures as machine values, and
 * `verify.ts` writes them to `outputs/verification-stats.json` so every number quoted in the
 * report traces to a file that code wrote rather than to a sentence.
 */
export type StepData = Record<string, number | string | boolean | number[] | string[] | Record<string, number>>;

/**
 * How many scored steps this suite has — the suite's own statement, in code. tests/verify.ts refuses to
 * reach a verdict unless exactly this many steps ran (a run that crashed or skipped part of the suite must
 * not be able to print a summary that looks like a clean one), and scripts/check-outputs.mjs reads the
 * number from this line when it checks the committed record.
 */
export const EXPECTED_STEPS = 21;

export interface StepResult {
  step: number;
  name: string;
  /**
   * INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit):
   * reported, never counted as a flag, never affects the verdict.
   */
  /** OVERSTATED: the PLINKO-19 step when the enforced RTP-CLAIM rule (1.2.0) finds the published figure overstated — not a draw FAIL. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO' | 'OVERSTATED';
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
  /** Phase A: the 27 standard settings in turn (5,000) plus 50 drops on the WTF board (plan id A+W). */
  phaseA: Bet[];
  /** Phase B: 16 rows / high risk, deep sample. */
  phaseB: Bet[];
  /** Phase C: the Phase B board at the elevated stake. */
  phaseC: Bet[];
  /** Phase D: player-set client seeds. */
  phaseD: Bet[];
  /** Phase E: WTF mode (riskLevel 4, rows 13). */
  phaseE: Bet[];
  /**
   * The dataset's own header, VERBATIM — evidence to be reconciled, never the plan.
   *
   * G-BIND. Until revision 4 this context carried `epochSize` and `phasesMeta`, lifted out of
   * `meta` and handed to Steps 11/12 as their expectation. That made the audited population
   * self-referential: shrink the data, doctor the header, re-pin, and every count agreed again.
   * The expectation now comes from `src/loader.ts` (`EXPECTED_BETS`, `EXPECTED_SEEDS`,
   * `EXPECTED_PLAN`, `EXPECTED_PHASE_BETS`) and this field exists so those steps can hard-
   * fail a header that DISAGREES with them. Nothing may take a cardinality from it.
   */
  meta: DatasetMeta;
  outputsDir: string;
  /** Recomputed SHA-256 of the loaded dataset file. */
  datasetSha256: string;
  /** The dataset hash pinned in verify.ts (the integrity anchor). */
  expectedDatasetHash: string;
  /**
   * The capture files the dataset was built from (meta.captures), each with its own pre-capture anchor: the
   * seed pair active before that capture's first round and the rotation that revealed it.
   */
  captures: CaptureRecord[];
}

export function step(
  num: number,
  name: string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  data?: StepData,
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
}
