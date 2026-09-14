/**
 * LIQD Plinko — calibrated null for the payout-weighted window-RTP count (FIX-19).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Pass 2 scores each revealed casino seed by a payout-weighted window statistic
 *
 *     zEarly = (rtpEarly − mu) / (sd / sqrt(n)),   n = floor(noncesPerSeed / 2)
 *
 * where `mu` and `sd` are the EXACT per-config mean and standard deviation of one
 * drop's payout multiplier (independent binomial × the pinned payout table), and
 * `rtpEarly` is the mean multiplier over the seed's first n nonces.
 *
 * The suite then counts how many of the 202 seeds have `zEarly < −1.645` and asks
 * whether that count is materially above chance. The original null was
 * `Binom(202, 0.05)` — i.e. "z is standard normal, so 5% of seeds fall below the
 * 5% one-sided critical value". **That null is wrong for this statistic.** A window
 * payout sum is a sum of n draws from a violently right-skewed distribution (a 16-row
 * high-risk board pays 1000x at probability 2^-16 and 0.2x at probability 0.79), so
 * the standardised sample mean is NOT normal at n = 5,000: its left tail is much
 * thinner than the normal's. P(zEarly < −1.645) is therefore config-specific and
 * well below 0.05 — for 16 rows / risk 3 it is about one twenty-fifth of 0.05.
 *
 * Round-2 external review (N1) found that the corrected expectation had been written
 * into nine chapters and into the Step 17 detail string as a HARD-CODED LITERAL that
 * no code in the repository computed. This module is the fix: it computes the null
 * from first principles, and both the producer (`src/simulate.ts`, `src/calibrate.ts`)
 * and the verifier (`tests/steps/simulation.ts`) read it from HERE — one module, one
 * constant, no literal anywhere.
 *
 * METHOD — EXACT, NOT APPROXIMATE
 * -------------------------------
 * Every multiplier in `plinkoConfig.json` is an integer multiple of 0.1, so the
 * window payout sum lives on a lattice. `exactLeftTailProbability` convolves the
 * per-drop payout distribution with itself n times on that lattice, truncating at the
 * threshold (payouts are non-negative, so a partial sum that has already passed the
 * threshold can never come back — the truncation is exact, not an approximation).
 * The result is the exact left-tail probability to double-precision rounding.
 *
 * A saddlepoint (Lugannani–Rice) approximation was tried first and REJECTED: it is
 * 26% high on the WTF config, whose payout support is {0, 235, 1000} and therefore
 * far too lumpy for a continuous tail expansion. An approximation whose error is
 * config-dependent is not usable for a scored gate, so the DP is what ships.
 *
 * Two independent cross-checks guard the DP (see tests/plinko/calibrationTests.ts):
 *   - brute-force enumeration of every sequence at small n (exact agreement);
 *   - `enumerationLeftTailProbability`, a closed-form multinomial sum available when
 *     the payout support has at most three distinct values, run at the FULL n = 5,000
 *     on the WTF config by a completely different code path.
 *
 * Aggregation across seeds is a Poisson-binomial (each epoch has its own success
 * probability because each epoch has its own board/risk), computed exactly by DP.
 */

import type { Bet, PlinkoConfigData, Seed } from './types';
import { payoutTable, theoreticalRTP, binomP } from './config';

/**
 * The one-sided normal critical value the payout-weighted count is defined against.
 * PRODUCER AND VERIFIER MUST BOTH READ THIS CONSTANT FROM HERE (audit-rules 9.4):
 * `src/simulate.ts` uses it to classify each seed, `src/calibrate.ts` and
 * `tests/steps/simulation.ts` use it to compute the null the classification is scored
 * against. A copy in either place is the defect this module was written to remove.
 */
export const Z_LEFT_TAIL = 1.645;

/** Multiplier values are integer multiples of 0.1 in every shipped payout table. */
const LATTICE_SCALE = 10;

export interface ValueProb {
  /** Payout multiplier. */
  value: number;
  /** P(one drop pays exactly `value`) under the independent binomial. */
  prob: number;
}

export interface EpochConfig {
  epoch: number;
  rows: number;
  riskLevel: number;
}

