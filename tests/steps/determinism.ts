/**
 * Steps 5–6: RNG Determinism
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import * as path from 'path';
import { revealPlinko } from '../../src/rng';
import { payoutTable, allConfigs } from '../../src/config';
import { EXPECTED_BETS } from '../../src/loader';
import { loadSiteVerifier } from '../../src/site-verifier';
import { poissonBinomialSurvival } from '../../src/calibration';
import { BIAS_CEILING, DOMAIN_REJECTED, EXTRACTION_RANGE, RNG_DOMAIN, extractionCensus, modBias } from '../../src/bias';

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
  // ── Bit-extraction bias bound (PLINKO-08) — src/bias.ts, on the module's own draw ─────
  // docs/ALGORITHM.md §2 Step 2: bit = u mod 2, u = the first four digest bytes as an unsigned
  // 32-bit big-endian integer, over the whole 2^32 domain with no rejection step. 2 divides 2^32,
  // so each bit value has exactly 2^31 preimages and the residual bias is exactly 0 (modBias),
  // inside the profile's 2^-32 ceiling. The census binds that arithmetic to src/rng.ts: on every
  // row of every drop recomputed here, the path bit equals the range-2 draw, and the range-2 draw
  // equals the full-domain draw (u itself) mod 2, so the module neither folds nor re-maps u.
  //
  // Until 20 Oct 2026 this block was arithmetic on the constants of the earlier port's rejection
  // rule and never called src/rng.ts. The rebuilt module has no
  // rejection step: the spec defines none, and for range 2 none is needed.
  const censusDrops: Array<{ serverSeed: string; clientSeed: string; nonce: number; rows: number }> = [];
  for (const b of bets) {
    const ss = seedMap.get(b.hashedServerSeed);
    if (ss) censusDrops.push({ serverSeed: ss, clientSeed: b.clientSeed, nonce: b.nonce, rows: b.numberOfRows });
  }
  const census = extractionCensus(censusDrops);
  const worstExtractionBias = modBias(EXTRACTION_RANGE);
  const directionRejected = DOMAIN_REJECTED;            // the spec's draw rejects nothing
  const censusOk = census.drops === bets.length - skipped && census.rowDraws > 0
    && census.pathEqualsRangeDraw === census.rowDraws
    && census.rangeDrawEqualsDomainDrawMod === census.rowDraws;
  const biasExact = worstExtractionBias === 0 && censusOk;

  // ── Player-verifier parity (PLINKO-24) ─────────────────────────────────────────
  // The LIQD Plinko verifier on the ProvablyFair.org docs site (derive.js + the two files it
  // imports + the source card the page displays) is vendored byte for byte and pinned in
  // src/site-verifier.ts. It is RUN here, unmodified but for its module keywords, on every
  // captured bet, and must return the same L/R path and slot as src/rng.ts revealPlinko AND as
  // the capture, and the multiplier the casino served. Its paytable must equal plinkoConfig.json
  // cell for cell over all 28 boards, and the source card must BE derive.js. The population is
  // bound to EXPECTED_BETS, so a verifier that silently skipped bets cannot pass.
  const site = loadSiteVerifier(path.join(ctx.outputsDir, '..'));
  let siteChecked = 0, sitePathBad = 0, siteSlotBad = 0, siteMultBad = 0, siteRowsBad = 0;
  let siteTableCells = 0, siteTableBad = 0;
  let sourceCardOk = false;
  const siteExamples: string[] = [];
  if (site.verifier) {
    const v = site.verifier;
    sourceCardOk = v.sourceCardText === v.deriveText;
    for (const b of bets) {
      const ss = seedMap.get(b.hashedServerSeed);
      if (!ss) continue;
      siteChecked++;
      const d = v.derivePlinko({ clientSeed: b.clientSeed, serverSeed: ss, nonce: b.nonce, rows: b.numberOfRows, riskLevel: b.riskLevel });
      const ours = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
      const bad: string[] = [];
      if (d.path !== ours.path || d.path !== b.dropDetails) { sitePathBad++; bad.push(`path ${d.path} vs ours ${ours.path} vs served ${b.dropDetails}`); }
      if (d.slot !== ours.winningSlot || d.slot !== b.winningSlot) { siteSlotBad++; bad.push(`slot ${d.slot} vs ours ${ours.winningSlot} vs served ${b.winningSlot}`); }
      if (d.rows !== b.numberOfRows) { siteRowsBad++; bad.push(`rows ${d.rows} vs served ${b.numberOfRows}`); }
      if (d.multiplier !== b.multiplier) { siteMultBad++; bad.push(`multiplier ${d.multiplier} vs served ${b.multiplier}`); }
      if (bad.length && siteExamples.length < 3) siteExamples.push(`bet ${b.id}: ${bad.join(', ')}`);
    }
    for (const c of allConfigs(ctx.cfg)) {
      const ours = payoutTable(ctx.cfg, c.rows, c.riskLevel);
      const theirs = v.multipliersFor(c.rows, c.riskLevel) ?? [];
      if (theirs.length !== ours.length) siteTableBad += Math.max(ours.length, theirs.length);
      ours.forEach((m, i) => { siteTableCells++; if (theirs[i] !== m) siteTableBad++; });
    }
  }
  const siteOk = site.hashesOk && site.verifier !== null && sourceCardOk
    && siteChecked === EXPECTED_BETS && siteChecked === bets.length
    && sitePathBad === 0 && siteSlotBad === 0 && siteMultBad === 0 && siteRowsBad === 0
    && siteTableCells > 0 && siteTableBad === 0;
  const badPins = site.files.filter(f => !f.ok).map(f => `${f.file} ${f.sha256.slice(0, 12)} (pinned ${f.pinned.slice(0, 12)})`);

  const s5 = step(5, 'Path + Slot Recomputation',
    mismatches === 0 && skipped === 0 && biasExact && siteOk ? 'PASS' : 'FAIL',
    `${bets.length - skipped}/${bets.length} verified (expected ${bets.length}, 0 skipped); ${mismatches} mismatches; ${skipped} skipped (unrevealed seeds)`
      + `; bit-extraction bias bound (docs/ALGORITHM.md §2: bit = u mod 2 over the whole 2^32 domain, no rejection step; src/bias.ts): residual modulo bias ${worstExtractionBias} at range ${EXTRACTION_RANGE} `
      + `(ceiling ${BIAS_CEILING.toExponential(0)}), ${directionRejected}/${RNG_DOMAIN} of the domain unused; census on src/rng.ts over ${census.drops} drops, ${census.rowDraws} row draws: `
      + `path bit = range-2 draw ${census.pathEqualsRangeDraw}/${census.rowDraws}, range-2 draw = full-domain draw mod 2 ${census.rangeDrawEqualsDomainDrawMod}/${census.rowDraws} ⇒ an exact even split, bias 0`
      + (!biasExact ? `; FAIL: ${worstExtractionBias !== 0 ? `extraction bias ${worstExtractionBias} is not the exact split` : 'the census does not show the bit as u mod 2 on every row draw'}` : '')
      + `; site verifier (ProvablyFair.org docs VerifyBets games/plinko, ${site.files.filter(f => f.ok).length}/${site.files.length} files match their SHA-256 pins, source card ${sourceCardOk ? 'is' : 'is NOT'} derive.js): `
      + `run on ${siteChecked}/${EXPECTED_BETS} captured bets — ${sitePathBad} path, ${siteSlotBad} slot, ${siteMultBad} multiplier, ${siteRowsBad} row-count mismatch(es) against src/rng.ts and the capture; `
      + `its paytable ${siteTableCells - siteTableBad}/${siteTableCells} cells equal to plinkoConfig.json`
      + (!siteOk ? `; FAIL: site-verifier parity — ${[
          badPins.length ? `pins: ${badPins.join(', ')}` : '',
          site.error ? `load: ${site.error}` : '',
          site.verifier && !sourceCardOk ? 'the source card text differs from derive.js' : '',
          siteChecked !== EXPECTED_BETS ? `${siteChecked} bets run, ${EXPECTED_BETS} expected` : '',
          siteTableBad ? `${siteTableBad} paytable cell(s) differ` : '',
          ...siteExamples,
        ].filter(Boolean).join('; ')}` : ''),
    {
      verified: bets.length - skipped,
      mismatches,
      skipped,
      extractionRange: EXTRACTION_RANGE,
      extractionWorstBias: worstExtractionBias,
      extractionBiasCeiling: BIAS_CEILING,
      directionDomainRejected: directionRejected,
      siteVerifierFilesPinned: site.files.length,
      siteVerifierFilesMatchingPin: site.files.filter(f => f.ok).length,
      siteVerifierSourceCardIsDerive: sourceCardOk,
      siteVerifierBetsRun: siteChecked,
      siteVerifierPathMismatches: sitePathBad,
      siteVerifierSlotMismatches: siteSlotBad,
      siteVerifierMultiplierMismatches: siteMultBad,
      siteVerifierRowMismatches: siteRowsBad,
      siteVerifierPaytableCells: siteTableCells,
      siteVerifierPaytableCellsDiffering: siteTableBad,
    },
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
