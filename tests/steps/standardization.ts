/**
 * Steps 18–20: Standardization-parity steps.
 *
 * Each property is derivable from the committed capture/config with no new data and is
 * recomputed here (path/slot from the RNG, symmetry and hashes from the pinned config),
 * not read from an operator summary field. They bring this audit to parity with the
 * steps of an earlier published Plinko audit, without padding — each asserts a distinct property with a
 * coverage assertion so a pass over an empty set cannot occur.
 *
 *   18  Bet-Size Invariance          — path/slot independent of wager (Phase C, 10.00 USDT on the Phase B board)
 *   19  Multiplier Table Symmetry    — every payout table is left/right symmetric
 *   20  Artifact Hash Integrity      — dataset AND multiplier-config SHA-256 pinned,
 *                                    promoted to a scored step
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { step } from './context';
import type { StepResult, VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { domainRules, validateDomains, describeDomainFailures } from '../../src/domains';
import { payoutTable, configSha256, PLINKO_CONFIG_SHA256, allConfigs, isWtf } from '../../src/config';
import { EXPECTED_PLAN, MIN_PHASE_C_BETS } from '../../src/loader';
import { checkTableAgainstPageRead } from '../../src/page-labels';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap, cfg } = ctx;
  const out: StepResult[] = [];

  // ── Step 18: Bet-Size Invariance ────────────────────────────────────────────
  // revealPlinko(serverSeed, clientSeed, nonce, rows) takes no wager argument, so the drop path and
  // slot cannot depend on stake. Observed at an isolated elevated stake: Phase C is 200 drops at
  // 10.00 USDT on 16 rows / high risk — the board Phase B samples at 0.10 USDT — recomputed here
  // path-and-slot, and paid stake × the table cell exactly (integer 1e-8 units, converted here with its own
  // Math.round; Step 8 uses src/money.ts unitsOf, which also rejects an off-grid amount).
  // Deterministic; no distributional test at n = 200.
  {
    const c = ctx.phaseC;
    const planC = EXPECTED_PLAN.filter((e) => e.phase === 'C');
    const planCBets = planC.reduce((a, e) => a + e.bets, 0);
    const planCStake = planC[0]?.stake ?? '';
    const lowStakes = [...new Set(EXPECTED_PLAN.filter((e) => e.phase !== 'C').map((e) => e.stake))];
    let chk = 0, bad = 0, offStake = 0, payBad = 0;
    for (const b of c) {
      if (b.betAmount !== planCStake) offStake++;
      const cell = payoutTable(cfg, b.numberOfRows, b.riskLevel)[b.winningSlot];
      // stake × multiplier in integer 1e-8 units: both are on the grid (8-dp string, ≤ 1-dp multiplier).
      const stakeUnits = Math.round(Number(b.betAmount) * 1e8), winUnits = Math.round(Number(b.winningAmount) * 1e8);
      if (!Number.isFinite(cell) || Math.round(stakeUnits * cell) !== winUnits) payBad++;
      const ss = seedMap.get(b.hashedServerSeed);
      if (!ss) continue;
      chk++;
      const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
      if (path !== b.dropDetails || winningSlot !== b.winningSlot) bad++;
    }
    const stakes = [...new Set(bets.map((b) => b.betAmount))].sort((a, z) => Number(a) - Number(z));
    // Config set is derived from the phase, not hard-coded: Phase C must be a single
    // (rows, risk) config for this bet-size-invariance argument to hold.
    const boardOf = (rows: typeof c) =>
      [...new Set(rows.map((b) => `${b.numberOfRows}r/risk${b.riskLevel}`))].sort();
    const phaseCConfigs = boardOf(c);
    const singleConfig = phaseCConfigs.length === 1;
    const configLabel = phaseCConfigs.join(', ') || 'none';
    // A SINGLE Phase C board is not enough; it has to be the PHASE B board. Phase C exists
    // to isolate STAKE, and on a board Phase B never ran, stake and board move together and
    // the comparison isolates neither. The two boards are read from the bets and required
    // equal; naming either one here would let a capture that drifted keep passing.
    const phaseBConfigs = boardOf(ctx.phaseB ?? []);
    const phaseBLabel = phaseBConfigs.join(', ') || 'none';
    const sameBoard = phaseBConfigs.length > 0 && phaseCConfigs.join(',') === phaseBConfigs.join(',');
    const elevated = planCStake !== '' && lowStakes.every((s) => Number(planCStake) > Number(s));
    const arity = revealPlinko.length;
    const ok = c.length === planCBets && c.length >= MIN_PHASE_C_BETS && chk === c.length && chk > 0 && bad === 0
      && offStake === 0 && payBad === 0 && singleConfig && sameBoard && elevated && arity === 4;
    out.push(step(18, 'Bet-Size Invariance', ok ? 'PASS' : 'FAIL',
      `${chk}/${c.length} Phase C drops (plan ${planCBets}, floor ${MIN_PHASE_C_BETS}) at ${planCStake} USDT (${configLabel}${singleConfig ? '' : ' — EXPECTED a single config'}) recompute path-and-slot from the revealed seed — ${bad} mismatch; ${c.length - offStake}/${c.length} at the planned elevated stake; ${c.length - payBad}/${c.length} paid stake × the table cell exactly. ` +
      (sameBoard
        ? `Phase C runs the Phase B board (${phaseBLabel}), so bet size is the only variable that moved. `
        : `COMPARISON NOT ISOLATED: Phase C runs ${configLabel} but Phase B runs ${phaseBLabel} — stake and board both changed. `) +
      `revealPlinko declares ${arity} parameters (serverSeed, clientSeed, nonce, rows — no wager); the drops at ${planCStake} are produced by the identical engine as the drops at ${lowStakes.join(', ')} (stakes present: ${stakes.join(', ')}), so the path cannot depend on bet size` +
      (chk === 0 ? '; COVERAGE FAIL: 0 Phase C drops recomputed' : ''),
      { phaseCBets: c.length, phaseCFloor: MIN_PHASE_C_BETS, recomputed: chk - bad, recomputeMismatches: bad, betsOffStake: offStake, payoutMismatches: payBad, drawArity: arity }));
  }

  // ── Step 19: Multiplier Table Symmetry ──────────────────────────────────────
  // A fair Plinko board is left/right symmetric: multiplier[k] == multiplier[rows−k] for
  // every slot. Verified across every table (allConfigs: the 27 standard plus WTF).
  {
    let tables = 0, asymmetric = 0;
    const fails: string[] = [];
    const check = (arr: number[], label: string) => {
      tables++;
      for (let k = 0; k < arr.length; k++) {
        if (arr[k] !== arr[arr.length - 1 - k]) {
          asymmetric++;
          if (fails.length < 4) fails.push(label);
          break;
        }
      }
    };
    for (const c of allConfigs(cfg)) {
      check(payoutTable(cfg, c.rows, c.riskLevel), isWtf(c.riskLevel) ? `WTF(${c.rows}r)` : `${c.rows}r/risk${c.riskLevel}`);
    }
    const ok = tables > 0 && asymmetric === 0;
    out.push(step(19, 'Multiplier Table Symmetry', ok ? 'PASS' : 'FAIL',
      `${tables} multiplier tables (standard rows × risk 1–3, plus WTF) all left/right symmetric (multiplier[k] == multiplier[rows−k]) — ${asymmetric} asymmetric` +
      (fails.length ? `; e.g. ${fails.join(', ')}` : '') +
      (tables === 0 ? '; COVERAGE FAIL: no tables checked' : '')));
  }

  // ── Step 20: Artifact Hash Integrity + published-pin consistency ─────────────
  // Both pinned artifacts — the captured dataset and the multiplier-config tables — are
  // guarded by the loaders before anything runs; scoring them here promotes the two
  // integrity pins to a visible numbered step. This step is falsifiable BEYOND the
  // loader check: it scans every chapter for a published dataset/config SHA-256 and
  // FAILs if any published mention drifts from the loader pin (so a re-pin that is not
  // propagated to the docs fails the build), and asserts README carries the dataset
  // pin and MANIFEST carries both.
  {
    const dsOk = ctx.datasetSha256 === ctx.expectedDatasetHash;
    const cfgActual = configSha256();
    const cfgOk = cfgActual === PLINKO_CONFIG_SHA256;

    const root = path.join(__dirname, '../..');
    const docs = readdirSync(root).filter(f => f.endsWith('.md'));
    // Exhibit image hashes: a chapter may cite the SHA-256 of an evidence exhibit beside its
    // dimensions. Recompute every exhibit file's hash and allow exactly those, so a genuine
    // exhibit hash passes while a fabricated or drifted 64-hex token still fails.
    const exhibitHashes = new Set<string>();
    const evidenceDir = path.join(root, 'evidence');
    if (existsSync(evidenceDir)) {
      for (const f of readdirSync(evidenceDir)) {
        const p = path.join(evidenceDir, f);
        if (statSync(p).isFile()) exhibitHashes.add(createHash('sha256').update(readFileSync(p)).digest('hex'));
      }
    }
    // The SHA-256 of each capture file the dataset names (meta.captures): a chapter may cite them, and each
    // is read from the pinned dataset here, never typed.
    const allowedSourceHashes = new Set<string>(ctx.captures.map(c => c.sha256));
    const bad: string[] = [];
    // Keyword-FREE drift scan: examine EVERY 64-hex token in every chapter, not only the
    // ones on lines that happen to carry a "Dataset SHA-256"/"plinkoConfig.json" keyword.
    // The old keyword gate let a drifted pin through on a generically-labelled row (e.g.
    // `| SHA-256 hash | <hash> |`). A 64-hex token is accepted ONLY if it equals one of the
    // two pins, OR it is a worked-example commitment reveal — a line of the form
    // `SHA-256(utf8(...)) = <hash> … hashedServerSeed`. Anything else is a drifted pin.
    for (const f of docs) {
      const text = readFileSync(path.join(root, f), 'utf8');
      for (const line of text.split('\n')) {
        const hashes = line.match(/\b[0-9a-f]{64}\b/g) ?? [];
        if (hashes.length === 0) continue;
        const isCommitmentReveal = /SHA-256\(utf8/.test(line) && /hashedServerSeed/.test(line);
        for (const h of hashes) {
          if (h === ctx.expectedDatasetHash || h === PLINKO_CONFIG_SHA256) continue;
          if (allowedSourceHashes.has(h)) continue; // the SHA-256 of a capture file the dataset names (meta.captures)
          if (isCommitmentReveal) continue; // legitimate per-seed commitment shown in a worked example
          if (exhibitHashes.has(h)) continue; // the recomputed SHA-256 of an evidence exhibit file
          bad.push(`${f}: unrecognised 64-hex ${h.slice(0, 12)}… (neither pin)`);
        }
      }
    }
    const readmeHasDs = readFileSync(path.join(root, 'README.md'), 'utf8').includes(ctx.expectedDatasetHash);
    // The long-form guide is `MANIFEST.md`. Since the 4 October 2026 consolidation the package
    // carries exactly two Markdown documents, README.md and MANIFEST.md, in the working repository
    // and in the published package alike, so there is one name to read and no package-only code
    // delta to re-apply by hand when the package is re-cut.
    const guidePath = [path.join(root, 'MANIFEST.md')].find((p) => existsSync(p));
    if (!guidePath) {
      bad.push('MANIFEST.md is not present — the long-form guide is missing');
    }
    const manifest = guidePath ? readFileSync(guidePath, 'utf8') : '';
    const manifestHasBoth = manifest.includes(ctx.expectedDatasetHash) && manifest.includes(PLINKO_CONFIG_SHA256);

    // ── VALUE DOMAINS of the COMMITTED emission artifacts ──
    // Setting `outputs/coverage-results.json` -> `totalConfigs` to -1 would otherwise let `npm run
    // verify` print 21/21 and "PROVABLY FAIR — Full Pass". A negative count of
    // configurations is physically impossible, and the only thing that noticed was the
    // derived-emission guard, which fires AFTER the verdict is printed and only proves the
    // BYTES MOVED — re-baseline the artifact and it walks straight through. `gate-values.sh`
    // grades a pin-only rejection as a failure, correctly.
    //
    // Neither coverage-results.json nor verification-stats.json is READ by a scored step —
    // they are emitted — so no step owned their values. Step 20 is the artifact-integrity
    // step, so it owns them now: every numeric leaf of both committed files must be a value
    // the game physically admits, with every bound taken from src/domains.ts (which derives
    // them from the pinned plinkoConfig.json and src/loader.ts), never from the file being
    // checked. A leaf with no declared domain fails too, so the class cannot reopen quietly.
    const rules = domainRules(ctx.cfg);
    const domainBad: string[] = [];
    let domainLeaves = 0;
    for (const rel of ['coverage-results.json', 'verification-stats.json'] as const) {
      const p = path.join(ctx.outputsDir, rel);
      if (!existsSync(p)) {
        // Absence is handled by the emission guard in tests/verify.ts (R3-K6); Step 20 does
        // not double-report it, but it must not silently score a file it never read.
        domainBad.push(`${rel}: not present, so its values were not domain-checked`);
        continue;
      }
      let doc: unknown;
      try { doc = JSON.parse(readFileSync(p, 'utf8')); }
      catch (e) { domainBad.push(`${rel}: not valid JSON (${(e as Error).message})`); continue; }
      const r = validateDomains(doc, rules[rel]);
      domainLeaves += r.checked;
      domainBad.push(...describeDomainFailures(rel, r));
    }
    const domainOk = domainBad.length === 0;

    // PLINKO-13, table provenance on production: every cell of the pinned table against the bucket labels and
    // page statements read on liqd.com (src/page-labels.ts, evidence/liqd-plinko-page-reads-2026-10-20.json).
    const page = checkTableAgainstPageRead(cfg, root);
    if (!page.ok) bad.push(`page-label table check: ${page.problems.slice(0, 3).join('; ')}`);

    const ok = dsOk && cfgOk && bad.length === 0 && readmeHasDs && manifestHasBoth && domainOk;
    out.push(step(20, 'Artifact Hash + Value-Domain Integrity', ok ? 'PASS' : 'FAIL',
      `dataset SHA-256 ${ctx.datasetSha256.slice(0, 16)}… ${dsOk ? 'matches' : '≠'} pin; ` +
      `multiplier-config SHA-256 ${cfgActual.slice(0, 16)}… ${cfgOk ? 'matches' : '≠'} pin; ` +
      `loader pins match; every published 64-hex token in the Markdown present equals a loader pin ` +
      `, an exhibit hash, a capture-file hash named by the dataset, or an allow-listed worked-example commitment` +
      (bad.length ? `; ${bad.length} DRIFTED: ${bad.slice(0, 4).join('; ')}` : '') +
      `; table against the production page read of 20 Oct 2026 (${page.fileSha256 ? page.fileSha256.slice(0, 12) + '…' : 'missing'}): ${page.cells - page.mismatches}/${page.cells} cells of ${page.boards} boards equal what liqd.com/originals/plinko showed (${page.cellsByNumericLabel} by a numeric bucket label, ${page.cellsBy1kLabel} by the label 1k with the page's "1,000x" sentence, ${page.cellsByPageStatement} WTF middle cells by the page's "pay nothing" sentence)` +
      `; committed emission artifacts: ${domainLeaves} numeric leaf/leaves checked against value domains derived from the pinned config` +
      (bad.length ? '' : '') +
      (readmeHasDs ? '' : '; README missing dataset pin') +
      (manifestHasBoth ? '' : '; MANIFEST missing a pin') +
      (domainOk ? '' : `; FAIL: value domain — ${domainBad.slice(0, 5).join('; ')}${domainBad.length > 5 ? `; +${domainBad.length - 5} more` : ''}`),
      { domainLeavesChecked: domainLeaves, domainFailures: domainBad.length,
        hexTokensDrifted: bad.length,
        pageReadBoards: page.boards, pageReadCells: page.cells, pageReadCellsByNumericLabel: page.cellsByNumericLabel,
        pageReadCellsBy1kLabel: page.cellsBy1kLabel, pageReadCellsByPageStatement: page.cellsByPageStatement,
        pageReadMismatches: page.mismatches }));
  }

  return out;
}