export interface ConfigCalibration {
  /** "<rows>/<riskLevel>", e.g. "16/3". */
  config: string;
  rows: number;
  riskLevel: number;
  /** How many revealed epochs in the capture ran on this config. */
  epochs: number;
  /** Exact per-drop payout mean (= theoretical RTP) and SD. */
  mu: number;
  sd: number;
  /** Window length in nonces (half the per-seed nonce stream). */
  windowNonces: number;
  /** zEarly < −z  <=>  window payout SUM < sumThreshold. */
  sumThreshold: number;
  /** The same threshold expressed as a window RTP (sumThreshold / windowNonces). */
  windowRtpThreshold: number;
  /** Lattice spacing the exact convolution ran on (gcd of the payout values). */
  latticeUnit: number;
  /** EXACT P(zEarly < −z) for one seed on this config. */
  leftTailProbability: number;
  /** Independent closed-form check where the payout support allows one, else null. */
  crossCheck: {
    method: string;
    probability: number;
    relativeDifference: number;
  } | null;
}

export interface EpochCalibration extends EpochConfig {
  leftTailProbability: number;
}

export interface Calibration {
  method: string;
  zThreshold: number;
  windowNonces: number;
  epochs: number;
  /** Σ p_i — the calibrated (Poisson-binomial) expected count of seeds below −z. */
  expectedZEarlyBelow1645Calibrated: number;
  /** Σ p_i(1 − p_i) and its square root. */
  varianceCalibrated: number;
  sdCalibrated: number;
  /** The naive null the original code used, kept so the two can be compared. */
  expectedZEarlyBelow1645Naive: number;
  byConfig: ConfigCalibration[];
  perEpoch: EpochCalibration[];
}

// ── Per-drop payout distribution ──────────────────────────────────────────────

/**
 * Exact per-config payout mean and SD.
 *
 * Kept as a slot-ordered sum (NOT a sum over the merged value distribution) because
 * this is the same arithmetic, in the same order, that `src/simulate.ts` used to
 * produce the committed Pass-2 z values. Reordering the sum would move the result by
 * a few ULP and put the Step 17 recompute off its 1e-9 attestation tolerance for no
 * reason. Producer and verifier both call THIS function.
 */
export function payoutMuSd(cfg: PlinkoConfigData, rows: number, riskLevel: number): { mu: number; sd: number } {
  const t = payoutTable(cfg, rows, riskLevel);
  const mu = theoreticalRTP(cfg, rows, riskLevel);
  let ex2 = 0;
  for (let k = 0; k <= rows; k++) ex2 += binomP(rows, k) * t[k] * t[k];
  return { mu, sd: Math.sqrt(ex2 - mu * mu) };
}

/** Payout multipliers merged by value, with P(value) from the independent binomial. */
export function payoutValueDistribution(cfg: PlinkoConfigData, rows: number, riskLevel: number): ValueProb[] {
  const t = payoutTable(cfg, rows, riskLevel);
  const merged = new Map<number, number>();
  for (let k = 0; k <= rows; k++) merged.set(t[k], (merged.get(t[k]) ?? 0) + binomP(rows, k));
  return [...merged.entries()]
    .map(([value, prob]) => ({ value, prob }))
    .sort((a, b) => a.value - b.value);
}

/** zEarly < −z  <=>  Σ payouts over `n` drops < this threshold. */
export function leftTailSumThreshold(mu: number, sd: number, n: number, z: number): number {
  return n * mu - z * sd * Math.sqrt(n);
}

// ── Exact left-tail probability ───────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b > 0) { const t = a % b; a = b; b = t; }
  return a;
}

export interface ExactLeftTail {
  probability: number;
  latticeUnit: number;
  /** Number of lattice states carried by the DP (diagnostic). */
  states: number;
}

/**
 * EXACT P(Σ_{i=1..n} X_i < threshold) for iid X drawn from `dist`.
 *
 * The payout values are integer multiples of 0.1, so the sum lives on a lattice of
 * spacing gcd(values)/10. The DP carries the probability of every reachable lattice
 * point at or below the threshold and convolves n times. Points above the threshold
 * are dropped: every payout is >= 0, so a partial sum that has exceeded the threshold
 * can never return below it, which makes the truncation exact rather than an
 * approximation. Weights are shifted by the minimum so the retained window is as
 * small as possible.
 *
 * Throws if a value is not on the 0.1 lattice — silently rounding a table that has
 * changed shape would be exactly the kind of quiet mis-calibration this module exists
 * to remove.
 */
