/**
 * LIQD Plinko — VALUE DOMAINS for every numeric field in `outputs/*.json`.
 *
 * ── Why this module exists (QA-13, round-4 client QA, EXECUTED) ───────────────
 * Setting `outputs/coverage-results.json` → `totalConfigs` to **-1** and running
 * `npm run verify` printed `21/21` and `VERDICT: PROVABLY FAIR — Full Pass`. A negative
 * count of configurations is physically impossible and nothing rejected it as impossible.
 * The derived-emission guard did notice the bytes had moved and exited 1 — but that is a
 * *weak* rejection and the framework's `gate-values.sh` grades it as a failure, correctly:
 * it proves the file changed, not that the value cannot exist. Re-baseline the emission
 * artifact — which is exactly what a forger does next — and it walks straight through.
 *
 * This is the SAME CLASS as QA-01. There, Step 16 bounded `simRTP` against a number read
 * out of the same artifact, so moving both numbers together satisfied the check. Here, a
 * scalar was carried with no bound at all. Both are "the artifact is trusted to describe
 * itself". The fix in both cases is the same rule, and it is the one rule that matters:
 *
 *     EVERY BOUND IS DERIVED FROM `src/config.ts`, `src/loader.ts` OR THE PINNED
 *     `plinkoConfig.json`. NEVER FROM THE ARTIFACT BEING CHECKED.
 *     A bound the artifact supplies is a bound a forger sets.
 *
 * ── G-VALID: reject only the IMPOSSIBLE ──────────────────────────────────────
 * The mirror defect costs exactly as much, and the sibling `mines` audit paid it: a
 * GENUINE million-round result was rejected because its RTP landed exactly on
 * expectation. So these domains encode PHYSICAL POSSIBILITY, not plausibility, and
 * nothing here is allowed to reject a value for being surprising, round, extreme, or
 * equal to its own expectation. Concretely, the traps in this artifact set — every one
 * of which a naive name-based classifier gets wrong, and all of which are honest values
 * in the committed files:
 *
 *   `expectedFlagsByChance` = 9.595            an expected COUNT is a REAL, not an integer
 *   `expectedZEarlyBelow1645Naive` = 10.1      likewise
 *   `expectedSamePath` = 0.5425…               an expected count that is legitimately < 1
 *   `coveragePct` = 78.1                       a PERCENT, so its range is [0,100], not [0,1]
 *   `maxSlotDeviation.rows11` = 2.117…         a deviation RATIO, legitimately > 1
 *   `rtpEarly` = 1.0028…                       an RTP legitimately ABOVE 1 — a window mean
 *                                              is bounded by the PAYTABLE, not by 1
 *   `r1` / `serialR1ZRunsZCorrelation`         correlations, so [-1, 1] and often negative
 *   `zEarly`, `r1Z`, `runsZ`, `tZEarlyMinusLate`   unbounded signed reals
 *
 * Because a mistake in this table would either wave through a forgery or reject an honest
 * audit, `tests/plinko/domainTests.ts` asserts BOTH directions against the committed
 * artifacts: every numeric leaf satisfies its domain, and every numeric leaf PATH IS
 * COVERED by an explicit rule. There is no silent fallback — adding a numeric field to an
 * artifact without declaring what it physically admits fails the unit suite.
 */

import type { PlinkoConfigData } from './types';
import { allConfigs, payoutTable, slotCount, PASS2_NONCES_PUBLISHED } from './config';
import { EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_EPOCH_SIZE } from './loader';

export interface Domain {
  /** Short name used in the failure message. */
  readonly label: string;
  readonly ok: (v: number) => boolean;
}

const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

// ── Primitive domains ─────────────────────────────────────────────────────────

/** Any real number that is not NaN/Infinity. The weakest domain; used only where the
 *  quantity genuinely has no physical bound (signed z-scores, correlated differences). */
export const FINITE = D('a finite number', v => Number.isFinite(v));

export const NONNEG_REAL = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
export const POSITIVE_REAL = D('a strictly positive real', v => Number.isFinite(v) && v > 0);
export const NONNEG_INT = D('a non-negative integer', v => Number.isInteger(v) && v >= 0);
export const PROBABILITY = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
export const CORRELATION = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
export const PERCENT = D('a percentage in [0,100]', v => Number.isFinite(v) && v >= 0 && v <= 100);
/** A chi-squared statistic is a sum of squares over positive expectations. */
export const CHI_SQUARED = D('a non-negative chi-squared statistic', v => Number.isFinite(v) && v >= 0);

