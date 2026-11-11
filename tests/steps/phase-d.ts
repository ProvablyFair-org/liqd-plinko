/**
 * Step 14: Phase D — player-set client seeds, and client-seed control on every epoch.
 *
 * Phase D is the part of the plan played under client seeds the player chose by name: five epochs of
 * 100 drops over the 27 standard settings in turn, each opened by a rotation that submitted
 * `pfaudit-prod-plinko-d<k>-` + 12 hex characters (k = 1…5). Every other epoch was opened with the
 * runner's own per-epoch seed, `audit` + 12 hex characters. Both kinds are seeds the auditor's browser
 * generated and submitted; neither is a seed the site proposed.
 *
 * What the step asserts, all from the dataset and src/loader.ts, never from a capture-side flag:
 *   (a) PHASE D: its bets recompute path-and-slot under their player-set seed; the phase holds at least
 *       MIN_PHASE_D_PLAYER_SEEDS distinct player-set seeds (profile floor 2), one per epoch, every one of
 *       the `pfaudit-prod-plinko-d<k>-<12 hex>` shape, and no epoch outside Phase D uses one;
 *   (b) EVERY EPOCH: one client seed per epoch, EXPECTED_SEEDS distinct seeds in all, none equal to the
 *       seed in force before its capture (meta.captures[i].preCapture.clientSeed); every bet carries its
 *       epoch's seed and recomputes under it;
 *   (c) ORDERING: each epoch's commitment equals the next-seed hash published BEFORE the rotation that
 *       submitted the epoch's client seed (first epoch of a capture: that capture's
 *       preCapture.nextHashedServerSeed; otherwise the previous epoch's nextHashedServerSeed). The
 *       operator was therefore bound to each server seed before it was sent the client seed it would be
 *       combined with: seed SUBSTITUTION is blocked, conditional on authentic commitment timing
 *       (premise P1 / DL-3);
 *   (d) SHAPE: every non-Phase-D seed is `audit` + 12 lowercase hex. The shapes are evidence of the
 *       generator the runner names (6 bytes of crypto.getRandomValues), not proof of its entropy (DL-5).
 *       The Phase D seeds were drawn when the plan was built, before the capture's first rotation, and
 *       were sent only at the rotation opening their epoch (the runner's record, capture/).
 *
 * FLAG-only (a capture-design check).
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { EXPECTED_SEEDS, EXPECTED_PLAN, MIN_PHASE_D_PLAYER_SEEDS } from '../../src/loader';

const PLAYER_SHAPE = /^pfaudit-prod-plinko-d[1-9]\d*-[0-9a-f]{12}$/;
const AUDIT_SHAPE = /^audit[0-9a-f]{12}$/;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap, captures, phaseD } = ctx;
  const byEpoch = [...seeds].sort((a, b) => a.epoch - b.epoch);
  const planD = EXPECTED_PLAN.filter(e => e.phase === 'D');
  const planDBets = planD.reduce((a, e) => a + e.bets, 0);
  const planDEpochs = planD.reduce((a, e) => a + e.epochs, 0);

  // (a) Phase D.
  const dSeeds = byEpoch.filter(s => s.phase === 'D');
  const dDistinct = new Set(dSeeds.map(s => s.clientSeed));
  const dShaped = dSeeds.filter(s => PLAYER_SHAPE.test(s.clientSeed)).length;
  const playerOutsideD = byEpoch.filter(s => s.phase !== 'D' && (PLAYER_SHAPE.test(s.clientSeed) || s.seedTag === 'player')).length;
  let dTested = 0, dMatched = 0;
  for (const b of phaseD) {
    const ss = seedMap.get(b.hashedServerSeed);
    if (!ss) continue;
    dTested++;
    const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
    if (path === b.dropDetails && winningSlot === b.winningSlot) dMatched++;
  }
  const dSettings = new Set(phaseD.map(b => `${b.numberOfRows}:${b.riskLevel}`)).size;
  const phaseDWagered = phaseD.reduce((s, b) => s + parseFloat(b.betAmount), 0);
  const phaseDPaid = phaseD.reduce((s, b) => s + parseFloat(b.winningAmount), 0);

  // (b) every epoch: one seed per epoch, all distinct, none the pre-capture seed of its capture.
  const epochSeeds = byEpoch.map(s => s.clientSeed);
  const distinct = new Set(epochSeeds);
  const preOf = new Map(captures.map(c => [c.capture, c.preCapture]));
  const reusesPreCapture = byEpoch.filter(s => preOf.get(s.capture)?.clientSeed === s.clientSeed).length;
  const seedOfEpoch = new Map(byEpoch.map(s => [s.epoch, s.clientSeed]));
  let carried = 0, recomputed = 0, tested = 0;
  for (const b of bets) {
    if (seedOfEpoch.get(b.epoch) === b.clientSeed) carried++;
    const ss = seedMap.get(b.hashedServerSeed);
    if (!ss) continue;
    tested++;
    const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
    if (path === b.dropDetails && winningSlot === b.winningSlot) recomputed++;
  }

  // (c) commitment published before the client seed was sent.
  let committedBefore = 0;
  for (let i = 0; i < byEpoch.length; i++) {
    const first = i === 0 || byEpoch[i - 1].capture !== byEpoch[i].capture;
    const announced = first ? preOf.get(byEpoch[i].capture)?.nextHashedServerSeed : byEpoch[i - 1].nextHashedServerSeed;
    if (announced !== undefined && announced === byEpoch[i].hashedServerSeed) committedBefore++;
  }
  const dCommittedBefore = dSeeds.filter(s => {
    const i = byEpoch.indexOf(s);
    const first = i === 0 || byEpoch[i - 1].capture !== s.capture;
    const announced = first ? preOf.get(s.capture)?.nextHashedServerSeed : byEpoch[i - 1].nextHashedServerSeed;
    return announced === s.hashedServerSeed;
  }).length;

  // (d) shapes.
  const auditShaped = byEpoch.filter(s => s.phase !== 'D' && AUDIT_SHAPE.test(s.clientSeed)).length;
  const nonD = byEpoch.length - dSeeds.length;

  const dOk = phaseD.length === planDBets && dSeeds.length === planDEpochs
    && dDistinct.size === dSeeds.length && dDistinct.size >= MIN_PHASE_D_PLAYER_SEEDS
    && dShaped === dSeeds.length && playerOutsideD === 0
    && dTested === phaseD.length && dTested > 0 && dMatched === dTested
    && dCommittedBefore === dSeeds.length;
  const allOk = byEpoch.length === EXPECTED_SEEDS && distinct.size === EXPECTED_SEEDS
    && reusesPreCapture === 0 && captures.length > 0
    && carried === bets.length && tested === bets.length && recomputed === tested
    && committedBefore === EXPECTED_SEEDS && auditShaped === nonD;
  const ok = dOk && allOk;

  const s14 = step(14, 'Phase D — Player-Set Client Seeds',
    ok ? 'PASS' : 'FLAG',
    `Phase D: ${phaseD.length} bets (plan ${planDBets}) in ${dSeeds.length} epochs over ${dSettings} settings, ${dDistinct.size} distinct player-set client seeds (floor ${MIN_PHASE_D_PLAYER_SEEDS}, src/loader.ts MIN_PHASE_D_PLAYER_SEEDS), `
      + `${dShaped}/${dSeeds.length} of the shape pfaudit-prod-plinko-d<k>-<12 hex>; recomputation under the player-set seed: ${dMatched}/${dTested} match (expected ${phaseD.length}); `
      + `${dCommittedBefore}/${dSeeds.length} Phase D commitments were published before the rotation that submitted the epoch's seed; player-set seeds used outside Phase D: ${playerOutsideD}. `
      + `Every epoch: ${distinct.size}/${EXPECTED_SEEDS} opened with a distinct auditor-submitted client seed (expected ${EXPECTED_SEEDS}, src/loader.ts), ${reusesPreCapture} equal to the seed in force before its capture; `
      + `${carried}/${bets.length} bets carry their epoch's seed and ${recomputed}/${tested} recompute path-and-slot under it; `
      + `${committedBefore}/${EXPECTED_SEEDS} epoch commitments equal the next-seed hash published before the rotation that submitted the epoch's client seed (first epoch of a capture: that capture's pre-capture record), `
      + `so seed substitution is blocked on every epoch, conditional on authentic commitment timing (P1/DL-3); ${auditShaped}/${nonD} non-Phase-D seeds have the shape audit + 12 hex `
      + `(shape only: the generator's entropy is not demonstrated by the dataset, DL-5)`
      + (ok ? '' : '; FLAG: client-seed control not established as planned'),
    {
      phaseDBets: phaseD.length,
      phaseDEpochs: dSeeds.length,
      phaseDSettings: dSettings,
      distinctPlayerSetSeeds: dDistinct.size,
      playerSetSeedFloor: MIN_PHASE_D_PLAYER_SEEDS,
      playerSetShapedSeeds: dShaped,
      playerSetSeedsOutsidePhaseD: playerOutsideD,
      phaseDRecomputed: dMatched,
      phaseDCommittedBeforeClientSeed: dCommittedBefore,
      phaseDWagered,
      phaseDPaid,
      seededBets: bets.length,
      betsCarryingEpochSeed: carried,
      distinctClientSeeds: distinct.size,
      epochsReusingPreCaptureSeed: reusesPreCapture,
      recomputed,
      epochsCommittedBeforeClientSeed: committedBefore,
      auditShapedSeeds: auditShaped,
    },
  );
  return [s14];
}
