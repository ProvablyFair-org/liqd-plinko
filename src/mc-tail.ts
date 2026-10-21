/**
 * LIQD Plinko — Monte-Carlo estimate of the window left tail, one chunk of replicates.
 *
 * WHAT THIS IS
 * ------------
 * The third independent anchor on `exactLeftTailProbability` (see the header of
 * `src/calibration.ts`): simulate a full `n`-drop window directly and count how often its
 * payout sum falls below the threshold. The brute-force enumeration is exact but only
 * reaches n = 5-7, and the closed-form multinomial only exists where the payout support
 * has at most three values; direct simulation reaches the production n = 5,000 on any
 * board, which is the gap it fills. `tests/plinko/calibrationTests.ts` is its only caller.
 *
 * WHY IT LIVES IN src/
 * --------------------
 * So that one function is the whole estimator, and the calling thread and the worker
 * threads `src/parallel.ts` hands replicates to run the SAME code. Replicates are iid, so
 * a chunk of them is an independent unit of work; only the integer hit count crosses the
 * thread boundary, and integer counts add exactly.
 *
 * ENTROPY IS FRESH, NEVER PINNED — deliberately. The anchor must not be able to pass only
 * for one lucky stream, so every chunk draws its own uniforms from `randomFillSync`. This
 * estimate therefore differs from run to run by design: it is checked against the DP at a
 * 5-standard-error tolerance, and it is not an input to any published figure.
 */

import { randomFillSync } from 'node:crypto';

const SCALE = 2 ** 32;

/**
 * Uniforms from crypto entropy, buffered. `crypto.randomInt` per draw would be hundreds
 * of millions of calls here; `randomFillSync` into a Uint32Array gives the same source
 * in bulk.
 */
export function makeUniformStream(): () => number {
  const buf = new Uint32Array(1 << 16);
  let i = buf.length;
  return () => {
    if (i >= buf.length) { randomFillSync(buf); i = 0; }
    return buf[i++] / SCALE;
  };
}

/** One chunk of replicates. Structured-cloneable — it crosses a thread boundary. */
export interface McLeftTailJob {
  /** Payout values, and the cumulative probabilities that select them. */
  values: number[];
  cum: number[];
  /** Drops per simulated window. */
  n: number;
  threshold: number;
  replicates: number;
}

/** Float64 slots one chunk occupies: the hit count. */
export const MC_LEFT_TAIL_SLOTS = 1;

/** Count the windows in this chunk whose payout sum falls below the threshold. */
export function mcLeftTailKernel(job: unknown, out: Float64Array): void {
  const j = job as McLeftTailJob;
  const { values, cum, n, threshold, replicates } = j;
  const nextU = makeUniformStream();
  let hits = 0;
  for (let r = 0; r < replicates; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = nextU();
      let k = 0;
      while (u > cum[k]) k++;
      sum += values[k];
    }
    if (sum < threshold) hits++;
  }
  out[0] = hits;
}

/**
 * Split `replicates` into `chunks` pieces that sum back to exactly `replicates`.
 * The estimator is over the same total number of iid windows either way.
 */
export function splitReplicates(replicates: number, chunks: number): number[] {
  const c = Math.max(1, Math.min(chunks, replicates));
  const base = Math.floor(replicates / c);
  const extra = replicates - base * c;
  return Array.from({ length: c }, (_, i) => base + (i < extra ? 1 : 0));
}