/** A non-negative integer that cannot exceed a denominator known from code, not from the file. */
export const intAtMost = (max: number, what: string): Domain =>
  D(`an integer in [0, ${max}] (${what})`, v => Number.isInteger(v) && v >= 0 && v <= max);

export const intBetween = (lo: number, hi: number, what: string): Domain =>
  D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);

export const realBetween = (lo: number, hi: number, what: string): Domain =>
  D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

/**
 * The attainable range of any PAYOUT AVERAGE — a theoretical RTP, a simulated RTP, a
 * window RTP, or a threshold expressed as a window RTP.
 *
 * A mean of drawn multipliers cannot fall outside the smallest and largest multiplier the
 * paytable contains. That is the true physical bound, and it is why this is NOT `[0,1]`:
 * `rtpEarly` of 1.0028 is an honest value, and on a high-risk board a short window can
 * average far above 1. Derived by enumerating `allConfigs(cfg)` over the hash-pinned
 * `plinkoConfig.json`.
 */
export function attainableMultiplierRange(cfg: PlinkoConfigData): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of allConfigs(cfg)) {
    for (const m of payoutTable(cfg, c.rows, c.riskLevel)) {
      if (m < min) min = m;
      if (m > max) max = m;
    }
  }
  return { min, max };
}

/**
 * The attainable range of a payout average ON ONE BOARD — the smallest and largest
 * multiplier of THAT (rows, riskLevel) paytable.
 *
 * ── Why the per-board range exists (QA-16, round-5 client QA, EXECUTED) ──────────
 * `attainableMultiplierRange` unions every declared board, and the union is [0, 1000]
 * because the high-risk boards contain a 0x slot. So setting the 8-row / low-risk epoch's
 * `rtpEarly` to 0 — a board whose SMALLEST multiplier is 0.5 — was inside the global range
 * and shipped behind a 21/21 Full Pass. The union is the right bound for a figure that
 * spans boards (`meanSimulatedRTP`); it is far too loose for a figure attached to one.
 *
 * Only the caller can say which board a row belongs to, and it must not ask the row: in
 * `tests/steps/simulation.ts` the board comes from `revealedEpochConfigs(bets, seeds)` —
 * the DATASET — and the row's own `rows`/`riskLevel` are separately required to agree with
 * it (G-BIND). A forger who relabels the row onto a permissive board fails that check
 * before reaching this one.
 *
 * G-VALID: this still rejects only the impossible. A window mean of drawn multipliers is
 * bounded by the smallest and largest multiplier that board can pay and by nothing else —
 * the committed `rtpEarly` of 1.0028 on the 8-row low board sits inside [0.5, 5.6] and is
 * accepted, as is any legitimately extreme short window.
 */
export function boardMultiplierRange(
  cfg: PlinkoConfigData, rows: number, riskLevel: number,
): { min: number; max: number } {
  const table = payoutTable(cfg, rows, riskLevel);
  return { min: Math.min(...table), max: Math.max(...table) };
}

/**
 * Drops in ONE Pass-2 window across the whole audited seed population: every revealed
 * epoch contributes `floor(PASS2_NONCES_PUBLISHED / 2)` drops, so 202 × 5,000 = 1,010,000.
 *
 * This is the ceiling on an edge-hit count, because an edge hit is one drop landing in
 * slot 0 or slot `rows`. Both factors come from source — `EXPECTED_SEEDS` in src/loader.ts
 * and `PASS2_NONCES_PUBLISHED` in src/config.ts — and NEITHER is read from the artifact,
 * which is the whole point: the round-5 counterexample set `edgeHitsEarly` to 1,000,000,000
 * and nothing objected, because the only field that could have contradicted it
 * (`noncesPerSeed`) was inside the same file.
 */
export function pass2WindowDrops(): number {
  return EXPECTED_SEEDS * Math.floor(PASS2_NONCES_PUBLISHED / 2);
}

/** Σ (rows + 1) over every declared configuration — the paytable's total cell count. */
export function totalPayoutCells(cfg: PlinkoConfigData): number {
  return allConfigs(cfg).reduce((s, c) => s + slotCount(c.rows), 0);
}

