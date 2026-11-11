import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { PlinkoConfigData } from './types';

const CONFIG_PATH = join(__dirname, '..', 'plinkoConfig.json');

/**
 * SHA-256 pin of plinkoConfig.json — the audited multiplier tables. The per-config
 * RTP proof is CONDITIONAL on this exact file: Step 7 only verifies slots actually
 * hit in the capture, so the rare tail multipliers (e.g. 1000x at ~0.5^16) rest on
 * this file, not on live data. Both verify.ts and simulate.ts load through here, so
 * any single-byte change to the tables aborts the whole suite at startup.
 */
export const PLINKO_CONFIG_SHA256 = '09bfaeab2b7885ef63d72cebcfe1a667cb8ec604c887cebcdea22e56c2960f0a';

export function configSha256(): string {
  return createHash('sha256').update(readFileSync(CONFIG_PATH)).digest('hex');
}

/**
 * LIQD Plinko config — the audited multiplier tables (27 standard boards + WTF). Every cell is
 * held to what liqd.com/originals/plinko displayed on 20 October 2026 (src/page-labels.ts, Step 20)
 * and every multiplier paid in the production captures equals its cell (Step 7).
 *
 *   payout_tables[rows] = [ low[], medium[], high[] ]   (riskLevel 1,2,3 → index 0,1,2)
 *   wtf_mode            = { riskLevel: 4, rows: 13, odds[] }
 */
export function loadPlinkoConfig(expected: string | null = PLINKO_CONFIG_SHA256): PlinkoConfigData {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`ERROR: plinko config not found at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const raw = readFileSync(CONFIG_PATH);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (expected && sha256 !== expected) {
    console.error('ERROR: plinkoConfig.json SHA-256 mismatch — table differs from the audited artifact');
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${sha256}`);
    process.exit(1);
  }
  return JSON.parse(raw.toString('utf8')) as PlinkoConfigData;
}

/**
 * Pass 1 records a running-mean-RTP sample every this many rounds — the convergence trace.
 *
 * SINGLE-SOURCED HERE (audit-rules 9.4). The producer (`src/simulate.ts`), the historical
 * replay (`src/replay.ts`) and the Step 16 verifier (`tests/steps/simulation.ts`) all read
 * it from this module. Step 16 uses it to require `roundsPerConfig / CONVERGENCE_STEP`
 * finite points per row ending exactly on that row's `simRTP`, so a copy that drifted in
 * any one of the three would silently change what "the trace reconciles" means.
 */
export const CONVERGENCE_STEP = 50_000;

/**
 * Nonces extended per casino seed in the PUBLISHED Pass 2 experiment.
 *
 * SINGLE-SOURCED HERE (audit-rules 9.4) and, like `EXPECTED_BETS` in src/loader.ts,
 * it is the audit's own statement of the size of its experiment — written in code, in the
 * same commit as the artifact it describes, NOT read out of the artifact.
 *
 * It is what makes an edge-hit count falsifiable on its face: Pass 2 splits each seed's
 * nonce stream into two windows of `floor(PASS2_NONCES_PUBLISHED / 2)` drops, so across the
 * `EXPECTED_SEEDS` revealed epochs a single window contains 52 × 5,000 = 260,000 drops
 * and cannot produce more edge hits than that. `src/domains.ts` derives the bound from here;
 * `src/simulate.ts` uses it as the default scale and `tests/steps/simulation.ts` as the
 * publication-scale floor. A deliberate change of scale is a visible source edit that
 * re-dates every Pass 2 figure in the report — that cost is the point.
 *
 * THIS IS THE EXTENDED WINDOW, NOT THE RESULT. 5,000 nonces is 25 to 100 times what was played
 * under any seed in this capture (epochs ran 200, 100 or 50 drops, the capture's rotation plan), so a
 * cherry-pick statistic computed on it measures a session nobody in this capture played. The SCORED
 * window is `PRIMARY_WINDOW_NONCES` in src/loader.ts (50: the shortest planned epoch, the longest window
 * every seed actually played) — it is a property of the captured dataset, so it is declared where the
 * audit states what it captured, and `src/calibrate.ts` and `tests/steps/simulation.ts` import it from
 * there. The 5,000/5,000 split is reported alongside it as the extended-window figure, where
 * it retains its value: far more power against a seed biased across its whole stream.
 */
export const PASS2_NONCES_PUBLISHED = 10_000;

export const WTF_RISK = 4;
export const isWtf = (riskLevel: number): boolean => riskLevel === WTF_RISK;
export const slotCount = (rows: number): number => rows + 1;

/** Multiplier array for a (rows, riskLevel). risk 1/2/3 → FIXED_ODDS; risk 4 → WTF odds. */
export function payoutTable(cfg: PlinkoConfigData, rows: number, riskLevel: number): number[] {
  if (isWtf(riskLevel)) {
    if (rows !== cfg.wtf_mode.rows) throw new Error(`WTF rows must be ${cfg.wtf_mode.rows}, got ${rows}`);
    return cfg.wtf_mode.odds;
  }
  const bucket = cfg.payout_tables[String(rows)];
  if (!bucket) throw new Error(`rows=${rows} not in config`);
  const arr = bucket[riskLevel - 1];
  if (!arr) throw new Error(`riskLevel=${riskLevel} not in config for rows=${rows}`);
  return arr;
}

export function payoutMultiplier(cfg: PlinkoConfigData, rows: number, riskLevel: number, slot: number): number {
  return payoutTable(cfg, rows, riskLevel)[slot];
}

/**
 * Independent binomial slot probability: P(slot=k | rows) = C(rows,k) · 0.5^rows.
 * ANTI-CIRCULARITY: derived from first principles, never from any casino-supplied
 * probability table. This is the reference distribution for RTP and chi-squared.
 */
export function binomP(rows: number, k: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (rows - i)) / (i + 1);
  return c * Math.pow(0.5, rows);
}

/** Theoretical RTP = Σ_k P(k)·multiplier(k), using independent binomial P(k). */
export function theoreticalRTP(cfg: PlinkoConfigData, rows: number, riskLevel: number): number {
  const t = payoutTable(cfg, rows, riskLevel);
  let rtp = 0;
  for (let k = 0; k <= rows; k++) rtp += binomP(rows, k) * t[k];
  return rtp;
}

/** All standard configs (rows 8..16 × risk 1..3 = 27) plus the WTF config. */
export function allConfigs(cfg: PlinkoConfigData, includeWtf = true): { rows: number; riskLevel: number }[] {
  const out: { rows: number; riskLevel: number }[] = [];
  for (let rows = cfg.rows.min; rows <= cfg.rows.max; rows++)
    for (const r of [1, 2, 3]) out.push({ rows, riskLevel: r });
  if (includeWtf) out.push({ rows: cfg.wtf_mode.rows, riskLevel: cfg.wtf_mode.riskLevel });
  return out;
}

export const riskName = (cfg: PlinkoConfigData, riskLevel: number): string =>
  cfg.riskLevels[String(riskLevel)] ?? `risk${riskLevel}`;
