/**
 * LIQD Plinko — execution of INDEPENDENT units of work across worker threads.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Two of the verifier's recomputes dominate its wall clock and neither of them is a
 * single long dependency chain:
 *
 *   * the exact lattice convolution in `src/calibration.ts`, run once per DISTINCT
 *     (rows, riskLevel) board — 28 independent DPs that share no state; and
 *   * the Pass-2 execution attestation in `tests/steps/simulation.ts`, which replays
 *     `noncesPerSeed` drops per revealed epoch through the HMAC — 202 independent
 *     scans that share no state.
 *
 * Since 2026-09-24 there is a third: the full Pass-1 replay in Step 16 (src/pass1.ts), 28
 * independent configurations × 1,000,000 rounds, one configuration per job.
 *
 * All are pure functions of their inputs, so they can run on several threads at once.
 *
 * WHAT THIS MODULE MUST NOT DO — AND DOES NOT DO
 * ----------------------------------------------
 * It changes NO arithmetic. A unit of work is the SAME function, called with the SAME
 * arguments, in the same order INSIDE the unit; only the thread it runs on differs.
 * Nothing is split across threads that accumulates a floating-point sum — a window
 * payout sum is accumulated in nonce order by one thread, a DP convolves its lattice
 * in one thread — so every result is bit-identical to the serial run, not merely equal
 * to within a tolerance. The `PF_PARALLEL=0` escape hatch below forces the serial path,
 * and the two must agree byte for byte in the emitted artifacts.
 *
 * Results come back through a `SharedArrayBuffer` of float64 slots rather than through
 * `postMessage`, because the callers are synchronous: `calibrateLeftTailCount` returns a
 * value and the attestation loop is a plain `for`. The calling thread claims jobs from
 * the same queue the workers pull from — so it is never idle — and then blocks on
 * `Atomics.wait` until every job is marked done.
 *
 * FAILURE IS ALWAYS RECOVERABLE. A job whose worker threw, died, or never started is
 * left marked not-done, and the calling thread recomputes it itself after the wait —
 * which both produces the right answer and surfaces the real exception on the thread
 * that can report it. The parallel path can therefore only ever make the suite faster
 * or slower, never wrong.
 *
 * WHEN IT IS INACTIVE
 * -------------------
 * Workers are spawned by re-entering the standalone bundle (`verify.js` / `test.js`),
 * which the build's runtime shim re-routes to `__pfWorkerMain` instead of the bundle's
 * own entry point. Under `ts-node` there is no such bundle, `__pfStandaloneEntry` is
 * undefined, and every batch runs serially on the calling thread.
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

/** A unit of work: fill `out` from `job`. Must be pure and must not touch shared state. */
export type ParallelKernel = (job: unknown, out: Float64Array) => void;

/**
 * kind -> kernel, resolved LAZILY.
 *
 * The modules that own the kernels import this one, so a top-level import in the other
 * direction would be a cycle. By the time a job runs, the owning module is loaded (the
 * caller is inside it), or the worker loads it here on first use.
 */
export function kernelFor(kind: string): ParallelKernel {
  switch (kind) {
    case 'exact-left-tail':
      return require('./calibration').exactLeftTailKernel as ParallelKernel;
    case 'pass2-epoch-scan':
      return require('./pass2').pass2EpochKernel as ParallelKernel;
    case 'mc-left-tail':
      return require('./mc-tail').mcLeftTailKernel as ParallelKernel;
    case 'pass1-config':
      return require('./pass1').pass1ConfigKernel as ParallelKernel;
    default:
      throw new Error(`parallel: unknown kernel kind ${JSON.stringify(kind)}`);
  }
}

/** Bundle module id of THIS file, as the standalone runtime keys it. */
const WORKER_MODULE = 'src/parallel.js';

// Control-word indices (Int32Array over a SharedArrayBuffer).
const CTL_NEXT = 0;   // next unclaimed job index; claimed with Atomics.add
const CTL_DONE = 1;   // completed-job counter; the futex word the caller waits on
const CTL_WORDS = 2;

// Per-job status (Int32Array over a SharedArrayBuffer).
const ST_TODO = 0;
const ST_CLAIMED = 1;
const ST_DONE = 2;

/** No progress for this long ⇒ assume the remaining workers are gone and finish locally. */
const STALL_MS = 120_000;

interface WorkerBoot {
  __pfWorkerModule: string;
  kind: string;
  jobs: unknown[];
  slots: number;
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  results: SharedArrayBuffer;
}

/** The standalone bundle's own path, published by scripts/standalone-runtime.cjs. */
function standaloneEntry(): string | undefined {
  return (globalThis as unknown as { __pfStandaloneEntry?: string }).__pfStandaloneEntry;
}

/** `PF_PARALLEL=0` forces the serial path — the control used to prove bit-identity. */
function parallelEnabled(): boolean {
  return process.env.PF_PARALLEL !== '0';
}

/**
 * How many EXTRA threads to ask for, never more than there is work for.
 *
 * Deliberately not `availableParallelism()`. On the hybrid CPUs Node reports a single
 * number for, the second half of that number is efficiency cores, and loading them does
 * not buy proportional throughput. Measured on this suite (12 reported, 8 performance +
 * 4 efficiency, Node 22.23.1), `node verify.js` wall clock against the worker count:
 * 0→70.4s, 3→23.5s, 5→19.3s, 6→18.3s, 7→19.6s, 8→21.0s, 9→22.1s, 11→24.5s. Past ~60% of
 * the reported count it gets slower while burning three times the CPU. `PF_PARALLEL_WORKERS`
 * overrides it for a machine that wants a different split.
 */