// ── The rule table ────────────────────────────────────────────────────────────

export interface Rule {
  /** Matches a COLLAPSED leaf path: array indices are rendered as `[]`. */
  readonly path: RegExp;
  readonly domain: Domain;
}

/** Collapse `a.b[3].c` to `a.b[].c` so one rule covers every element of a list. */
export function collapsePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/**
 * Every numeric leaf of every artifact, with the domain it physically admits.
 *
 * Ordering matters: the FIRST matching rule wins, so narrower patterns come first.
 */
export function domainRules(cfg: PlinkoConfigData): Record<string, Rule[]> {
  const configs = allConfigs(cfg).length;
  const cells = totalPayoutCells(cfg);
  const { min: mMin, max: mMax } = attainableMultiplierRange(cfg);
  const RTP = realBetween(mMin, mMax, 'attainable multiplier range of the pinned paytable');
  const ROWS = intBetween(cfg.rows.min, cfg.rows.max, 'declared board sizes');
  const RISK = intBetween(1, cfg.wtf_mode.riskLevel, 'declared risk levels');
  const EPOCH_IDX = intAtMost(EXPECTED_SEEDS - 1, 'epoch index within the audited population');
  const SEED_COUNT = intAtMost(EXPECTED_SEEDS, 'audited seed population');
  const BET_COUNT = intAtMost(EXPECTED_BETS, 'audited bet population');
  const CFG_COUNT = intAtMost(configs, 'configurations the pinned config declares');
  const CELL_COUNT = intAtMost(cells, 'paytable cells the pinned config declares');
  const SLOTS = intBetween(slotCount(cfg.rows.min), slotCount(cfg.rows.max), 'slots per board');
  const EDGE_HITS = intAtMost(pass2WindowDrops(), 'drops in one Pass-2 window across the audited seed population');

  return {
    // ── outputs/simulation-results.json ────────────────────────────────────────
    'simulation-results.json': [
      { path: /^\.houseEdge$/, domain: PROBABILITY },

      { path: /^\.pass1_fresh_seeds\.(configs)$/, domain: CFG_COUNT },
      { path: /^\.pass1_fresh_seeds\.(roundsPerConfig|totalRounds)$/, domain: NONNEG_INT },
      { path: /^\.pass1_fresh_seeds\.executionTimeMs$/, domain: NONNEG_REAL },
      { path: /^\.pass1_fresh_seeds\.(chi2FailsAtAlpha01|chi2FailsBonferroni|serialIndependenceFailsUncorrected|serialIndependenceFailsBonferroni)$/, domain: CFG_COUNT },
      { path: /^\.pass1_fresh_seeds\.bonferroniAlpha$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.bonferroniZCritical$/, domain: NONNEG_REAL },
      { path: /^\.pass1_fresh_seeds\.(meanSimulatedRTP|meanTheoreticalRTP)$/, domain: RTP },

      { path: /^\.pass1_fresh_seeds\.results\[\]\.rows$/, domain: ROWS },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.riskLevel$/, domain: RISK },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.slotChi2$/, domain: CHI_SQUARED },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.slotDf$/, domain: NONNEG_INT },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.(slotPValue|runsPValue)$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.r1$/, domain: CORRELATION },
      // z-scores are signed and unbounded — a genuine extreme run must not be rejected.
      { path: /^\.pass1_fresh_seeds\.results\[\]\.(r1Z|runsZ)$/, domain: FINITE },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.(theoreticalRTP|simRTP)$/, domain: RTP },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.convergence\[\]$/, domain: RTP },

      { path: /^\.pass2_casino_seeds\.noncesPerSeed$/, domain: NONNEG_INT },
      { path: /^\.pass2_casino_seeds\.seeds_tested$/, domain: SEED_COUNT },
      { path: /^\.pass2_casino_seeds\.cherryPickFlags$/, domain: SEED_COUNT },
      // An EXPECTED count is a real, not an integer (9.595). Bounded above by the population.
      { path: /^\.pass2_casino_seeds\.expectedFlagsByChance$/, domain: realBetween(0, EXPECTED_SEEDS, 'expected count over the seed population') },
      { path: /^\.pass2_casino_seeds\.cherryPickSurvivalP$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.executionTimeMs$/, domain: NONNEG_REAL },

      { path: /^\.pass2_casino_seeds\.payoutWeighted\.(zEarlyMean|meanZEarlyMinusLate|tZEarlyMinusLate)$/, domain: FINITE },
      { path: /^\.pass2_casino_seeds\.payoutWeighted\.(zEarlySd|seZEarlyMinusLate)$/, domain: NONNEG_REAL },
      { path: /^\.pass2_casino_seeds\.payoutWeighted\.countZEarlyBelow1645$/, domain: SEED_COUNT },
      { path: /^\.pass2_casino_seeds\.payoutWeighted\.expectedZEarlyBelow1645$/, domain: realBetween(0, EXPECTED_SEEDS, 'expected count over the seed population') },
      { path: /^\.pass2_casino_seeds\.payoutWeighted\.(zEarlyBelowSurvivalP|pTwoSidedZEarlyMinusLate)$/, domain: PROBABILITY },
      // An edge hit is one drop landing in slot 0 or slot `rows`, so a window cannot contain
      // more edge hits than it contains DROPS. QA-16: this used to be NONNEG_INT on the
      // reasoning that the seeds × nonces product would have to come from the artifact's own
      // declared scale — but it does not: `EXPECTED_SEEDS` (src/loader.ts) and
      // `PASS2_NONCES_PUBLISHED` (src/config.ts) both state the audited experiment in source.
      // With no bound, `edgeHitsEarly = 1,000,000,000` against 1,010,000 possible drops was
      // accepted behind a 21/21 Full Pass.
      { path: /^\.pass2_casino_seeds\.payoutWeighted\.(edgeHitsEarly|edgeHitsLate)$/, domain: EDGE_HITS },

      { path: /^\.pass2_casino_seeds\.results\[\]\.epoch$/, domain: EPOCH_IDX },
      { path: /^\.pass2_casino_seeds\.results\[\]\.rows$/, domain: ROWS },
      { path: /^\.pass2_casino_seeds\.results\[\]\.riskLevel$/, domain: RISK },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(earlyPValue|latePValue)$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(zEarly|zLate)$/, domain: FINITE },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(rtpEarly|rtpLate)$/, domain: RTP },
    ],

    // ── outputs/calibration-results.json ───────────────────────────────────────
    'calibration-results.json': [
      { path: /^\.zThreshold$/, domain: NONNEG_REAL },
      { path: /^\.(noncesPerSeed|windowNonces)$/, domain: NONNEG_INT },
      { path: /^\.epochs$/, domain: SEED_COUNT },
      { path: /^\.(expectedZEarlyBelow1645Calibrated|expectedZEarlyBelow1645Naive)$/, domain: realBetween(0, EXPECTED_SEEDS, 'expected count over the seed population') },
      { path: /^\.(sdZEarlyBelow1645Calibrated|varianceZEarlyBelow1645Calibrated)$/, domain: NONNEG_REAL },
      { path: /^\.observedZEarlyBelow1645$/, domain: SEED_COUNT },
      { path: /^\.zEarlyBelowCalibratedSurvivalP$/, domain: PROBABILITY },
      { path: /^\.executionTimeMs$/, domain: NONNEG_REAL },

      { path: /^\.byConfig\[\]\.rows$/, domain: ROWS },
      { path: /^\.byConfig\[\]\.riskLevel$/, domain: RISK },
      { path: /^\.byConfig\[\]\.epochs$/, domain: SEED_COUNT },
      { path: /^\.byConfig\[\]\.mu$/, domain: RTP },
      { path: /^\.byConfig\[\]\.sd$/, domain: NONNEG_REAL },
      { path: /^\.byConfig\[\]\.windowNonces$/, domain: NONNEG_INT },
      // A left-tail SUM threshold is n*mu - z*sd*sqrt(n); for a small enough window that is
      // legitimately negative, so only finiteness is physical here.
      { path: /^\.byConfig\[\]\.sumThreshold$/, domain: FINITE },
      { path: /^\.byConfig\[\]\.windowRtpThreshold$/, domain: RTP },
      { path: /^\.byConfig\[\]\.latticeUnit$/, domain: POSITIVE_REAL },
      { path: /^\.byConfig\[\]\.leftTailProbability$/, domain: PROBABILITY },
      { path: /^\.byConfig\[\]\.crossCheck\.probability$/, domain: PROBABILITY },
      { path: /^\.byConfig\[\]\.crossCheck\.relativeDifference$/, domain: FINITE },

      { path: /^\.perEpoch\[\]\.epoch$/, domain: EPOCH_IDX },
      { path: /^\.perEpoch\[\]\.rows$/, domain: ROWS },
      { path: /^\.perEpoch\[\]\.riskLevel$/, domain: RISK },
      { path: /^\.perEpoch\[\]\.leftTailProbability$/, domain: PROBABILITY },
    ],

    // ── outputs/coverage-results.json ──────────────────────────────────────────
    'coverage-results.json': [
      { path: /^\.totalConfigs$/, domain: CFG_COUNT },
      { path: /^\.totalCells$/, domain: CELL_COUNT },
      { path: /^\.(cellsExercised|cellsUnexercised)$/, domain: CELL_COUNT },
      { path: /^\.coveragePct$/, domain: PERCENT },
      { path: /^\.rtpShareUnexercisedSummed$/, domain: NONNEG_REAL },
      { path: /^\.configsWithUnhitCells$/, domain: CFG_COUNT },
      { path: /^\.perConfig\[\]\.rows$/, domain: ROWS },
      { path: /^\.perConfig\[\]\.riskLevel$/, domain: RISK },
      // `slots` is the board's own size, so it is rows+1 for a declared board size.
      { path: /^\.perConfig\[\]\.slots$/, domain: SLOTS },
      { path: /^\.perConfig\[\]\.observed\[\]$/, domain: BET_COUNT },
      // `exercised` is a COUNT of slots that were hit, so it runs from 0 up to the largest
      // board — NOT from the smallest board size. (The first draft of this rule reused
      // `SLOTS` and rejected the honest value 8; `tests/plinko/domainTests.ts` caught it,
      // which is the whole reason that test asserts both directions.)
      { path: /^\.perConfig\[\]\.exercised$/, domain: intAtMost(slotCount(cfg.rows.max), 'slots on the largest declared board') },
      // Slot INDICES of the never-hit cells, so 0 .. slots-1 on the largest declared board.
      // This field was missed by the first pass over the artifact because `perConfig[0]`
      // happens to have an empty `unhit` list — the "a leaf with no declared domain is a
      // failure" rule is what surfaced it, which is precisely its purpose.
      { path: /^\.perConfig\[\]\.unhit\[\]$/, domain: intAtMost(slotCount(cfg.rows.max) - 1, 'slot index on the largest declared board') },
      { path: /^\.perConfig\[\]\.rtpShareUnexercised$/, domain: NONNEG_REAL },
    ],

    // ── outputs/verification-stats.json ────────────────────────────────────────
    // The machine-readable numerics the scored steps emit. Validating this catches an
    // impossible value shipped in the committed copy AND an impossible value produced by
    // our own step code — the leaves here ARE the steps' `data` blocks.
    'verification-stats.json': [
      { path: /^\.steps\.step6\.(tested|expectedTested|changed|samePath)$/, domain: BET_COUNT },
      { path: /^\.steps\.step6\.expectedSamePath$/, domain: NONNEG_REAL },
      { path: /^\.steps\.step6\.(samePathSurvivalP|alpha)$/, domain: PROBABILITY },

      { path: /^\.steps\.step7\.(betsChecked|mismatches)$/, domain: BET_COUNT },
      { path: /^\.steps\.step7\.(cellsExercised|cellsTotal|cellsUnexercised)$/, domain: CELL_COUNT },

      { path: /^\.steps\.step10\.configs$/, domain: CFG_COUNT },
      { path: /^\.steps\.step10\.(minRTP|maxRTP)$/, domain: RTP },
      { path: /^\.steps\.step10\.(minEdge|maxEdge|maxDeviationFrom99)$/, domain: FINITE },
      { path: /^\.steps\.step10\.(enumerationWorstDelta|enumerationTolerance)$/, domain: NONNEG_REAL },

      { path: /^\.steps\.step11\.(betsLoaded|expectedBets|planSum|metaPlannedTotal)$/, domain: BET_COUNT },
      { path: /^\.steps\.step11\.(seedRecords|expectedSeeds)$/, domain: SEED_COUNT },
      { path: /^\.steps\.step11\.(phaseCounts|expectedPhaseBets)\.[A-E]$/, domain: BET_COUNT },

      { path: /^\.steps\.step12\.(epochsByHash|epochIndexes|expectedSeeds|seedRecords)$/, domain: SEED_COUNT },
      { path: /^\.steps\.step12\.(minEpochSize|maxEpochSize|expectedEpochSize|metaEpochSize)$/, domain: intAtMost(EXPECTED_BETS, 'bets in an epoch') },

      { path: /^\.steps\.step14\.(phaseDBets|recomputed|exposedBets)$/, domain: BET_COUNT },
      { path: /^\.steps\.step14\.distinctClientSeeds$/, domain: BET_COUNT },
      { path: /^\.steps\.step14\.(phaseDWagered|phaseDPaid|exposedWagered|exposedPaid)$/, domain: NONNEG_REAL },
      { path: /^\.steps\.step14\.(predictableEpochs\[\]|exposedEpochs\[\])$/, domain: EPOCH_IDX },
      // -1 is the declared "no predictable epoch" sentinel; see tests/steps/phase-d.ts.
      { path: /^\.steps\.step14\.unresolvedPredictabilityEpoch$/, domain: intBetween(-1, EXPECTED_SEEDS - 1, 'epoch index, or -1 for none') },

      { path: /^\.steps\.step15\.(wtfBets|recomputed|multipliersChecked)$/, domain: BET_COUNT },
      { path: /^\.steps\.step15\.wtfTheoreticalRTP$/, domain: RTP },
      { path: /^\.steps\.step15\.(payingSlots|totalSlots)$/, domain: intAtMost(slotCount(cfg.rows.max), 'slots on a board') },
      { path: /^\.steps\.step15\.(pZeroPayout|pPayingSlot)$/, domain: PROBABILITY },

      { path: /^\.steps\.step16\.(expectedConfigs|resultRows|boardsPresentExactlyOnce|missingConfigs|strangerConfigs|duplicateConfigs|chi2BonferroniFails|serialUncorrectedFails|serialBonferroniFails|rtpWithin6SE|theoryRowsAgreeingWithPinnedConfig|serialPairsMeasured|aggregateDisagreements)$/, domain: CFG_COUNT },
      { path: /^\.steps\.step16\.(roundsPerConfig|totalRounds)$/, domain: NONNEG_INT },
      { path: /^\.steps\.step16\.(bonferroniAlpha|theoryRecomputeTolerance)$/, domain: PROBABILITY },
      { path: /^\.steps\.step16\.serialR1ZRunsZCorrelation$/, domain: CORRELATION },
      { path: /^\.steps\.step16\.serialR1ZRunsZCorrelationAbs$/, domain: realBetween(0, 1, 'absolute correlation') },
      { path: /^\.steps\.step16\.serialMaxAbsR1ZPlusRunsZ$/, domain: NONNEG_REAL },

      { path: /^\.steps\.step17\.(attestChecked|attestPopulation|revealedEpochs|missingRows|seedsTested|revealedSeedCount|resultRows|cherryPickFlags|countZEarlyBelow1645)$/, domain: SEED_COUNT },
      { path: /^\.steps\.step17\.attestMaxAbsDiff$/, domain: NONNEG_REAL },
      { path: /^\.steps\.step17\.(noncesPerSeed|windowNonces)$/, domain: NONNEG_INT },
      { path: /^\.steps\.step17\.calibratedExpectation$/, domain: realBetween(0, EXPECTED_SEEDS, 'expected count over the seed population') },
      { path: /^\.steps\.step17\.calibratedSurvivalP$/, domain: PROBABILITY },
      // QA-16: the Pass-2 recompute's own bookkeeping. `rtpRowsRecomputed` cannot exceed the
      // seed population; the re-counted edge hits are bounded by the drops one window holds;
      // `summaryFieldsRecomputed` is a count of comparisons this run performed.
      { path: /^\.steps\.step17\.rtpRowsRecomputed$/, domain: SEED_COUNT },
      { path: /^\.steps\.step17\.(recomputedEdgeHitsEarly|recomputedEdgeHitsLate)$/, domain: EDGE_HITS },
      { path: /^\.steps\.step17\.summaryFieldsRecomputed$/, domain: NONNEG_INT },

      // QA-13's own bookkeeping, emitted by Steps 16, 17 and 20. Declaring these is not a
      // formality: the first run after the domain check was wired FAILED Step 20 because
      // these very fields had no domain, which is the rule working exactly as intended.
      { path: /^\.steps\.step(16|17|20)\.(domainLeavesChecked|domainViolations|domainUndeclaredFields|domainFailures)$/, domain: NONNEG_INT },

      { path: /^\.steps\.step21\.drops$/, domain: BET_COUNT },
      { path: /^\.steps\.step21\.seeds$/, domain: SEED_COUNT },
      { path: /^\.steps\.step21\.groups$/, domain: CFG_COUNT },
      { path: /^\.steps\.step21\.(fisherX2|perGroupChi2\.rows\d+)$/, domain: CHI_SQUARED },
      { path: /^\.steps\.step21\.fisherDf$/, domain: NONNEG_INT },
      { path: /^\.steps\.step21\.(fisherCombinedP|minGroupP|bonferroniPerGroupAlpha|perGroupP\.rows\d+)$/, domain: PROBABILITY },
      { path: /^\.steps\.step21\.perGroupN\.rows\d+$/, domain: BET_COUNT },

      { path: /^\.info\.Live RTP\.liveRTP$/, domain: RTP },
      { path: /^\.info\.Live RTP\.(totalWagered|totalPayout)$/, domain: NONNEG_REAL },
      { path: /^\.info\.Live RTP\.bets$/, domain: BET_COUNT },
      { path: /^\.info\.Lag-1 autocorr\.lag1Autocorrelation$/, domain: CORRELATION },
      { path: /^\.info\.Lag-1 autocorr\.sequenceLength$/, domain: BET_COUNT },
      { path: /^\.info\.Win rate by config\.configs$/, domain: CFG_COUNT },
      { path: /^\.info\.Win rate by config\.(strictlyProfitable(Min|Max)Pct|resultWon(Min|Max)Pct)$/, domain: PERCENT },
      // A max slot deviation is a RATIO against the binomial expectation and is
      // legitimately > 1 (observed 2.117 on 11 rows). Only non-negativity is physical.
      { path: /^\.info\.Slot distribution\.maxSlotDeviation\.rows\d+$/, domain: NONNEG_REAL },
      { path: /^\.info\.Slot distribution\.groupN\.rows\d+$/, domain: BET_COUNT },
    ],
  };
}

