/**
 * ONE PASS-1 CONFIGURATION, PLAYED — shared by the generator (src/simulate.ts), the standalone
 * replay (src/replay.ts) and the full replay inside scored Step 16 (tests/steps/simulation.ts,
 * through src/parallel.ts).
 *
 * Until 2026-09-24 this loop existed twice, inline in src/simulate.ts and again in src/replay.ts,
 * and Step 16 did not replay at all — it checked the committed scalars against each other and
 * against theory. It is moved here UNCHANGED from src/simulate.ts: the same calls in the same
 * order — the slot as the sum of `rows` calls to generateProvablyFairNumber(…, cursor i+1,
 * range 2), the payout added from the pinned table in nonce order, the running mean pushed every
 * CONVERGENCE_STEP rounds, the binary win sequence `slot > rows/2 ? 0 : 1` fed to
 * lag1Autocorrelation and runsTest — so the committed outputs/simulation-results.json, produced
 * by that inline loop, is what this function must reproduce, and Step 16 proves on every run
 * that it does.
 */

import { generateProvablyFairNumber } from './rng';
import { lag1Autocorrelation, runsTest } from './stats';

export interface Pass1Played {
  /** The census: how many of the `rounds` drops landed in each slot 0..rows. */
  slotFreq: number[];
  /** Σ table[slot] accumulated in nonce order. */
  payoutSum: number;
  /** Running mean payout after every `convergenceStep` rounds. */
  convergence: number[];
  r1: number;
  runsZ: number;
  runsP: number;
}

/** One round: winningSlot = count of right-bits over `rows` (src/simulate.ts simulateSlot). */
export function simulateSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  let slot = 0;
  for (let i = 0; i < rows; i++) {
    slot += generateProvablyFairNumber(serverSeed, clientSeed, nonce, i + 1, 2);
  }
  return slot;
}

/** Play `rounds` rounds of one configuration from one seed pair. */
export function playPass1Config(
  rows: number,
  table: number[],
  serverSeed: string,
  clientSeed: string,
  rounds: number,
  convergenceStep: number,
): Pass1Played {
  const slotFreq = new Array(rows + 1).fill(0);
  const winSequence = new Uint8Array(rounds);
  let payoutSum = 0;
  const convergence: number[] = [];

  for (let nonce = 0; nonce < rounds; nonce++) {
    const slot = simulateSlot(serverSeed, clientSeed, nonce, rows);
    slotFreq[slot]++;
    payoutSum += table[slot];
    winSequence[nonce] = slot > rows / 2 ? 0 : 1; // binary for serial test
    if ((nonce + 1) % convergenceStep === 0) convergence.push(payoutSum / (nonce + 1));
  }

  const seq = Array.from(winSequence) as number[];
  const r1 = lag1Autocorrelation(seq);
  const { z: runsZ, pValue: runsP } = runsTest(seq);
  return { slotFreq, payoutSum, convergence, r1, runsZ, runsP };
}

/** A replay job as it crosses the worker boundary (structured-cloneable). */
export interface Pass1Job {
  rows: number;
  table: number[];
  serverSeed: string;
  clientSeed: string;
  rounds: number;
  convergenceStep: number;
}

/** Float64 slots per job: 17 slot counts (16 rows max), the trace, payoutSum, r1, runsZ, runsP. */
export const PASS1_MAX_SLOTS = 17;
export function pass1Points(job: Pass1Job): number {
  return Math.floor(job.rounds / job.convergenceStep);
}
export function pass1Slots(job: Pass1Job): number {
  return PASS1_MAX_SLOTS + pass1Points(job) + 4;
}

/** Worker kernel: play one configuration and pack the result. */
export function pass1ConfigKernel(job: unknown, out: Float64Array): void {
  const j = job as Pass1Job;
  const r = playPass1Config(j.rows, j.table, j.serverSeed, j.clientSeed, j.rounds, j.convergenceStep);
  out.fill(NaN);
  for (let k = 0; k < r.slotFreq.length; k++) out[k] = r.slotFreq[k];
  for (let i = 0; i < r.convergence.length; i++) out[PASS1_MAX_SLOTS + i] = r.convergence[i];
  const t = PASS1_MAX_SLOTS + pass1Points(j);
  out[t] = r.payoutSum;
  out[t + 1] = r.r1;
  out[t + 2] = r.runsZ;
  out[t + 3] = r.runsP;
}

/** Unpack a kernel result. */
export function unpackPass1(job: Pass1Job, out: Float64Array): Pass1Played {
  const n = pass1Points(job);
  const t = PASS1_MAX_SLOTS + n;
  return {
    slotFreq: Array.from(out.subarray(0, job.rows + 1)),
    convergence: Array.from(out.subarray(PASS1_MAX_SLOTS, PASS1_MAX_SLOTS + n)),
    payoutSum: out[t],
    r1: out[t + 1],
    runsZ: out[t + 2],
    runsP: out[t + 3],
  };
}
