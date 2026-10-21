# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.

```ts
// The commitment the casino publishes for a server seed, lowercase hex (per the spec).
export function commitHash(serverSeedHexString: string): string;
// SHA-256 of a byte buffer, lowercase hex.
export function sha256Buffer(buf: Buffer): string;
// The HMAC message for (clientSeed, nonce, cursor), exactly as the spec builds it.
export function getProvablyFairHmacSalt(clientSeed: string, nonce: number, cursor: number): string;
// One draw in [0, range) for (seeds, nonce, cursor) per the spec's number rule (range 2 gives a row's bit).
// `cursor` is the spec's per-row counter value itself (the caller passes the row's cursor as the spec numbers it).
export function generateProvablyFairNumber(serverSeed: string, clientSeed: string, nonce: number, cursor: number, range: number): number;
// One drop: `path` = the row bits in row order as a string of '0'/'1' (length numberOfRows), and the bucket the spec derives from them.
export function revealPlinko(serverSeed: string, clientSeed: string, nonce: number, numberOfRows: number): { path: string; winningSlot: number };
```
The multiplier table and payout are NOT part of this module; implement only the above.
