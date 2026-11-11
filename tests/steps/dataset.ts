/**
 * Steps 11–12: Dataset Integrity — and, since revision 4, THE POPULATION GUARD.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 *  G-BIND — a row count is not an identity
 * ══════════════════════════════════════════════════════════════════════════════════════
 * `EXPECTED_DATASET_SHA256` proves the dataset has not changed since WE pinned it. It says
 * nothing about whether the file is the capture. Shrink `bets[]`, drop the matching `seeds[]`
 * rows, edit `meta.plannedTotal` / `meta.epochSize` / `meta.phases` to agree, re-pin, and every
 * internal-consistency check in this suite is satisfied by a smaller audit than the one the
 * report describes.
 *
 * The shape these steps must never take is one that reads its expectation off the header:
 *
 *     const { bets, seeds, epochSize, phasesMeta } = ctx;      // ctx.* straight from meta
 *     ...
 *     const want = phasesMeta[p].bets;                          // Step 11
 *     minSize and maxSize held to that destructured epochSize   // Step 12
 *
 * Written that way the audited data defines its own pass condition. The binding is destructured,
 * so a search anchored to the literal text `=== meta.` finds nothing — the defect is invisible to
 * exactly the check most likely to be run for it.
 *
 * The consequence is a doctored capture that passes cleanly: delete nonces 30–49 from every epoch,
 * set the header's epoch sizes to 30, adjust `meta.plannedTotal`, rewrite `meta.phases`, set every
 * `seeds[].nonceEnd = 29`, re-pin the dataset hash and regenerate the simulation, and a suite
 * bound to `meta` returns a Full Pass on a dataset missing 40% of its drops. Dropping a single
 * trailing epoch is worse still — it downgrades to a Conditional Pass, exit 0, rather than being
 * rejected.
 *
 * The audited population therefore comes from CODE constants in `src/loader.ts` — `EXPECTED_BETS`,
 * `EXPECTED_SEEDS`, `EXPECTED_PLAN`, `EXPECTED_EPOCH_SIZE`, `EXPECTED_PHASE_BETS` — and `meta` is RECONCILED
 * against them rather than believed: a doctored header is itself a hard fail, not merely unread.
 * A mismatch FAILs; it does not FLAG. A withheld population is not a disclosable irregularity,
 * it is a different audit.
 *
 * The class is stated as a load-bearing premise in MANIFEST.md (§Limitations and trust) and
 * scored by Steps 11 and 12 below. It was originally found by a ProvablyFair.org framework
 * check that does not ship with this package, so the premise table is what a reader checks
 * it against, not a script they cannot run.
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import {
  EXPECTED_BETS,
  EXPECTED_SEEDS,
  EXPECTED_PLAN,
  EXPECTED_EPOCH_SIZE,
  EXPECTED_PHASE_BETS,
  EXPECTED_PHASES,
  PRIMARY_WINDOW_NONCES,
} from '../../src/loader';

// The plan's phase letters, from src/loader.ts.
const PHASES = EXPECTED_PHASES;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, meta } = ctx;

  // ── Step 11: Phase labels + total population ───────────────────────────────────
  // F11 claims "the capture plan was executed in full", so this does more than confirm the plan's
  // labels are present: the OBSERVED bet count for every phase must equal the CODE plan, no phase
  // may be missing, no bet may carry a label the plan never declared, the total must equal
  // EXPECTED_BETS, and the dataset's own header must AGREE with all of it.
  const phases = new Set(bets.map(b => b.phase));
  const observedCount: Record<string, number> = {};
  for (const b of bets) observedCount[b.phase] = (observedCount[b.phase] ?? 0) + 1;

  const hasExpected = PHASES.every(p => phases.has(p));
  const planMismatches = PHASES.filter(p => (observedCount[p] ?? 0) !== EXPECTED_PHASE_BETS[p]);
  const undeclared = [...phases].filter(p => !(PHASES as readonly string[]).includes(p));
  // POPULATION GUARD: compared against src/loader.ts, never against meta.plannedTotal or Σ(phases).
  const totalOk = bets.length === EXPECTED_BETS;
  // The pin table must sum to the pinned population, or the two constants could drift apart and a
  // shrink could satisfy whichever one a given step happened to read.
  const planSum = PHASES.reduce((a, p) => a + EXPECTED_PHASE_BETS[p], 0);
  const planSelfConsistent = planSum === EXPECTED_BETS;
  // HEADER RECONCILIATION: meta is evidence to be checked, not the plan. A forger who shrinks the
  // data and doctors the header to match fails HERE, whatever the header says.
  const metaTotalOk = meta.plannedTotal === EXPECTED_BETS;
  const metaPhasesOk = PHASES.every(p => meta.phases?.[p]?.bets === EXPECTED_PHASE_BETS[p])
    && Object.keys(meta.phases ?? {}).every(p => (PHASES as readonly string[]).includes(p));

  const faults11: string[] = [];
  if (!hasExpected) faults11.push(`missing phase label(s): ${PHASES.filter(p => !phases.has(p)).join(', ')}`);
  if (planMismatches.length) faults11.push(`phase count(s) off the CODE plan: ${planMismatches.map(p => `${p}=${observedCount[p] ?? 0}≠${EXPECTED_PHASE_BETS[p]}`).join(', ')}`);
  if (undeclared.length) faults11.push(`undeclared phase label(s) in the data: ${undeclared.join(',')}`);
  if (!totalOk) faults11.push(`POPULATION: ${bets.length} bets loaded, ${EXPECTED_BETS} pinned in src/loader.ts EXPECTED_BETS — the audited population is not the dataset's to declare`);
  if (!planSelfConsistent) faults11.push(`pin table inconsistent: Σ EXPECTED_PHASE_BETS = ${planSum} ≠ EXPECTED_BETS ${EXPECTED_BETS}`);
  if (!metaTotalOk) faults11.push(`dataset header disagrees with the code plan: meta.plannedTotal=${meta.plannedTotal} ≠ EXPECTED_BETS ${EXPECTED_BETS}`);
  if (!metaPhasesOk) faults11.push(`dataset header disagrees with the code plan: meta.phases=${JSON.stringify(Object.fromEntries(Object.entries(meta.phases ?? {}).map(([k, v]) => [k, v.bets])))} ≠ EXPECTED_PHASE_BETS ${JSON.stringify(EXPECTED_PHASE_BETS)}`);

  const counts = PHASES.map(p => `${p}=${observedCount[p] ?? 0}/${EXPECTED_PHASE_BETS[p]}`).join(' ');
  const s11 = step(11, 'Phase Labels',
    faults11.length === 0 ? 'PASS' : 'FAIL',
    `Phases present: ${[...phases].sort().join(', ')} (${counts} against src/loader.ts EXPECTED_PHASE_BETS, Σ=${planSum}); `
      + `total ${bets.length}/${EXPECTED_BETS} bets and ${seeds.length}/${EXPECTED_SEEDS} seed records, both compared against CODE constants in src/loader.ts — never against meta.plannedTotal or meta.phases, which are inside the file being scored (G-BIND: a row count is not an identity). `
      + `The dataset header is reconciled against those constants rather than believed (meta.plannedTotal=${meta.plannedTotal}: ${metaTotalOk ? 'agrees' : 'DISAGREES'}; meta.phases: ${metaPhasesOk ? 'agrees' : 'DISAGREES'}), so shrinking the capture and doctoring its header to match is a hard fail rather than an unread field`
      + (faults11.length ? `. FAULTS: ${faults11.join('; ')}` : ''),
    {
      betsLoaded: bets.length,
      expectedBets: EXPECTED_BETS,
      seedRecords: seeds.length,
      expectedSeeds: EXPECTED_SEEDS,
      phaseCounts: PHASES.reduce<Record<string, number>>((a, p) => { a[p] = observedCount[p] ?? 0; return a; }, {}),
      expectedPhaseBets: { ...EXPECTED_PHASE_BETS },
      planSum,
      metaPlannedTotal: meta.plannedTotal,
      metaHeaderAgrees: metaTotalOk && metaPhasesOk,
    },
  );

  // ── Step 12: Epoch sizes + seed population ─────────────────────────────────────
  // Claim: the plan of src/loader.ts EXPECTED_PLAN was played in full — for every plan entry, exactly
  // `epochs` epochs of exactly `epochSize` bets at exactly `stake`, in the capture file the plan names — and
  // nothing else. Every expectation is a code constant; the dataset header (meta.phases) is reconciled
  // against the plan, never read as the expectation.
  const epochSizes = new Map<string, number>();
  const epochId = new Map<string, Set<string>>();
  const epochStake = new Map<string, Set<string>>();
  const epochCapture = new Map<string, Set<number>>();
  for (const b of bets) {
    const h = b.hashedServerSeed;
    epochSizes.set(h, (epochSizes.get(h) ?? 0) + 1);
    (epochId.get(h) ?? epochId.set(h, new Set()).get(h)!).add(b.phaseId);
    (epochStake.get(h) ?? epochStake.set(h, new Set()).get(h)!).add(b.betAmount);
    (epochCapture.get(h) ?? epochCapture.set(h, new Set()).get(h)!).add(b.capture);
  }
  const epochIndexes = new Set(bets.map(b => b.epoch));
  const sizes = [...epochSizes.values()];
  const minSize = sizes.length ? Math.min(...sizes) : 0;
  const maxSize = sizes.length ? Math.max(...sizes) : 0;

  const faults12: string[] = [];
  const epochsPerEntry: Record<string, number> = {};
  const betsPerEntry: Record<string, number> = {};
  let epochsOnPlan = 0;
  for (const e of EXPECTED_PLAN) {
    const own = [...epochSizes.keys()].filter(h => epochId.get(h)!.size === 1 && epochId.get(h)!.has(e.id));
    epochsPerEntry[e.id] = own.length;
    betsPerEntry[e.id] = own.reduce((a, h) => a + epochSizes.get(h)!, 0);
    const good = own.filter(h => epochSizes.get(h) === EXPECTED_EPOCH_SIZE[e.id]
      && epochStake.get(h)!.size === 1 && epochStake.get(h)!.has(e.stake)
      && epochCapture.get(h)!.size === 1 && epochCapture.get(h)!.has(e.capture));
    epochsOnPlan += good.length;
    if (own.length !== e.epochs) faults12.push(`plan ${e.id}: ${own.length} epoch(s), ${e.epochs} planned`);
    if (good.length !== own.length) faults12.push(`plan ${e.id}: ${own.length - good.length} epoch(s) off the planned size ${EXPECTED_EPOCH_SIZE[e.id]}, stake ${e.stake} or capture ${e.capture}`);
  }
  const mixed = [...epochId.values()].filter(v => v.size !== 1).length;
  if (mixed) faults12.push(`${mixed} epoch(s) carry more than one plan id`);
  const undeclaredIds = [...new Set(bets.map(b => b.phaseId))].filter(id => !EXPECTED_PLAN.some(e => e.id === id));
  if (undeclaredIds.length) faults12.push(`undeclared plan id(s) in the data: ${undeclaredIds.join(',')}`);
  const letterOk = bets.every(b => EXPECTED_PLAN.find(e => e.id === b.phaseId)?.phase === b.phase);
  if (!letterOk) faults12.push('a bet\'s phase letter is not the letter of its plan id');

  const seedCountOk = seeds.length === EXPECTED_SEEDS;
  const epochCountOk = epochSizes.size === EXPECTED_SEEDS && epochIndexes.size === EXPECTED_SEEDS;
  // The pinned constants must be mutually consistent.
  const planEpochs = EXPECTED_PLAN.reduce((a, e) => a + e.epochs, 0);
  const planBets = EXPECTED_PLAN.reduce((a, e) => a + e.epochs * e.epochSize, 0);
  const entryArithmeticOk = EXPECTED_PLAN.every(e => e.epochs * e.epochSize === e.bets);
  const letterSumsOk = PHASES.every(p => EXPECTED_PLAN.filter(e => e.phase === p).reduce((a, e) => a + e.bets, 0) === EXPECTED_PHASE_BETS[p]);
  const arithmeticOk = planEpochs === EXPECTED_SEEDS && planBets === EXPECTED_BETS && entryArithmeticOk && letterSumsOk;
  const planMinSize = Math.min(...EXPECTED_PLAN.map(e => e.epochSize));
  const primaryWindowOk = PRIMARY_WINDOW_NONCES === planMinSize;
  // Header reconciliation: per phase letter, epochs, stake and the set of epoch sizes.
  const metaEpochOk = PHASES.every(p => {
    const es = EXPECTED_PLAN.filter(e => e.phase === p);
    const m = meta.phases?.[p];
    return !!m && m.epochs === es.reduce((a, e) => a + e.epochs, 0)
      && es.every(e => m.stake === e.stake && (m.epochSizes ?? []).includes(EXPECTED_EPOCH_SIZE[e.id]) && m.ids?.[e.id] === e.bets)
      && (m.epochSizes ?? []).length === new Set(es.map(e => e.epochSize)).size;
  });
  // The seed records must tell the same story as the bets (plan id, capture, planned length).
  const seedRecordsOk = seeds.every(sd => {
    const e = EXPECTED_PLAN.find(x => x.id === sd.phaseId);
    return !!e && sd.phase === e.phase && sd.capture === e.capture && sd.plannedBets === EXPECTED_EPOCH_SIZE[e.id]
      && sd.stake === e.stake && epochSizes.get(sd.hashedServerSeed) === EXPECTED_EPOCH_SIZE[e.id];
  });

  if (!seedCountOk) faults12.push(`POPULATION: ${seeds.length} seed records, ${EXPECTED_SEEDS} pinned`);
  if (!epochCountOk) faults12.push(`POPULATION: ${epochSizes.size} distinct hashedServerSeed group(s) and ${epochIndexes.size} distinct epoch index(es) in the bets, ${EXPECTED_SEEDS} pinned`);
  if (!arithmeticOk) faults12.push(`pin arithmetic: Σ epochs ${planEpochs} vs EXPECTED_SEEDS ${EXPECTED_SEEDS}; Σ epochs × epochSize ${planBets} vs EXPECTED_BETS ${EXPECTED_BETS}; per-entry ${entryArithmeticOk ? 'ok' : 'INCONSISTENT'}; per-letter ${letterSumsOk ? 'ok' : 'INCONSISTENT'}`);
  if (!primaryWindowOk) faults12.push(`PRIMARY_WINDOW_NONCES ${PRIMARY_WINDOW_NONCES} is not the shortest planned epoch ${planMinSize}`);
  if (!metaEpochOk) faults12.push('dataset header disagrees with the code plan: meta.phases epochs / stake / epochSizes / ids');
  if (!seedRecordsOk) faults12.push('a seed record disagrees with the plan entry of its epoch (phase, capture, planned length or stake)');

  const planText = EXPECTED_PLAN.map(e => `${e.id} ${epochsPerEntry[e.id]}/${e.epochs} × ${e.epochSize}`).join(', ');
  const s12 = step(12, 'Epoch Size',
    faults12.length === 0 ? 'PASS' : 'FAIL',
    `${epochSizes.size}/${EXPECTED_SEEDS} epochs (by hashedServerSeed; ${epochIndexes.size} distinct epoch indexes) and ${seeds.length}/${EXPECTED_SEEDS} seed records against src/loader.ts EXPECTED_SEEDS; `
      + `epochs per plan entry and their length, against EXPECTED_PLAN: ${planText}; ${epochsOnPlan}/${EXPECTED_SEEDS} epochs have their entry's length, stake and capture file; `
      + `Σ epochs = ${planEpochs} and Σ epochs × epochSize = ${planBets} must equal EXPECTED_SEEDS ${EXPECTED_SEEDS} and EXPECTED_BETS ${EXPECTED_BETS}; `
      + `the shortest planned epoch is ${planMinSize} drops = PRIMARY_WINDOW_NONCES ${PRIMARY_WINDOW_NONCES} (Step 17's scored window). `
      + `The header (meta.phases) is reconciled against the plan (${metaEpochOk ? 'agrees' : 'DISAGREES'}), not used as the expectation. The epoch lengths are the capture's own rotation plan; nothing in the captured records shows LIQD limiting a seed pair to any of them`
      + (faults12.length ? `. FAULTS: ${faults12.join('; ')}` : ''),
    {
      epochsByHash: epochSizes.size,
      epochIndexes: epochIndexes.size,
      expectedSeeds: EXPECTED_SEEDS,
      seedRecords: seeds.length,
      minEpochSize: minSize,
      maxEpochSize: maxSize,
      epochsOnPlan,
      epochsPerPlanEntry: epochsPerEntry,
      betsPerPlanEntry: betsPerEntry,
      primaryWindowNonces: PRIMARY_WINDOW_NONCES,
      metaHeaderAgrees: metaEpochOk,
    },
  );

  return [s11, s12];
}
