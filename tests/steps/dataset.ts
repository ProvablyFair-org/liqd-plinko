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
 * Until this revision both steps here took their expected counts from the dataset's own header:
 *
 *     const { bets, seeds, epochSize, phasesMeta } = ctx;      // ctx.* came straight from meta
 *     ...
 *     const want = phasesMeta[p].bets;                          // Step 11
 *     minSize === epochSize && maxSize === epochSize            // Step 12
 *
 * The binding was destructured, so a grep anchored to the literal text `=== meta.` saw nothing —
 * which is exactly how it survived round 3. It was found by this repository's own class sweep on
 * K1/K2 and DISCLOSED rather than closed in revision 3 (round-3 ledger §D.6); it is closed here.
 *
 * A reviewer executed the consequence on the sibling `dice` repo on 2026-09-09: delete nonces
 * 30–49 from every epoch (6,700 → 4,020 bets), set `meta.epochSize = 30`, `meta.plannedTotal =
 * 4020`, rewrite `meta.phases`, set every `seeds[].nonceEnd = 29`, re-pin the dataset hash and
 * regenerate the simulation — and that suite returned **21/21 PROVABLY FAIR — Full Pass on a
 * 4,020-bet dataset**. On `mines`, dropping one trailing epoch produced a *Conditional Pass,
 * exit 0* — a downgrade, not a rejection.
 *
 * The audited population now comes from CODE constants in `src/loader.ts` — `EXPECTED_BETS`,
 * `EXPECTED_SEEDS`, `EXPECTED_EPOCH_SIZE`, `EXPECTED_PHASE_BETS` — and `meta` is RECONCILED
 * against them rather than believed: a doctored header is itself a hard fail, not merely unread.
 * A mismatch FAILs; it does not FLAG. A withheld population is not a disclosable irregularity,
 * it is a different audit.
 *
 * The class is executed by `audit-framework/checks/gate-population.sh` (D1/D2/D3).
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import {
  EXPECTED_BETS,
  EXPECTED_SEEDS,
  EXPECTED_EPOCH_SIZE,
  EXPECTED_PHASE_BETS,
} from '../../src/loader';

const PHASES = ['A', 'B', 'C', 'D', 'E'] as const;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, meta } = ctx;

  // ── Step 11: Phase labels + total population ───────────────────────────────────
  // F11 claims "the capture plan was executed in full", so this does more than confirm the five
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

  // ── Step 12: Epoch size + seed population ──────────────────────────────────────
  // Claim is "202 epochs of exactly 50 bets": every epoch must be exactly EXPECTED_EPOCH_SIZE and
  // there must be exactly EXPECTED_SEEDS of them — against src/loader.ts, not meta.epochSize.
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.hashedServerSeed, (epochSizes.get(b.hashedServerSeed) ?? 0) + 1);
  }
  const epochIndexes = new Set(bets.map(b => b.epoch));
  const sizes = [...epochSizes.values()];
  const minSize = sizes.length ? Math.min(...sizes) : 0;
  const maxSize = sizes.length ? Math.max(...sizes) : 0;

  const sizeOk = sizes.length > 0 && minSize === EXPECTED_EPOCH_SIZE && maxSize === EXPECTED_EPOCH_SIZE;
  const seedCountOk = seeds.length === EXPECTED_SEEDS;
  const epochCountOk = epochSizes.size === EXPECTED_SEEDS && epochIndexes.size === EXPECTED_SEEDS;
  // The three pinned constants must be mutually consistent — seeds × epoch size == bets.
  const arithmeticOk = EXPECTED_SEEDS * EXPECTED_EPOCH_SIZE === EXPECTED_BETS;
  const metaEpochOk = meta.epochSize === EXPECTED_EPOCH_SIZE;

  const faults12: string[] = [];
  if (!sizeOk) faults12.push(`epoch size min=${minSize} max=${maxSize}, ${EXPECTED_EPOCH_SIZE} pinned in src/loader.ts EXPECTED_EPOCH_SIZE`);
  if (!seedCountOk) faults12.push(`POPULATION: ${seeds.length} seed records, ${EXPECTED_SEEDS} pinned`);
  if (!epochCountOk) faults12.push(`POPULATION: ${epochSizes.size} distinct hashedServerSeed group(s) and ${epochIndexes.size} distinct epoch index(es) in the bets, ${EXPECTED_SEEDS} pinned`);
  if (!arithmeticOk) faults12.push(`pin arithmetic: ${EXPECTED_SEEDS} × ${EXPECTED_EPOCH_SIZE} ≠ ${EXPECTED_BETS}`);
  if (!metaEpochOk) faults12.push(`dataset header disagrees with the code plan: meta.epochSize=${meta.epochSize} ≠ EXPECTED_EPOCH_SIZE ${EXPECTED_EPOCH_SIZE}`);

  const s12 = step(12, 'Epoch Size',
    faults12.length === 0 ? 'PASS' : 'FAIL',
    `${epochSizes.size}/${EXPECTED_SEEDS} epochs (by hashedServerSeed; ${epochIndexes.size} distinct epoch indexes) and ${seeds.length}/${EXPECTED_SEEDS} seed records against src/loader.ts EXPECTED_SEEDS; `
      + `min=${minSize}, max=${maxSize} bets per seed pair against EXPECTED_EPOCH_SIZE ${EXPECTED_EPOCH_SIZE}; ${EXPECTED_SEEDS} × ${EXPECTED_EPOCH_SIZE} = ${EXPECTED_SEEDS * EXPECTED_EPOCH_SIZE} must equal EXPECTED_BETS ${EXPECTED_BETS}. `
      + `meta.epochSize=${meta.epochSize} is reconciled against the constant (${metaEpochOk ? 'agrees' : 'DISAGREES'}), not used as the expectation — dropping an epoch with its seed row and re-declaring the header used to leave every count in this step self-consistent`
      + (faults12.length ? `. FAULTS: ${faults12.join('; ')}` : ''),
    {
      epochsByHash: epochSizes.size,
      epochIndexes: epochIndexes.size,
      expectedSeeds: EXPECTED_SEEDS,
      seedRecords: seeds.length,
      minEpochSize: minSize,
      maxEpochSize: maxSize,
      expectedEpochSize: EXPECTED_EPOCH_SIZE,
      metaEpochSize: meta.epochSize,
      metaHeaderAgrees: metaEpochOk,
    },
  );

  return [s11, s12];
}
