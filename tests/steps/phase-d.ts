/**
 * Step 14: Phase D — client seed variation (standalone scored step).
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { phaseD, seedMap } = ctx;

  if (phaseD.length === 0) {
    return [step(14, 'Phase D — Client Seed Variation',
      'FLAG', 'No Phase D bets in dataset (PROVISIONAL)')];
  }

  const clientSeeds = new Set(phaseD.map(b => b.clientSeed));
  let tested = 0, matched = 0;
  for (const b of phaseD) {
    const ss = seedMap.get(b.hashedServerSeed);
    if (!ss) continue;
    tested++;
    const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
    if (path === b.dropDetails && winningSlot === b.winningSlot) matched++;
  }

  // ── Predictable-client-seed subset (FIX-19 sweep) ─────────────────────────────
  // The chapters quote the exposure of the epochs whose client seeds follow the
  // predictable `pfaudit-<run-id>-<epoch>` pattern — the ones the by-construction R-CHERRY
  // closure does NOT cover, because the operator already held those client seeds when it
  // committed their server-seed hashes. Those figures were hand-derived from the dataset and
  // no code emitted them, which is the same defect class as the calibrated expectation in
  // round-2 finding N1. They are computed here and written to outputs/verification-stats.json.
  //
  // The subset is derived from the DATA, not from a hard-coded epoch range: a Phase D epoch
  // is exposed when its client seed carries the run-id pattern.
  const PREDICTABLE = /^pfaudit-\d+-\d+$/;
  const predictableEpochs = [...new Set(
    phaseD.filter(b => PREDICTABLE.test(b.clientSeed)).map(b => b.epoch),
  )].sort((a, b) => a - b);
  // ── QA-07 (round-4 client QA): the earliest predictable epoch is UNRESOLVED, not safe ──
  // This used to read: "The earliest predictable epoch is safe: its hash was committed by
  // the rotation that submitted the PREVIOUS (non-pfaudit) client seed, before any run-id
  // existed." Two things were wrong with that.
  //   1. "before any run-id existed" is not established by a prior commitment. The rotation
  //      ordering shows the operator had not been SENT that client seed. It does not show
  //      the run-id — a millisecond Unix timestamp the auditor's tool generated — was
  //      unpredictable to a party that knew roughly when the capture would run.
  //   2. A prior hash blocks later seed SUBSTITUTION. It does not block GRINDING a server
  //      seed against a guessable FUTURE client seed before committing to it.
  // The audit's position is that ~10^4 plausible timestamp candidates carry negligible
  // cherry-pick power. That assumption is NOT demonstrated anywhere in this repository, so
  // the earliest predictable epoch is reported as an explicit unresolved premise. It is not
  // relabelled as compromised either: no evidence of an attack exists.
  const unresolvedEpoch = predictableEpochs.length > 0 ? predictableEpochs[0] : null;
  const exposedEpochs = predictableEpochs.slice(1);
  const exposedBets = phaseD.filter(b => exposedEpochs.includes(b.epoch));
  const exposedWagered = exposedBets.reduce((s, b) => s + parseFloat(b.betAmount), 0);
  const exposedPaid = exposedBets.reduce((s, b) => s + parseFloat(b.winningAmount), 0);
  const phaseDWagered = phaseD.reduce((s, b) => s + parseFloat(b.betAmount), 0);
  const phaseDPaid = phaseD.reduce((s, b) => s + parseFloat(b.winningAmount), 0);

  const s14 = step(14, 'Phase D — Client Seed Variation',
    tested > 0 && tested === phaseD.length && clientSeeds.size >= 2 && matched === tested ? 'PASS' : 'FLAG',
    `${phaseD.length} bets, ${clientSeeds.size} distinct client seeds; recomputation: ${matched}/${tested} match (tested ${tested}, expected ${phaseD.length})`
      + `; predictable-client-seed epochs ${predictableEpochs.length} (${predictableEpochs[0] ?? '-'}–${predictableEpochs[predictableEpochs.length - 1] ?? '-'})`
      + `: epoch ${unresolvedEpoch ?? '-'} is UNRESOLVED (its run-id was guessable in distribution; a prior hash blocks substitution, not grinding against a predictable future client seed, and the negligible-power assumption for ~10^4 candidates is not demonstrated in-repo)`
      + `; ${exposedEpochs.length} epochs (${exposedEpochs[0] ?? '-'}–${exposedEpochs[exposedEpochs.length - 1] ?? '-'}) used client seeds the operator already held at commitment: ${exposedBets.length} bets, $${exposedWagered.toFixed(2)} wagered, $${exposedPaid.toFixed(2)} paid — no adverse signal, but containment there is statistical, not structural`,
    {
      phaseDBets: phaseD.length,
      distinctClientSeeds: clientSeeds.size,
      recomputed: matched,
      phaseDWagered,
      phaseDPaid,
      predictableEpochs,
      // QA-07: the three tiers as machine values, so no chapter has to restate them.
      // -1 when there is no predictable epoch at all; the StepResult data contract does
      // not carry null, and a sentinel is honest here because epochs are non-negative.
      unresolvedPredictabilityEpoch: unresolvedEpoch ?? -1,
      exposedEpochs,
      exposedBets: exposedBets.length,
      exposedWagered,
      exposedPaid,
    },
  );
  return [s14];
}