export interface DomainViolation {
  path: string;
  value: number;
  expected: string;
}

/** Collect every numeric leaf of `doc` as `[collapsedPath, value]`. */
export function numericLeaves(doc: unknown, path = '', out: [string, number][] = []): [string, number][] {
  if (typeof doc === 'number') { out.push([collapsePath(path), doc]); return out; }
  if (doc === null || typeof doc !== 'object') return out;
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => numericLeaves(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) numericLeaves(v, `${path}.${k}`, out);
  return out;
}

/**
 * Validate every numeric leaf of `doc` against `rules`.
 *
 * A leaf matched by NO rule is a violation in its own right (`uncovered`). That is
 * deliberate: an unbounded new field is precisely how this class reopens, and a silent
 * fallback to "must be finite" would have accepted `totalConfigs = -1`.
 */
export function validateDomains(doc: unknown, rules: Rule[]): { violations: DomainViolation[]; uncovered: string[]; checked: number } {
  const violations: DomainViolation[] = [];
  const uncovered: string[] = [];
  const leaves = numericLeaves(doc);
  for (const [p, v] of leaves) {
    const rule = rules.find(r => r.path.test(p));
    if (!rule) {
      if (!uncovered.includes(p)) uncovered.push(p);
      continue;
    }
    if (!rule.domain.ok(v)) violations.push({ path: p, value: v, expected: rule.domain.label });
  }
  return { violations, uncovered, checked: leaves.length };
}

/** One-line summary for a step's detail string. */
export function describeDomainFailures(artifact: string, r: { violations: DomainViolation[]; uncovered: string[] }): string[] {
  const out: string[] = [];
  for (const v of r.violations.slice(0, 4)) {
    out.push(`${artifact}${v.path} = ${v.value} is not ${v.expected}`);
  }
  if (r.violations.length > 4) out.push(`${artifact}: +${r.violations.length - 4} more impossible value(s)`);
  for (const p of r.uncovered.slice(0, 4)) {
    out.push(`${artifact}${p} has no declared value domain (add one in src/domains.ts)`);
  }
  if (r.uncovered.length > 4) out.push(`${artifact}: +${r.uncovered.length - 4} more undeclared field(s)`);
  return out;
}
