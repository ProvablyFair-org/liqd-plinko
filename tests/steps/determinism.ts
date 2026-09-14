/**
 * Steps 5–6: RNG Determinism
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { poissonBinomialSurvival } from '../../src/calibration';

const WRONG_CLIENT = 'wrong-client-seed-test';

/**
 * Step 6's rejection threshold, on the EXACT null (R3-K7).
 *
 * The old rule was `changed / tested >= 0.95`. That is not a null: under H0 ("the server
 * really uses the client seed") a re-drop with a different client seed lands on the SAME
 * path only by coincidence, with probability 2^-rows per bet — the whole path is `rows`
 * independent binary draws. Over this capture's 1,010-bet sample that is Σ 2^-rows =
 * 0.5425 expected coincidences. The 0.95 rule tolerated 51 of them: ~94× the exact null,
 * which is enough headroom for a server that ignores the client seed on 5% of drops to
 * PASS. It is now scored against the exact Poisson-binomial tail instead.
 *
 * At α = 1e-3 the false-rejection rate of a genuinely honest server is P(X >= 5) =
 * 2.41e-4 on this sample (P(X >= 4) = 2.30e-3 still passes); a server ignoring the client
 * seed on 5% of drops produces ~51 coincidences, P(X >= 51) = 2.9e-83.
 */
const SAME_PATH_ALPHA = 1e-3;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: Path + slot recomputation ────────────────────────────────────────
  let mismatches = 0, skipped = 0;
  for (const b of bets) {
    const ss = seedMap.get(b.hashedServerSeed);
    if (!ss) { skipped++; continue; }
    const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
    if (path !== b.dropDetails || winningSlot !== b.winningSlot) mismatches++;
  }
  const s5 = step(5, 'Path + Slot Recomputation',
    mismatches === 0 && skipped === 0 ? 'PASS' : 'FAIL',
    `${bets.length - skipped}/${bets.length} verified (expected ${bets.length}, 0 skipped); ${mismatches} mismatches; ${skipped} skipped (unrevealed seeds)`,
  );

  // ── Step 6: Client seed influence ─────────────────────────────────────────────
  // Sample up to 5 bets per revealed epoch; expected coverage is derived from the
  // dataset (Σ min(5, epoch size) over revealed epochs), so the step cannot pass
  // vacuously when reveals are missing (tested collapses to 0).
  let tested = 0, changed = 0, expectedTested = 0;
  // Per-bet coincidence probability under H0: the wrong-seed re-drop reproduces all
  // `rows` bits by chance. Collected per bet because the sample mixes board sizes
  // (8–16 rows), so a single pooled p would be wrong.
  const samePathProbs: number[] = [];
  const byEpoch = new Map<string, typeof bets>();
  for (const b of bets) {
    const arr = byEpoch.get(b.hashedServerSeed) ?? [];
    arr.push(b);
    byEpoch.set(b.hashedServerSeed, arr);
  }
  for (const [hash, epochBets] of byEpoch) {
    const ss = seedMap.get(hash);
    if (!ss) continue;
    expectedTested += Math.min(5, epochBets.length);
    for (const b of epochBets.slice(0, 5)) {
      tested++;
      samePathProbs.push(Math.pow(2, -b.numberOfRows));
      const correct = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
      const wrong = revealPlinko(ss, WRONG_CLIENT, b.nonce, b.numberOfRows);
      if (correct.path !== wrong.path) changed++;
    }
  }
  const samePath = tested - changed;
  const expectedSamePath = samePathProbs.reduce((s, p) => s + p, 0);
  // P(X >= observed coincidences) under the exact Poisson-binomial null.
  const samePathSurvivalP = tested > 0 ? poissonBinomialSurvival(samePathProbs, samePath) : 0;
  const s6Ok = tested > 0 && tested === expectedTested && samePathSurvivalP >= SAME_PATH_ALPHA;
  const s6 = step(6, 'Client Seed Influence',
    s6Ok ? 'PASS' : 'FAIL',
    `${changed}/${tested} bets: wrong clientSeed → different path (tested ${tested}, expected ${expectedTested}); `
      + `${samePath} same-path coincidence(s) against an exact null of ${expectedSamePath.toFixed(4)} `
      + `(Σ 2^−rows over the sample), Poisson-binomial P(X ≥ ${samePath}) = ${samePathSurvivalP.toExponential(4)} `
      + `vs α = ${SAME_PATH_ALPHA.toExponential(0)}`
      + (tested !== expectedTested ? `; FAIL: tested ${tested} of ${expectedTested} expected` : '')
      + (tested > 0 && samePathSurvivalP < SAME_PATH_ALPHA ? `; FAIL: too many coincidences for the client seed to be driving every drop` : ''),
    {
      tested,
      expectedTested,
      changed,
      samePath,
      expectedSamePath,
      samePathSurvivalP,
      alpha: SAME_PATH_ALPHA,
    },
  );

  return [s5, s6];
}