export function exactLeftTailProbability(dist: ValueProb[], n: number, threshold: number): ExactLeftTail {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`exactLeftTailProbability: n must be a positive integer, got ${n}`);
  if (!Number.isFinite(threshold)) throw new Error('exactLeftTailProbability: threshold must be finite');
  if (dist.length === 0) throw new Error('exactLeftTailProbability: empty distribution');

  const scaled = dist.map(({ value }) => {
    const s = Math.round(value * LATTICE_SCALE);
    if (Math.abs(value * LATTICE_SCALE - s) > 1e-9) {
      throw new Error(`exactLeftTailProbability: payout ${value} is not a multiple of ${1 / LATTICE_SCALE}`);
    }
    if (s < 0) throw new Error(`exactLeftTailProbability: negative payout ${value}`);
    return s;
  });

  let unit = 0;
  for (const s of scaled) unit = gcd(unit, s);
  if (unit === 0) unit = 1;                    // degenerate: every payout is 0

  const wAbs = scaled.map(s => s / unit);
  const wMin = Math.min(...wAbs);
  const w = wAbs.map(x => x - wMin);           // shift the support down to 0
  const p = dist.map(d => d.prob);
  const wMax = Math.max(...w);

  // Largest lattice point STRICTLY below the threshold, in shifted coordinates.
  const tLattice = (threshold * LATTICE_SCALE) / unit;
  const isLatticePoint = Math.abs(tLattice - Math.round(tLattice)) < 1e-9;
  const capAbs = isLatticePoint ? Math.round(tLattice) - 1 : Math.floor(tLattice);
  const cap = capAbs - n * wMin;
  const latticeUnit = unit / LATTICE_SCALE;
  if (cap < 0) return { probability: 0, latticeUnit, states: 0 };
  if (wMax === 0) return { probability: 1, latticeUnit, states: 1 };   // constant payout, below threshold

  let cur = new Float64Array(cap + 1);
  let next = new Float64Array(cap + 1);
  cur[0] = 1;
  let hi = 0;                                   // highest reachable index so far
  for (let j = 0; j < n; j++) {
    const newHi = Math.min(cap, hi + wMax);
    next.fill(0, 0, newHi + 1);
    for (let i = 0; i < w.length; i++) {
      const wi = w[i];
      const pi = p[i];
      if (pi === 0) continue;
      const end = Math.min(hi, cap - wi);
      for (let s = 0; s <= end; s++) {
        const c = cur[s];
        if (c !== 0) next[s + wi] += c * pi;
      }
    }
    hi = newHi;
    const swap = cur; cur = next; next = swap;
  }

  let acc = 0;
  for (let s = 0; s <= hi; s++) acc += cur[s];
  return { probability: acc, latticeUnit, states: cap + 1 };
}

/**
 * Independent closed-form P(Σ X_i < threshold) for a support of at most three distinct
 * values, by direct multinomial enumeration over the two non-minimum value counts.
 *
 * This shares NO code with `exactLeftTailProbability` — different algorithm, different
 * arithmetic (log-gamma multinomial terms rather than a convolution) — which is what
 * makes it a real cross-check rather than a restatement. Available on the WTF config
 * (support {0, 235, 1000}) at the full n = 5,000. Returns null when the support is
 * larger, in which case the small-n brute-force test is the anchor instead.
 */
export function enumerationLeftTailProbability(dist: ValueProb[], n: number, threshold: number): number | null {
  if (dist.length > 3) return null;
  const sorted = [...dist].sort((a, b) => a.value - b.value);
  const base = sorted[0];
  const rest = sorted.slice(1);
  const logFact: number[] = [0];
  for (let i = 1; i <= n; i++) logFact.push(logFact[i - 1] + Math.log(i));
  const logP = sorted.map(d => (d.prob > 0 ? Math.log(d.prob) : -Infinity));

  let acc = 0;
  const v1 = rest[0]?.value ?? 0;
  const v2 = rest[1]?.value ?? 0;
  const maxC2 = rest.length > 1 && v2 > 0 ? Math.floor(Math.max(0, threshold - n * base.value) / v2) : 0;
  for (let c2 = 0; c2 <= maxC2; c2++) {
    const maxC1 = rest.length > 0 && v1 > 0
      ? Math.floor(Math.max(0, threshold - n * base.value - c2 * v2) / v1)
      : 0;
    for (let c1 = 0; c1 <= maxC1; c1++) {
      const c0 = n - c1 - c2;
      if (c0 < 0) break;
      // Strict inequality: the enumeration bound above is inclusive, so re-test.
      if (!(n * base.value + c1 * v1 + c2 * v2 < threshold)) continue;
      const lp = logFact[n] - logFact[c0] - logFact[c1] - logFact[c2]
        + c0 * logP[0] + c1 * logP[1] + (rest.length > 1 ? c2 * logP[2] : 0);
      if (Number.isFinite(lp)) acc += Math.exp(lp);
    }
  }
  return acc;
}

