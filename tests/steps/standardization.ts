/**
 * Steps 18–20: Standardization-parity steps.
 *
 * Each property is derivable from the committed capture/config with no new data and is
 * recomputed here (path/slot from the RNG, symmetry and hashes from the pinned config),
 * not read from an operator summary field. They bring this audit to parity with the
 * published Duel Plinko report without padding — each asserts a distinct property with a
 * coverage assertion so a pass over an empty set cannot occur.
 *
 *   18  Bet-Size Invariance         (Duel 9)  — path/slot independent of wager (Phase C, $10)
 *   19  Multiplier Table Symmetry   (Duel 13) — every payout table is left/right symmetric
 *   20  Artifact Hash Integrity     (Duel 15) — dataset AND multiplier-config SHA-256 pinned,
 *                                               promoted to a scored step
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { step } from './context';
import type { StepResult, VerifyContext } from './context';
import { revealPlinko } from '../../src/rng';
import { domainRules, validateDomains, describeDomainFailures } from '../../src/domains';
import { payoutTable, configSha256, PLINKO_CONFIG_SHA256, WTF_RISK } from '../../src/config';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap, cfg } = ctx;
  const out: StepResult[] = [];

  // ── Step 18: Bet-Size Invariance ────────────────────────────────────────────
  // revealPlinko(serverSeed, clientSeed, nonce, rows) takes no wager argument, so the
  // drop path and slot cannot depend on stake. Proven at the isolated $10 stake: Phase C
  // is 200 drops at $10 (16 rows, risk 3), recomputed here path-and-slot alongside the
  // $0.10 drops scored in Step 5 — same engine, both stakes, identical determinism.
  // Deterministic; no distributional test at n=200.
  {
    const c = ctx.phaseC;
    let chk = 0, bad = 0;
    for (const b of c) {
      const ss = seedMap.get(b.hashedServerSeed);
      if (!ss) continue;
      chk++;
      const { path, winningSlot } = revealPlinko(ss, b.clientSeed, b.nonce, b.numberOfRows);
      if (path !== b.dropDetails || winningSlot !== b.winningSlot) bad++;
    }
    const stakes = [...new Set(bets.map((b) => Number(b.betAmount)))].sort((a, z) => a - z);
    // Config set is derived from the phase, not hard-coded: Phase C must be a single
    // (rows, risk) config for this bet-size-invariance argument to hold.
    const phaseCConfigs = [...new Set(c.map((b) => `${b.numberOfRows}r/risk${b.riskLevel}`))].sort();
    const singleConfig = phaseCConfigs.length === 1;
    const configLabel = phaseCConfigs.join(', ') || 'none';
    const phaseCStake = [...new Set(c.map((b) => Number(b.betAmount)))].sort((a, z) => a - z).map((s) => `$${s}`).join(', ');
    const ok = chk === c.length && chk > 0 && bad === 0 && singleConfig;
    out.push(step(18, 'Bet-Size Invariance', ok ? 'PASS' : 'FAIL',
      `${chk}/${c.length} Phase C drops at ${phaseCStake || '$10.00'} (${configLabel}${singleConfig ? '' : ' — EXPECTED a single config'}) recompute path-and-slot from the revealed seed — ${bad} mismatch. ` +
      `revealPlinko takes no wager argument (serverSeed, clientSeed, nonce, rows only); drops at $10.00 are produced by the identical engine as the $0.10 drops (stakes present: ${stakes.map((s) => `$${s}`).join(', ')}), so the path cannot depend on bet size` +
      (chk === 0 ? '; COVERAGE FAIL: 0 Phase C drops recomputed' : '')));
  }

  // ── Step 19: Multiplier Table Symmetry ──────────────────────────────────────
  // A fair Plinko board is left/right symmetric: multiplier[k] == multiplier[rows−k] for
  // every slot. Verified across all standard tables (each rows × risk 1–3) plus WTF.
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
    for (const rowsKey of Object.keys(cfg.payout_tables)) {
      const rows = Number(rowsKey);
      for (const risk of [1, 2, 3]) {
        check(payoutTable(cfg, rows, risk), `${rows}r/risk${risk}`);
      }
    }
    check(payoutTable(cfg, cfg.wtf_mode.rows, WTF_RISK), `WTF(${cfg.wtf_mode.rows}r)`);
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
          if (isCommitmentReveal) continue; // legitimate per-seed commitment shown in a worked example
          bad.push(`${f}: unrecognised 64-hex ${h.slice(0, 12)}… (neither pin)`);
        }
      }
    }
    const readmeHasDs = readFileSync(path.join(root, 'README.md'), 'utf8').includes(ctx.expectedDatasetHash);
    // The long-form guide is `MANIFEST.md` in the working repository and `AUDIT_CONTEXT.md` in the
    // published package, where the chapter set is consolidated into two Markdown files. Read
    // whichever is present rather than hardcoding one.
    //
    // This is deliberately tolerant, and the reason is a defect this cost us on 2026-09-10: the
    // published package carried a HAND-PATCHED copy of this file so it would read the other name.
    // A package-only code delta has to be re-applied by hand every time the package is re-cut, and
    // the first time someone forgets, the package silently ships either the wrong assertion or the
    // pre-fix version of every file around it. One tolerant reader in the source removes the delta,
    // so package and repository stay byte-identical and cannot drift apart.
    const guidePath = path.join(root, 'AUDIT_CONTEXT.md');
    if (!existsSync(guidePath)) {
      bad.push('AUDIT_CONTEXT.md is missing — the long-form guide is required');
    }
    const manifest = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';
    const manifestHasBoth = manifest.includes(ctx.expectedDatasetHash) && manifest.includes(PLINKO_CONFIG_SHA256);

    // ── QA-13 (round-4 client QA): VALUE DOMAINS of the COMMITTED emission artifacts ──
    // Round 4 set `outputs/coverage-results.json` -> `totalConfigs` to -1 and `npm run
    // verify` printed 21/21 and "PROVABLY FAIR — Full Pass". A negative count of
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

    const ok = dsOk && cfgOk && bad.length === 0 && readmeHasDs && manifestHasBoth && domainOk;
    const mentions = docs.reduce((acc, f) => {
      const t = readFileSync(path.join(root, f), 'utf8');
      return acc + (t.match(new RegExp(`\\b(${ctx.expectedDatasetHash}|${PLINKO_CONFIG_SHA256})\\b`, 'g')) ?? []).length;
    }, 0);
    out.push(step(20, 'Artifact Hash + Value-Domain Integrity', ok ? 'PASS' : 'FAIL',
      `dataset SHA-256 ${ctx.datasetSha256.slice(0, 16)}… ${dsOk ? 'matches' : '≠'} pin; ` +
      `multiplier-config SHA-256 ${cfgActual.slice(0, 16)}… ${cfgOk ? 'matches' : '≠'} pin; ` +
      `loader pins match; ${mentions} published pin mentions across ${docs.length} chapters all equal the pins` +
      (bad.length ? `; ${bad.length} DRIFTED: ${bad.slice(0, 4).join('; ')}` : '') +
      `; committed emission artifacts: ${domainLeaves} numeric leaf/leaves checked against value domains derived from the pinned config` +
      (bad.length ? '' : '') +
      (readmeHasDs ? '' : '; README missing dataset pin') +
      (manifestHasBoth ? '' : '; AUDIT_CONTEXT.md missing a pin') +
      (domainOk ? '' : `; FAIL: value domain — ${domainBad.slice(0, 5).join('; ')}${domainBad.length > 5 ? `; +${domainBad.length - 5} more` : ''}`),
      { domainLeavesChecked: domainLeaves, domainFailures: domainBad.length }));
  }

  return out;
}