function workerCount(jobs: number): number {
  let cores = 1;
  try { cores = availableParallelism(); } catch { cores = 1; }
  let threads = Math.max(2, Math.round(cores * 0.6));
  const override = parseInt(process.env.PF_PARALLEL_WORKERS ?? '', 10);
  if (Number.isFinite(override) && override >= 0) threads = override + 1;
  return Math.max(0, Math.min(jobs - 1, threads - 1));
}

/**
 * How many threads a batch could actually use here — for callers that have to CHOOSE how
 * many pieces to cut their work into (a replicate count, say) rather than being handed a
 * natural set of units. Returns 1 when the parallel path is unavailable or switched off.
 */
export function parallelWidth(): number {
  if (!parallelEnabled() || standaloneEntry() === undefined) return 1;
  return workerCount(Number.MAX_SAFE_INTEGER) + 1;
}

/**
 * Run `jobs` through the `kind` kernel and return one float64 view per job.
 *
 * `worthParallel` is the CALLER's judgement that the batch is big enough to pay for
 * thread start-up (each worker re-parses the bundle). A small batch runs serially.
 */
export function runBatch(
  kind: string,
  jobs: unknown[],
  slots: number,
  worthParallel: boolean,
): Float64Array[] {
  const kernel = kernelFor(kind);
  const entry = standaloneEntry();
  const useWorkers = worthParallel && parallelEnabled() && jobs.length >= 2
    && entry !== undefined && workerCount(jobs.length) >= 1;

  if (!useWorkers) {
    const results = new Float64Array(jobs.length * slots);
    for (let i = 0; i < jobs.length; i++) kernel(jobs[i], results.subarray(i * slots, (i + 1) * slots));
    return jobs.map((_, i) => results.subarray(i * slots, (i + 1) * slots));
  }

  const control = new SharedArrayBuffer(CTL_WORDS * 4);
  const statusBuf = new SharedArrayBuffer(jobs.length * 4);
  const resultsBuf = new SharedArrayBuffer(jobs.length * slots * 8);
  const ctl = new Int32Array(control);
  const status = new Int32Array(statusBuf);
  const results = new Float64Array(resultsBuf);
  const boot: WorkerBoot = {
    __pfWorkerModule: WORKER_MODULE, kind, jobs, slots,
    control, status: statusBuf, results: resultsBuf,
  };

  const workers: Worker[] = [];
  for (let i = 0, n = workerCount(jobs.length); i < n; i++) {
    try {
      // `execArgv: []` deliberately does NOT inherit the parent's node options. A worker
      // that inherited `--cpu-prof` writes (and hangs on flushing) its own profile, and an
      // inherited `--inspect` collides on the debug port; neither has anything to do with
      // the arithmetic the worker exists to run.
      const w = new Worker(entry as string, { workerData: boot, execArgv: [] });
      // A worker that fails to start must not become an uncaught exception: the job it
      // would have taken is recomputed on this thread below.
      w.on('error', () => { /* recovered by the local recompute */ });
      w.unref();
      workers.push(w);
    } catch { break; }
  }

  // This thread is a worker too — it claims from the same queue rather than idling.
  for (;;) {
    const i = Atomics.add(ctl, CTL_NEXT, 1);
    if (i >= jobs.length) break;
    Atomics.store(status, i, ST_CLAIMED);
    kernel(jobs[i], results.subarray(i * slots, (i + 1) * slots));
    Atomics.store(status, i, ST_DONE);
    Atomics.add(ctl, CTL_DONE, 1);
  }

  // Block until every job is marked done, or until the workers stop making progress.
  let seen = Atomics.load(ctl, CTL_DONE);
  let deadline = Date.now() + STALL_MS;
  while (seen < jobs.length && Date.now() < deadline) {
    Atomics.wait(ctl, CTL_DONE, seen, 250);
    const now = Atomics.load(ctl, CTL_DONE);
    if (now !== seen) { seen = now; deadline = Date.now() + STALL_MS; }
  }
  for (const w of workers) void w.terminate();

  // Anything not actually completed — a worker that threw, died, or never started — is
  // computed here. Same kernel, same job, so the result is the same; an exception now
  // propagates on the thread that can report it.
  for (let i = 0; i < jobs.length; i++) {
    if (Atomics.load(status, i) !== ST_DONE) {
      kernel(jobs[i], results.subarray(i * slots, (i + 1) * slots));
      Atomics.store(status, i, ST_DONE);
    }
  }
  return jobs.map((_, i) => results.subarray(i * slots, (i + 1) * slots));
}

/**
 * Worker-thread entry point, called by the standalone runtime INSTEAD of the bundle's
 * own entry when `workerData.__pfWorkerModule` names this module.
 */
export function __pfWorkerMain(data: WorkerBoot): void {
  const ctl = new Int32Array(data.control);
  const status = new Int32Array(data.status);
  const results = new Float64Array(data.results);
  const slots = data.slots;
  const jobs = data.jobs;
  let kernel: ParallelKernel;
  try {
    kernel = kernelFor(data.kind);
  } catch {
    process.exit(0);
    return;
  }
  for (;;) {
    const i = Atomics.add(ctl, CTL_NEXT, 1);
    if (i >= jobs.length) break;
    Atomics.store(status, i, ST_CLAIMED);
    try {
      kernel(jobs[i], results.subarray(i * slots, (i + 1) * slots));
      Atomics.store(status, i, ST_DONE);
    } catch {
      // Leave it not-done: the calling thread recomputes it and reports the failure.
      Atomics.store(status, i, ST_TODO);
    }
    Atomics.add(ctl, CTL_DONE, 1);
    Atomics.notify(ctl, CTL_DONE);
  }
  process.exit(0);
}