// ── Poisson-binomial aggregation ──────────────────────────────────────────────

/** Exact pmf of Σ Bernoulli(p_i) by DP. pmf[k] = P(exactly k successes). */
export function poissonBinomialPmf(ps: number[]): Float64Array {
  let pmf = new Float64Array(1);
  pmf[0] = 1;
  for (const p of ps) {
    const next = new Float64Array(pmf.length + 1);
    for (let k = 0; k < pmf.length; k++) {
      next[k] += pmf[k] * (1 - p);
      next[k + 1] += pmf[k] * p;
    }
    pmf = next;
  }
  return pmf;
}

/** P(X >= k) for X ~ PoissonBinomial(ps). */
export function poissonBinomialSurvival(ps: number[], k: number): number {
  const pmf = poissonBinomialPmf(ps);
  let acc = 0;
  for (let i = Math.max(0, k); i < pmf.length; i++) acc += pmf[i];
  return Math.min(1, Math.max(0, acc));
}

// ── Population: which epochs, on which board ──────────────────────────────────

/**
 * The (rows, riskLevel) each REVEALED epoch's Pass-2 probe is run on, taken from the
 * dataset's own bets — never from the simulation artifact.
 *
 * G-BIND: the population of the calibrated null is bound to the capture's source
 * records. An artifact that drops or relabels Pass-2 rows cannot shrink or reshape
 * the null it is scored against, because the null is rebuilt from `seeds` and `bets`.
 * `src/simulate.ts` selects with `boardOfEpoch` from THIS module, so producer and
 * verifier cannot drift apart (audit-rules 9.4).
 *
 * ── QA-06 (round-4 client QA, EXECUTED order probe) ───────────────────────────
 * This used to be "the first bet encountered while iterating `bets[]`", i.e. FILE-ARRAY
 * ORDER. 192 of the 202 epochs carry exactly one board, so for those the rule is
 * irrelevant; the ten Phase D epochs 152–161 each carry **50 bets spread over all 27
 * standard boards**, and for those the selected board was whatever happened to be first
 * in the file. Reversing the in-memory array moved epoch 152 from 8r/1 to 15r/2, epoch
 * 161 from 14r/1 to 12r/2, and changed the selection in all eight epochs between — so a
 * pure re-serialisation of the same records changed the scored null.
 *
 * The rule is now EXPLICIT AND ORDER-FREE: **the board of the epoch's LOWEST-NONCE bet**,
 * with `(numberOfRows, riskLevel)` as a deterministic tie-break in the (impossible, by
 * Step 4) event of a duplicate nonce. Nonce is recorded per bet and is the epoch's own
 * ordering, so any permutation of `bets[]` yields the same answer.
 *
 * On the committed capture the two rules agree on all 202 epochs (bets are stored in
 * nonce order), so this changes no published figure — it removes a dependency on
 * serialisation order that was never intended and could not be relied on.
 *
 * WHAT THIS DOES NOT MAKE THE ANALYSIS. Pass 2 evaluates ONE board for all 10,000
 * synthetic nonces of a mixed-board epoch. That is a **synthetic fixed-board probe** of
 * the seed's payout stream, not a replay of the epoch's actual mixed-board payout
 * schedule, and the early window (5,000 nonces) is two orders of magnitude longer than
 * the 50 bets actually observed under the seed. Conclusions are limited accordingly —
 * see AUDIT_CONTEXT.md §10 and DL-5.
 */
export function boardOfEpoch(epochBets: Bet[]): { rows: number; riskLevel: number } | null {
  let best: Bet | null = null;
  for (const b of epochBets) {
    if (best === null
      || b.nonce < best.nonce
      || (b.nonce === best.nonce && (b.numberOfRows < best.numberOfRows
        || (b.numberOfRows === best.numberOfRows && b.riskLevel < best.riskLevel)))) {
      best = b;
    }
  }
  return best === null ? null : { rows: best.numberOfRows, riskLevel: best.riskLevel };
}

