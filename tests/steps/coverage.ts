/**
 * Per-config payout-table slot coverage — INFORMATIONAL (not a scored step).
 *
 * Coverage is a property of the CAPTURE DESIGN, not an integrity check: Step 7
 * proves every OBSERVED payout matches the pinned table, but it can only speak to
 * slots actually landed. This block measures which table cells the 10,100-bet
 * capture exercised, so the payout-verification / MANIFEST conditionality language
 * is sourced from a machine emission rather than hand-typed.
 *
 * A "cell" is one (config, slot) multiplier entry: 27 standard configs
 * (rows 8–16 × risk 1–3) each with rows+1 slots, plus the WTF config (rows 13,
 * 14 slots) = 365 cells total.
 */

import { allConfigs, isWtf, slotCount, binomP, payoutTable, theoreticalRTP } from '../../src/config';
import type { VerifyContext } from './context';

export interface ConfigCoverage {
  config: string;
  rows: number;
  riskLevel: number;
  wtf: boolean;
  slots: number;
  observed: number[];   // slots landed at least once by the capture
  unhit: number[];      // slots never observed — rest on the pinned config
  exercised: number;    // observed.length
  /** Share of this config's theoretical RTP carried by its never-observed cells:
   *  Σ_{k in unhit} C(rows,k)·0.5^rows·table[k] / theoreticalRTP. */
  rtpShareUnexercised: number;
}

export interface CoverageReport {
  note: string;
  totalConfigs: number;
  totalCells: number;
  cellsExercised: number;
  cellsUnexercised: number;
  coveragePct: number;               // exercised / total, 1 decimal
  /** Σ(never-observed RTP contribution) / Σ(theoretical RTP) across all configs. */
  rtpShareUnexercisedSummed: number;
  configsWithUnhitCells: number;
  fullyExercisedConfigs: string[];   // configs with 0 unhit cells
  wtfTails: {                        // the two 1000x WTF tails, explicit callout
    slot0Observed: boolean;
    slot13Observed: boolean;
    note: string;
  };
  perConfig: ConfigCoverage[];
}

export function run(ctx: VerifyContext): CoverageReport {
  const { bets, cfg } = ctx;

  // observed slot set per config key "rows:riskLevel"
  const observedByKey = new Map<string, Set<number>>();
  for (const b of bets) {
    const key = `${b.numberOfRows}:${b.riskLevel}`;
    let set = observedByKey.get(key);
    if (!set) { set = new Set<number>(); observedByKey.set(key, set); }
    set.add(b.winningSlot);
  }

  const perConfig: ConfigCoverage[] = [];
  let totalCells = 0;
  let cellsExercised = 0;
  let configsWithUnhitCells = 0;
  const fullyExercisedConfigs: string[] = [];
  let unexercisedRtpSum = 0;   // Σ over configs of the never-observed RTP contribution
  let theoreticalRtpSum = 0;   // Σ over configs of theoretical RTP

  for (const c of allConfigs(cfg)) {
    const wtf = isWtf(c.riskLevel);
    const slots = slotCount(c.rows);
    const key = `${c.rows}:${c.riskLevel}`;
    const obsSet = observedByKey.get(key) ?? new Set<number>();

    const observed: number[] = [];
    const unhit: number[] = [];
    for (let s = 0; s < slots; s++) (obsSet.has(s) ? observed : unhit).push(s);

    // RTP share carried by the never-observed cells for this config.
    const table = payoutTable(cfg, c.rows, c.riskLevel);
    const configRtp = theoreticalRTP(cfg, c.rows, c.riskLevel);
    let unexRtp = 0;
    for (const k of unhit) unexRtp += binomP(c.rows, k) * table[k];
    const rtpShareUnexercised = configRtp > 0 ? unexRtp / configRtp : 0;
    unexercisedRtpSum += unexRtp;
    theoreticalRtpSum += configRtp;

    totalCells += slots;
    cellsExercised += observed.length;
    const label = wtf ? 'WTF (rows 13 risk 4)' : `rows ${c.rows} risk ${c.riskLevel}`;
    if (unhit.length === 0) fullyExercisedConfigs.push(label);
    else configsWithUnhitCells++;

    perConfig.push({
      config: label, rows: c.rows, riskLevel: c.riskLevel, wtf,
      slots, observed, unhit, exercised: observed.length,
      rtpShareUnexercised,
    });
  }

  const rtpShareUnexercisedSummed = theoreticalRtpSum > 0 ? unexercisedRtpSum / theoreticalRtpSum : 0;

  const wtfSet = observedByKey.get(`${cfg.wtf_mode.rows}:${cfg.wtf_mode.riskLevel}`) ?? new Set<number>();
  const slot0Observed = wtfSet.has(0);
  const slot13Observed = wtfSet.has(13);

  const report: CoverageReport = {
    note: 'INFO only — payout-table cell coverage is a property of capture design, not a scored integrity check. Step 7 verifies that every OBSERVED payout matches the pinned table; the unexercised cells rest on the hash-pinned plinkoConfig.json (see AUDIT_CONTEXT.md#scope-and-coverage), not on live data.',
    totalConfigs: perConfig.length,
    totalCells,
    cellsExercised,
    cellsUnexercised: totalCells - cellsExercised,
    coveragePct: Math.round((cellsExercised / totalCells) * 1000) / 10,
    rtpShareUnexercisedSummed,
    configsWithUnhitCells,
    fullyExercisedConfigs,
    wtfTails: {
      slot0Observed,
      slot13Observed,
      note: `WTF 1000x tails slots 0 and 13 ${(!slot0Observed && !slot13Observed) ? 'were never observed' : 'observation state varies'} in the capture — they rest on the hash-pinned config.`,
    },
    perConfig,
  };

  console.log('');
  console.log('  ┌── Payout-Table Coverage (INFO, not scored) ──');
  console.log(`  │ Cells exercised: ${cellsExercised}/${totalCells} (${report.coveragePct}%)`);
  console.log(`  │ RTP share on never-observed cells (summed): ${(rtpShareUnexercisedSummed * 100).toFixed(2)}%`);
  console.log(`  │ Configs with >=1 unhit cell: ${configsWithUnhitCells}/${perConfig.length}`);
  console.log(`  │ Fully exercised: ${fullyExercisedConfigs.join(', ') || 'none'}`);
  console.log(`  │ WTF 1000x tails observed? slot0=${slot0Observed} slot13=${slot13Observed}`);
  console.log('  └──');

  return report;
}
