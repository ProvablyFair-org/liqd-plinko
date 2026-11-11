/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from LIQD's code:
 *   spec      the construction of docs/ALGORITHM.md (§1 to §3), as written on 20 Oct 2026 for the
 *             ProvablyFair.org audit framework from LIQD's public production pages
 *             (liqd.com/provably-fair, liqd.com/originals/plinko), the standard provably-fair
 *             construction and captured drops, without opening LIQD's code, its client bundle or any
 *             port of it. docs/ALGORITHM.md in this package is the production revision of 10 Nov 2026:
 *             same construction, every DATA line measured on the production dataset (its §8).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file (export
 *             names and types), and never opened LIQD's code or this package's earlier src/rng.ts.
 *   self-test tests/plinko/rngSpecTests.ts (the spec's vectors and properties).
 *
 * LIQD's code is not the source of this module and is not committed in this package; the
 * ProvablyFair.org site verifier (verifier-parity/, src/site-verifier.ts) is run as a second check by
 * Step 5, and scripts/spec-check.mjs is a third, independent write-out of the spec.
 *
 * Agreement on the production dataset is measured by every run, not typed here: Step 5 (this module
 * and the site verifier against every captured drop) and Step 1 (commitments). LIQD's own production
 * verifier was called once per round by the capture runner; the capture checker's printouts are
 * evidence/E22 to E24.
 *
 * Off the captured data, this module differs from the earlier port on inputs no drop reaches:
 * generateProvablyFairNumber takes the first four digest bytes mod range for every range (the spec
 * defines only range 2, where both agree), where the port rejected chunks at or above
 * floor(2^32 / range) * range and retried at cursor + 1,000,000; and it throws on a non-hex or
 * odd-length server seed, a negative nonce or rows outside 8..16, where the port computed a result.
 * The audit's bias bound for the range-2 draw is src/bias.ts, built on this module's draw.
 */
// LIQD Plinko outcome derivation, clean-room implementation from ALGORITHM.md only.
// Node `crypto` is the only dependency.

import { createHash, createHmac } from "crypto";

const HEX_RE = /^[0-9a-fA-F]+$/;
const TWO_POW_32 = 4294967296;

// Decode the server seed into the HMAC key bytes (ALGORITHM.md §2 Step 1:
// "key = hex_decode(serverSeed)"). Rejects anything that is not an even-length
// hex string, because Buffer.from(…, "hex") would otherwise silently truncate.
function seedKey(serverSeed: string): Buffer {
  if (typeof serverSeed !== "string" || serverSeed.length === 0 || serverSeed.length % 2 !== 0 || !HEX_RE.test(serverSeed)) {
    throw new Error("serverSeed must be a non-empty, even-length hex string");
  }
  return Buffer.from(serverSeed, "hex");
}

function assertNonNegInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

// SHA-256 over raw bytes, returned as lowercase hex.
export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// The published commitment (ALGORITHM.md §1.2): SHA-256 of the seed's ASCII
// text exactly as written, NOT of the bytes the hex decodes to. Note the
// deliberate asymmetry with the HMAC key in §2.
export function commitHash(serverSeedHexString: string): string {
  if (typeof serverSeedHexString !== "string") {
    throw new Error("serverSeed must be a string");
  }
  return sha256Buffer(Buffer.from(serverSeedHexString, "ascii"));
}

// The HMAC message (ALGORITHM.md §2 Step 1): clientSeed ":" nonce ":" cursor,
// with nonce and cursor in plain base-10 (no padding, sign or separators).
// Encoding to bytes is UTF-8 and happens at the HMAC call (§2 Step 1, O5).
export function getProvablyFairHmacSalt(clientSeed: string, nonce: number, cursor: number): string {
  if (typeof clientSeed !== "string") throw new Error("clientSeed must be a string");
  assertNonNegInt("nonce", nonce);
  assertNonNegInt("cursor", cursor);
  return `${clientSeed}:${nonce.toString(10)}:${cursor.toString(10)}`;
}

// One draw for a single cursor (ALGORITHM.md §2 Steps 1-2):
//   digest = HMAC-SHA256(key = hex-decoded server seed, message = salt as UTF-8)
//   u      = first 4 digest bytes as an unsigned 32-bit big-endian integer
//   result = u mod range
// The spec only defines range = 2 (the row bit), which is exactly unbiased on
// the 2^32 domain. Other ranges use the same u mod range rule, with no
// rejection step, since the spec defines none; any range that does not divide
// 2^32 is then slightly biased (see the ambiguity note in the report).
export function generateProvablyFairNumber(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number,
  range: number,
): number {
  if (!Number.isSafeInteger(range) || range < 1 || range > TWO_POW_32) {
    throw new Error("range must be an integer in [1, 2^32]");
  }
  const key = seedKey(serverSeed);
  const message = getProvablyFairHmacSalt(clientSeed, nonce, cursor);
  const digest = createHmac("sha256", key).update(Buffer.from(message, "utf8")).digest();
  const u = digest.readUInt32BE(0); // §2 Step 2: bytes 0..3, big-endian
  return u % range;
}

// One drop (ALGORITHM.md §2 Steps 1-3): one HMAC per row with the cursor
// running 1..rows (cursor base 1, not 0), bit_r = u_r mod 2, path = the bits
// in row order (row 1 first), slot = the count of 1-bits ("count the rights").
export function revealPlinko(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  numberOfRows: number,
): { path: string; winningSlot: number } {
  // §1.1: rows is an integer 8..16.
  if (!Number.isInteger(numberOfRows) || numberOfRows < 8 || numberOfRows > 16) {
    throw new Error("numberOfRows must be an integer in [8, 16]");
  }
  let path = "";
  let winningSlot = 0;
  for (let r = 1; r <= numberOfRows; r++) {
    const bit = generateProvablyFairNumber(serverSeed, clientSeed, nonce, r, 2);
    path += bit === 1 ? "1" : "0";
    winningSlot += bit;
  }
  return { path, winningSlot };
}
