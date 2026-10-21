/**
 * Bit-extraction bias bound (profile PLINKO-08) — the audit's own helper, built on the draw that
 * src/rng.ts exports. It is not part of the rebuilt module and was not written by its implementer.
 *
 * docs/ALGORITHM.md §2 Step 2: a row's bit is u mod 2, where u is the first four bytes of that
 * row's HMAC-SHA256 digest read as an unsigned 32-bit big-endian integer — the whole 2^32 domain,
 * with no rejection step. `u mod range` over 2^32 equally likely values gives every residue class
 * floor(2^32 / range) or that plus one preimages, so its worst residual bias is 0 when range
 * divides 2^32 and 1 / 2^32 otherwise. For the game's only range, 2, it is exactly 0.
 *
 * The arithmetic holds only if the module really draws the bit that way. `extractionCensus` checks
 * that on the module itself, for every row of every drop it is given: the bit revealPlinko puts in
 * the path equals generateProvablyFairNumber(…, cursor, 2), and that equals the full-domain draw
 * generateProvablyFairNumber(…, cursor, 2^32), which is u itself, taken mod 2. A module that folded,
 * rejected or re-mapped u before reducing it would break the second equality.
 */
import { generateProvablyFairNumber, revealPlinko } from './rng';

/** The uint32 domain the draw reads (four digest bytes). */
export const RNG_DOMAIN = 0x1_0000_0000;
/** The only range Plinko draws with: one left/right bit per row (revealPlinko). */
export const EXTRACTION_RANGE = 2;
/** The profile's ceiling for a residual bias. */
export const BIAS_CEILING = Math.pow(2, -32);

/** Worst residual bias of `u mod range` over the 2^32 domain: (max − min preimages) / 2^32. */
export function modBias(range: number): number {
  if (!Number.isSafeInteger(range) || range < 1 || range > RNG_DOMAIN) throw new Error(`range ${range} outside [1, 2^32]`);
  return (RNG_DOMAIN % range === 0 ? 0 : 1) / RNG_DOMAIN;
}

/** Values of the domain the draw leaves unused. The spec has no rejection step, so 0 for every range. */
export const DOMAIN_REJECTED = 0;

export interface ExtractionCensus {
  drops: number;
  rowDraws: number;
  /** path bit == generateProvablyFairNumber(…, cursor, 2) */
  pathEqualsRangeDraw: number;
  /** generateProvablyFairNumber(…, cursor, 2) == generateProvablyFairNumber(…, cursor, 2^32) mod 2 */
  rangeDrawEqualsDomainDrawMod: number;
}

/** Run the census over drops given as (serverSeed, clientSeed, nonce, rows). */
export function extractionCensus(
  drops: Iterable<{ serverSeed: string; clientSeed: string; nonce: number; rows: number }>,
): ExtractionCensus {
  const c: ExtractionCensus = { drops: 0, rowDraws: 0, pathEqualsRangeDraw: 0, rangeDrawEqualsDomainDrawMod: 0 };
  for (const d of drops) {
    c.drops++;
    const { path } = revealPlinko(d.serverSeed, d.clientSeed, d.nonce, d.rows);
    for (let cursor = 1; cursor <= d.rows; cursor++) {
      c.rowDraws++;
      const bit = generateProvablyFairNumber(d.serverSeed, d.clientSeed, d.nonce, cursor, EXTRACTION_RANGE);
      const u = generateProvablyFairNumber(d.serverSeed, d.clientSeed, d.nonce, cursor, RNG_DOMAIN);
      if (path[cursor - 1] === String(bit)) c.pathEqualsRangeDraw++;
      if (bit === u % EXTRACTION_RANGE) c.rangeDrawEqualsDomainDrawMod++;
    }
  }
  return c;
}
