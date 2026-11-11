/**
 * RTP-CLAIM wiring — LIQD Plinko: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), and the enforcement switch RTP_CLAIM_RULE_ENFORCED is
 * this package's src/rtp-claim-switch.ts, read by that copy. Rule 1.2.0 (Methodology v1.1) 2026-10-14: the claim
 * source names the game page, one of the rule's six places; an enforced miss would be RTP FIGURE OVERSTATED. Rule RTP-CLAIM 1.0.0 agreed 2026-09-29,
 * 1.1.0 agreed 2026-10-01.
 *
 * SETTINGS. Every configuration (src/config.ts allConfigs): rows 8–16 × risk low / medium / high,
 * plus WTF (risk 4, 13 rows) — 28.
 * EXACT RTP. Σ_k C(rows, k)/2^rows × multiplier[k], each multiplier the exact decimal of its literal
 * in the pinned plinkoConfig.json (src/config.ts payoutTable; the table Step 10 prices).
 * CLAIM. Flat 1 % house edge = RTP 99/100: the figure the live page shows the player (liqd.com
 * "Edge: 1.00%", RTP "99% on every board", read 2026-10-01, evidence/rtp-page-labels-2026-10-01.json),
 * the same as "houseEdge": 0.01 in plinkoConfig.json (declaration paytable.claimedHouseEdge 0.01).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate, parseRational } from './rtp-claim';
import { loadPlinkoConfig, allConfigs, payoutTable, riskName } from './config';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.99',
  source: 'LIQD Plinko: the game page liqd.com/originals/plinko shows "Released: June 2026 | Edge: 1.00%", RTP "99% on every board" and "The board still holds 99% RTP" (read 2026-10-01, evidence/rtp-page-labels-2026-10-01.json). Same figure as "houseEdge": 0.01 in plinkoConfig.json (declaration paytable.claimedHouseEdge 0.01)',
};

/** The scored step that carries PLINKO-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 10;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = '46f44fcb21791715d09e33d7bea9c3fe15ce29c829f32062ca64f721d7be67f0';

const binom = (n: number, k: number): bigint => {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
};

export function computeRtpClaim(): RtpClaimResult {
  const cfg = loadPlinkoConfig();
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  for (const { rows, riskLevel } of allConfigs(cfg)) {
    const table = payoutTable(cfg, rows, riskLevel);
    if (table.length !== rows + 1) throw new Error(`${rows}/${riskLevel}: ${table.length} multipliers`);
    let num = 0n, den = 1n;
    table.forEach((m, k) => {
      const r = parseRational(String(m));      // the literal's exact decimal (shortest round-trip form)
      num = num * r.d + binom(rows, k) * r.n * den;
      den = den * r.d;
    });
    acc.add(`rows=${rows} risk=${riskName(cfg, riskLevel)}`, num, den * (1n << BigInt(rows)));
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'liqd/plinko', game: 'plinko',
    settingSpace: 'rows 8–16 × risk low / medium / high, plus WTF (13 rows) — 28 configurations',
    rtpMethod: 'exact rational: Σ_k C(rows,k)/2^rows × the plinkoConfig.json multiplier literal',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