/** `hashedServerSeed` → that epoch's bets, for `boardOfEpoch`. */
export function betsByHash(bets: Bet[]): Map<string, Bet[]> {
  const m = new Map<string, Bet[]>();
  for (const b of bets) {
    const arr = m.get(b.hashedServerSeed) ?? [];
    arr.push(b);
    m.set(b.hashedServerSeed, arr);
  }
  return m;
}

export function revealedEpochConfigs(bets: Bet[], seeds: Seed[]): EpochConfig[] {
  const byHash = betsByHash(bets);
  return seeds
    .filter(s => !!s.serverSeed)
    .map(s => {
      const board = boardOfEpoch(byHash.get(s.hashedServerSeed) ?? []);
      return {
        epoch: s.epoch,
        rows: board?.rows ?? 16,
        riskLevel: board?.riskLevel ?? 3,
      };
    });
}

// ── The calibration ───────────────────────────────────────────────────────────

export const CALIBRATION_METHOD =
  'exact lattice convolution of the per-drop payout distribution (independent binomial x pinned payout table) '
  + 'over the window, truncated at the threshold; aggregated across epochs as an exact Poisson-binomial DP';

/**
 * Compute the calibrated null for "how many seeds should fall below −z by chance".
 *
 * `windowNonces` is the EARLY-window length the statistic is computed on, i.e.
 * floor(noncesPerSeed / 2) — not the full nonce stream.
 */
export function calibrateLeftTailCount(
  cfg: PlinkoConfigData,
  epochs: EpochConfig[],
  windowNonces: number,
  z: number = Z_LEFT_TAIL,
): Calibration {
  const byKey = new Map<string, EpochConfig[]>();
  for (const e of epochs) {
    const key = `${e.rows}/${e.riskLevel}`;
    const arr = byKey.get(key) ?? [];
    arr.push(e);
    byKey.set(key, arr);
  }

  const byConfig: ConfigCalibration[] = [];
  const probByKey = new Map<string, number>();
  const ordered = [...byKey.entries()].sort((a, b) =>
    (a[1][0].rows - b[1][0].rows) || (a[1][0].riskLevel - b[1][0].riskLevel));
  for (const [key, group] of ordered) {
    const { rows, riskLevel } = group[0];
    const dist = payoutValueDistribution(cfg, rows, riskLevel);
    const { mu, sd } = payoutMuSd(cfg, rows, riskLevel);
    const sumThreshold = leftTailSumThreshold(mu, sd, windowNonces, z);
    const exact = exactLeftTailProbability(dist, windowNonces, sumThreshold);
    const alt = enumerationLeftTailProbability(dist, windowNonces, sumThreshold);
    byConfig.push({
      config: key,
      rows,
      riskLevel,
      epochs: group.length,
      mu,
      sd,
      windowNonces,
      sumThreshold,
      windowRtpThreshold: sumThreshold / windowNonces,
      latticeUnit: exact.latticeUnit,
      leftTailProbability: exact.probability,
      crossCheck: alt === null ? null : {
        method: 'closed-form multinomial enumeration over the non-minimum payout counts',
        probability: alt,
        relativeDifference: alt === 0 ? (exact.probability === 0 ? 0 : Infinity) : (exact.probability - alt) / alt,
      },
    });
    probByKey.set(key, exact.probability);
  }

  const perEpoch: EpochCalibration[] = epochs.map(e => ({
    ...e,
    leftTailProbability: probByKey.get(`${e.rows}/${e.riskLevel}`) as number,
  }));
  const ps = perEpoch.map(e => e.leftTailProbability);
  const expectation = ps.reduce((s, p) => s + p, 0);
  const variance = ps.reduce((s, p) => s + p * (1 - p), 0);

  return {
    method: CALIBRATION_METHOD,
    zThreshold: z,
    windowNonces,
    epochs: epochs.length,
    expectedZEarlyBelow1645Calibrated: expectation,
    varianceCalibrated: variance,
    sdCalibrated: Math.sqrt(variance),
    // The null the pre-FIX-19 code used: "z is normal, so 5% of seeds fall below the
    // 5% critical value". Retained purely so the artifact carries both and a reader can
    // see the size of the miscalibration without having to trust a sentence about it.
    expectedZEarlyBelow1645Naive: epochs.length * 0.05,
    byConfig,
    perEpoch,
  };
}

/** P(count >= observed) under the calibrated Poisson-binomial null. */
export function calibratedSurvival(calibration: Calibration, observedCount: number): number {
  return poissonBinomialSurvival(calibration.perEpoch.map(e => e.leftTailProbability), observedCount);
}
