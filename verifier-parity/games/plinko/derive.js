import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';
import { paytable, effectiveRows, WTF_RISK_LEVEL } from './paytables';

/**
 * Plinko RNG — port of LIQD's HMAC-SHA256 commit-reveal algorithm.
 *
 * Source of truth (audit repo):
 *   https://github.com/ProvablyFair-org/liqd-plinko/blob/main/src/rng.ts
 *
 * Algorithm (one bit per row — note the 1-BASED cursor, which differs from
 * LIQD Mines' 0-based cursor; do not "normalize" it):
 *
 *   key = hex-decoded serverSeed                    // 16 raw bytes
 *   for row i = 0 .. rows-1:
 *     cursor  = i + 1                               // 1…rows
 *     range   = 2
 *     maxFair = floor(2^32 / range) * range         // rejection ceiling (2^32 base)
 *     loop:
 *       digest = HMAC-SHA256(key, `${clientSeed}:${nonce}:${cursor}`)
 *       scan up to eight 4-byte big-endian chunks of digest:
 *         if chunk < maxFair → bit = chunk % 2; break
 *       if all 8 chunks rejected → cursor += 1_000_000 and retry
 *         (for range 2, maxFair = 2^32, so this path is provably
 *          unreachable — kept for byte-fidelity with the operator code)
 *     path += bit                                   // '0' = left, '1' = right
 *
 *   winningSlot = count of '1' bits in path         // 0…rows
 *   multiplier  = standard: PLINKO_FIXED_ODDS[rows][riskLevel][winningSlot]
 *                 WTF:      PLINKO_WTF_ODDS[winningSlot]
 *
 * WTF (riskLevel = 4) forces rows = 13 — same derivation, different table.
 * LIQD's edge is ≈1.00% (0.84–1.09% per config): no bet-size dependence in
 * this derivation (the audit's Step 18 proves it at $0.10 and $10.00), so
 * the verifier takes no bet amount.
 *
 * The commitment is separate from the key: LIQD publishes
 * `SHA-256(utf8(serverSeed hex string))` — the seed TEXT (Stake convention),
 * while the HMAC key is the DECODED 16 bytes. The shell's universal hash
 * check (lib/commitHash.js) implements the text convention.
 *
 * Verified against the full liqd-plinko audit dataset:
 *   - paths + winning slots: 10,100 / 10,100 captured drops — 100% parity
 *   - multipliers (incl. all 2,000 WTF drops): 10,100 / 10,100 at 1e-9
 */

const TWO_32 = 0x100000000;

/**
 * Draw one provably-fair integer in [0, range) — LIQD's general helper,
 * reproduced faithfully (rejection sampling over 4-byte big-endian chunks).
 */
export function generateProvablyFairNumber(key, clientSeed, nonce, cursor, range) {
  const maxFair = Math.floor(TWO_32 / range) * range;
  let c = cursor;
  for (;;) {
    const hex = hmacSha256Hex(key, `${clientSeed}:${nonce}:${c}`);
    for (let off = 0; off + 8 <= hex.length; off += 8) {
      const chunk = parseInt(hex.substring(off, off + 8), 16);
      if (chunk < maxFair) return { value: chunk % range, hex };
    }
    c += 1_000_000; // unreachable for range 2 — kept for fidelity
  }
}

/**
 * Derive the full Plinko outcome for a single bet.
 *
 * @param {Object} params
 * @param {string} params.clientSeed  — player-controlled seed string
 * @param {string} params.serverSeed  — 32-char hex server seed (post-reveal)
 * @param {number} params.nonce       — bet position within the seed epoch (0…49 live)
 * @param {number} params.rows        — 8..16 (ignored for WTF: forced to 13)
 * @param {number} params.riskLevel   — 1 LOW · 2 MEDIUM · 3 HIGH · 4 WTF
 *
 * @returns {{
 *   path: string,        // per-row bits, exactly LIQD's `dropDetails` ('0'/'1')
 *   slot: number,        // winning slot = count of '1' bits (LIQD's `winningSlot`)
 *   rows: number,        // effective row count (13 when WTF)
 *   riskLevel: number,
 *   wtf: boolean,
 *   multiplier: number,  // pinned-table lookup for the landing slot
 *   rawFloat: number,    // first HMAC's uint32 mapped to [0,1) — entropy fingerprint
 *   firstHmac: string    // first HMAC hex, for Computation Details
 * }}
 */
export function derivePlinko({ clientSeed, serverSeed, nonce, rows, riskLevel }) {
  // LIQD reveals 32-char hex seeds (16 bytes) and keys the HMAC with the
  // DECODED bytes. Non-hex test input falls back to UTF-8 so the tool still
  // produces a deterministic result — the shell's warnInputs banner tells the
  // user such a seed can't match a real LIQD bet.
  const key = isHex(serverSeed) ? hexToBytes(serverSeed) : utf8Bytes(serverSeed);

  const effRows = effectiveRows(rows, riskLevel);
  let path = '';
  let firstHmac = '';

  for (let i = 0; i < effRows; i++) {
    const cursor = i + 1; // 1-based — LIQD Plinko's convention
    const { value, hex } = generateProvablyFairNumber(key, clientSeed, nonce, cursor, 2);
    if (i === 0) firstHmac = hex;
    path += String(value);
  }

  const slot = countOnes(path);
  const multiplier = paytable(effRows, riskLevel, slot);
  const rawFloat = parseInt(firstHmac.substring(0, 8), 16) / TWO_32;

  return {
    path,
    slot,
    rows: effRows,
    riskLevel,
    wtf: riskLevel === WTF_RISK_LEVEL,
    multiplier,
    rawFloat,
    firstHmac,
  };
}

function countOnes(path) {
  let n = 0;
  for (let i = 0; i < path.length; i++) if (path[i] === '1') n++;
  return n;
}

function isHex(s) {
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s);
  }
  // Fallback for environments without TextEncoder (old SSR)
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
