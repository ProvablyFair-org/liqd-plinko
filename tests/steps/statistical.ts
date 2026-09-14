/**
 * Informational items (NOT scored) — live-bet slot distribution + lag-1.
 * Authoritative test is Pass 1 simulation at 1M rounds/config.
 */

import type { InfoItem } from './context';
import type { VerifyContext } from './context';
import { combination, lag1Autocorrelation } from '../../src/stats';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets } = ctx;
  const items: InfoItem[] = [];

  if (bets.length === 0) {
    items.push({ label: 'Live bets', detail: 'No bets in dataset (PROVISIONAL)' });
    return items;
  }

  // Live RTP (informational). Amounts are decimal strings — parseFloat for arithmetic.
  const totalPayout = bets.reduce((s, b) => s + parseFloat(b.winningAmount), 0);
  const totalWagered = bets.reduce((s, b) => s + parseFloat(b.betAmount), 0);
  const liveRTP = totalWagered > 0 ? totalPayout / totalWagered : 0;
  items.push({
    label: 'Live RTP',
    detail: `${(liveRTP * 100).toFixed(4)}% (${bets.length} bets — informational, not authoritative)`,
    data: { liveRTP, totalWagered, totalPayout, bets: bets.length },
  });

  // Lag-1 autocorrelation on win/loss sequence
  const winSeq = bets.map(b => (parseFloat(b.winningAmount) > parseFloat(b.betAmount) ? 1 : 0));
  const r1 = lag1Autocorrelation(winSeq);
  items.push({
    label: 'Lag-1 autocorr',
    detail: `r₁=${r1.toFixed(4)} (informational; authoritative = Pass 1 simulation)`,
    data: { lag1Autocorrelation: r1, sequenceLength: winSeq.length },
  });

  // ── Per-configuration win rates (informational) ───────────────────────────────
  // The composition figure live-parity-testing.md cites when it explains why the POOLED
  // lag-1 is not evidence of within-config dependence. Emitted under TWO definitions,
  // because they differ materially and the chapter has to say which it means (round-3
  // external review K14):
  //   strictly profitable — multiplier > 1, the drop returns more than it cost;
  //   dataset `result`    — result === 'won', which is multiplier >= 1 and therefore
  //                         counts the stake-returning 1.0x cells as wins.
  const winByConfig = new Map<string, { n: number; strict: number; won: number }>();
  for (const b of bets) {
    const k = `${b.numberOfRows}r/${b.riskLevel}`;
    const o = winByConfig.get(k) ?? { n: 0, strict: 0, won: 0 };
    o.n++;
    if (b.multiplier > 1) o.strict++;
    if (b.result === 'won') o.won++;
    winByConfig.set(k, o);
  }
  if (winByConfig.size > 0) {
    const rows = [...winByConfig.entries()].map(([k, o]) => ({
      config: k, strictPct: (100 * o.strict) / o.n, wonPct: (100 * o.won) / o.n,
    }));
    const pick = (sel: 'strictPct' | 'wonPct', dir: 1 | -1) =>
      rows.reduce((a, b) => (dir * (b[sel] - a[sel]) > 0 ? b : a));
    const sMin = pick('strictPct', -1), sMax = pick('strictPct', 1);
    const wMin = pick('wonPct', -1), wMax = pick('wonPct', 1);
    items.push({
      label: 'Win rate by config',
      detail: `strictly profitable (multiplier > 1): ${sMin.strictPct.toFixed(4)}% (${sMin.config}) to ${sMax.strictPct.toFixed(4)}% (${sMax.config})`
        + ` | dataset result=='won' (multiplier >= 1): ${wMin.wonPct.toFixed(4)}% (${wMin.config}) to ${wMax.wonPct.toFixed(4)}% (${wMax.config})`
        + ` | ${rows.length} configs`,
      data: {
        configs: rows.length,
        strictlyProfitableMinPct: sMin.strictPct,
        strictlyProfitableMaxPct: sMax.strictPct,
        strictlyProfitableMinConfig: sMin.config,
        strictlyProfitableMaxConfig: sMax.config,
        resultWonMinPct: wMin.wonPct,
        resultWonMaxPct: wMax.wonPct,
        resultWonMinConfig: wMin.config,
        resultWonMaxConfig: wMax.config,
      },
    });
  }

  // Slot distribution check vs expected binomial
  const byRows = new Map<number, number[]>();
  for (const b of bets) {
    if (!byRows.has(b.numberOfRows)) byRows.set(b.numberOfRows, new Array(b.numberOfRows + 1).fill(0));
    byRows.get(b.numberOfRows)![b.winningSlot]++;
  }
  const rowSummaries: string[] = [];
  const maxSlotDeviation: Record<string, number> = {};
  const groupN: Record<string, number> = {};
  for (const [rows, freq] of byRows) {
    const n = freq.reduce((a, b) => a + b, 0);
    const p = Math.pow(0.5, rows);
    let maxDev = 0;
    for (let k = 0; k <= rows; k++) {
      const exp = combination(rows, k) * p * n;
      if (exp > 0) maxDev = Math.max(maxDev, Math.abs(freq[k] - exp) / exp);
    }
    rowSummaries.push(`rows=${rows}: n=${n}, max slot dev=${(maxDev * 100).toFixed(1)}%`);
    maxSlotDeviation[`rows${rows}`] = maxDev;
    groupN[`rows${rows}`] = n;
  }
  if (rowSummaries.length > 0) {
    items.push({
      label: 'Slot distribution',
      detail: rowSummaries.join(' | '),
      data: { maxSlotDeviation, groupN },
    });
  }

  return items;
}
