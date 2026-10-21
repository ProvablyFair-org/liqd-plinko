/**
 * LIQD Plinko — the Pass-2 per-epoch drop scan, single-sourced.
 *
 * `tests/steps/simulation.ts` attests the committed Pass-2 rows by replaying every
 * nonce of every revealed epoch through the HMAC and rebuilding that epoch's slot
 * frequencies, window payout sums and edge-hit counts. That scan is the verifier's
 * single most expensive recompute and it is INDEPENDENT per epoch, so it is also the
 * unit `src/parallel.ts` hands to a worker thread.
 *
 * It lives here, in one function, precisely so the serial path and the worker path
 * cannot drift: both call `pass2EpochKernel`. The arithmetic is unchanged from the
 * loop it replaces — slot by summing `rows` HMAC bits, payout accumulated in NONCE
 * ORDER by a single thread — so a scan computed on a worker and one computed on the
 * calling thread are the same float, not merely the same value to within rounding.
 */

import { generateProvablyFairNumber } from './rng';

/**
 * One drop's slot: the number of right-turns over `rows` independent HMAC bits.
 * Mirrors `src/simulate.ts` exactly — deterministic given (serverSeed, clientSeed,
 * rows, nonce), no randomness.
 */
export function simSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  let slot = 0;
  for (let i = 0; i < rows; i++) slot += generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
  return slot;
}

/** One epoch's scan request. Structured-cloneable — it crosses a thread boundary. */
export interface Pass2EpochJob {
  serverSeed: string;
  clientSeed: string;
  rows: number;
  /** Total nonces replayed under this seed. */
  nonces: number;
  /** Nonces [0, half) are the early window, [half, nonces) the late one. */
  half: number;
  /** The pinned payout table for this epoch's board, indexed by slot. */
  table: number[];
  /** Frequency-array stride in the flat result — max(rows)+1 over the whole batch. */
  stride: number;
}

/** What one scan produces. */
export interface Pass2EpochScan {
  earlyFreq: number[];
  lateFreq: number[];
  payEarly: number;
  payLate: number;
  edgeEarly: number;
  edgeLate: number;
}

/** Float64 slots one scan occupies in the shared result buffer. */
export const pass2ScanSlots = (stride: number): number => 4 + 2 * stride;

/**
 * Replay one epoch. Written against a flat float64 view so the result can be handed
 * back across a `SharedArrayBuffer` without serialisation.
 */
export function pass2EpochKernel(job: unknown, out: Float64Array): void {
  const j = job as Pass2EpochJob;
  const rows = j.rows;
  const table = j.table;
  const half = j.half;
  const earlyFreq = new Array<number>(rows + 1).fill(0);
  const lateFreq = new Array<number>(rows + 1).fill(0);
  let payEarly = 0;
  let payLate = 0;
  let edgeEarly = 0;
  let edgeLate = 0;
  for (let nonce = 0; nonce < j.nonces; nonce++) {
    const slot = simSlot(j.serverSeed, j.clientSeed, nonce, rows);
    // An edge hit is a drop in the outermost slot on either side.
    const isEdge = slot === 0 || slot === rows;
    if (nonce < half) { earlyFreq[slot]++; payEarly += table[slot]; if (isEdge) edgeEarly++; }
    else              { lateFreq[slot]++;  payLate  += table[slot]; if (isEdge) edgeLate++; }
  }
  out[0] = payEarly;
  out[1] = payLate;
  out[2] = edgeEarly;
  out[3] = edgeLate;
  for (let k = 0; k <= rows; k++) {
    out[4 + k] = earlyFreq[k];
    out[4 + j.stride + k] = lateFreq[k];
  }
}

/** Read one scan back out of the flat float64 view `pass2EpochKernel` wrote. */
export function readPass2Scan(out: Float64Array, rows: number, stride: number): Pass2EpochScan {
  const earlyFreq = new Array<number>(rows + 1).fill(0);
  const lateFreq = new Array<number>(rows + 1).fill(0);
  for (let k = 0; k <= rows; k++) {
    earlyFreq[k] = out[4 + k];
    lateFreq[k] = out[4 + stride + k];
  }
  return {
    earlyFreq, lateFreq,
    payEarly: out[0], payLate: out[1],
    edgeEarly: out[2], edgeLate: out[3],
  };
}
