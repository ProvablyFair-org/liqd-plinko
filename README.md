# LIQD Plinko — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** `PF-2026-LQ03` · **Release:** `v1.1.0` · **Captures:** 7, 9 and 10 November 2026 on `liqd.com` (production)

**Result: PROVABLY FAIR — Full Pass.** Every one of the 9,750 drops played on `liqd.com` recomputes bit-for-bit from its `(serverSeed, clientSeed, nonce, rows)` inputs; the commit-reveal chain is intact inside each of the three captures, across all 52 seed epochs; every paid multiplier matches the payout tables, on the 27 standard settings and on WTF; and 28,000,000 simulated rounds are consistent with the per-setting RTP and show no structural bias. The verifier reports 21 of 21 scored steps passing, 0 flags and 0 hard fails. Step 21 is informational: it can report a deviation but cannot fail.

**Scope:** Plinko on [LIQD.com](https://liqd.com) (`gameId` `fast-games-5`, served on `/api/v1/originals/plinko/…`), staked in USDT. Every check of LIQD's behaviour rests on production data:

| Phase | Drops | Stake (USDT) | What was played |
|---|---:|---:|---|
| A | 5,050 | 0.10 | the 27 standard settings (rows 8–16 × risk low, medium, high), 185 or 186 drops each, and 50 drops on WTF |
| B | 2,000 | 0.10 | 16 rows, high risk |
| C | 200 | 10.00 | 16 rows, high risk: the Phase B board at a hundred times the stake |
| D | 500 | 0.10 | the 27 standard settings under five player-set client seeds |
| E | 2,000 | 0.10 | WTF mode (risk 4, 13 rows) |

Theoretical RTP is per setting, 98.90625%–99.16016% over the 28 settings, mean 99.0152% (0.985% house edge); WTF is 98.9990%. Bet and profit caps were not tested.

## What was verified

| Check | Captured evidence |
|---|---|
| Commit-reveal | 52/52 revealed seeds hash to their commitment; 52/52 pre-commitments: 49 next-seed transitions inside the three captures plus the pre-capture link of each capture |
| Client seeds | Every epoch was opened with a client seed submitted by the auditor after the epoch's commitment was published, 52 distinct (Step 14). Phase D: 500/500 drops recompute under 5 player-set seeds |
| Drops | 9,750/9,750 paths and slots reproduced from server seed, client seed, nonce and row count. The RNG code, `src/rng.ts`, was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened LIQD's code; LIQD's code is not the source and is not in this package |
| Payouts | 9,750/9,750 multipliers match the payout tables at 1e-9; LIQD's bet replies settle 9,750 of 9,750 rounds at stake × multiplier exactly, in integer 1e-8 units. One drop landed in a 1,000× bucket (16 rows, high risk) and was settled at 100.00 USDT on a 0.10 stake |
| Stake | 200/200 drops at 10.00 USDT on the Phase B board recompute and are settled at stake × the table cell exactly (Step 18) |
| WTF mode | 2,050/2,050 WTF drops recompute and are settled at the WTF table; 4 of them at 235×, the rest at 0, as the table says (Step 15) |
| Payout table | All 365 cells equal what `liqd.com/originals/plinko` displayed (read 20 October 2026, Step 20). 285 of the 365 cells were paid in the captures; the other 80, including both 1,000× WTF buckets, carry 7.59% of summed theoretical RTP and have no payout witness (DL-1) |
| Theoretical RTP | 98.90625%–99.16016% per setting, mean 99.0152%, from independent binomial probabilities. Published-RTP rule (Step 10): 0 of 28 boards more than 0.1 pp below the 99% LIQD's Plinko page shows; worst gap −0.09375 pp |
| Observed return | 81.9387% over the 9,750 drops (2,955.00 USDT staked, 2,421.29 in LIQD's bet replies); informational, not RTP evidence. Two thirds of the stake is the 200 drops of Phase C, on the highest-variance standard board |
| Simulation | 28,000,000 Pass 1 rounds: 0/28 chi² and 0/28 serial fails at Bonferroni. Pass 2 on the 52 production seeds: primary 50-nonce window 1 seed below z = −1.645 against a calibrated expectation of 0.3242 (P(X≥1) = 0.2798) |
| Player verification | The ProvablyFair.org docs-site Plinko verifier, vendored and hash-pinned, reproduces all 9,750 captured bets (Step 5), as a second check beside `src/rng.ts` |
| LIQD's verifier | LIQD's production verifier was called once per round by the capture runner and equals the served round on 9,750 of 9,750, by the capture checker's printouts ([E22](evidence/E22-prod-capture-check-phase-A-2026-11-08.txt), [E23](evidence/E23-prod-capture-check-phases-D-B-AW-E-2026-11-09.txt), [E24](evidence/E24-prod-capture-check-phase-C-2026-11-10.txt)); the raw replies are not in this package, so this row is not scored |

A Full Pass is a statement about what was tested. The declared limitations are in the [overview's limitations](MANIFEST.md#limitations-and-trust); the largest is DL-1, the never-paid table cells. Provenance, the seed-selection position and residual operator trust are set out there.

## Run the audit

Extract this package and open a terminal in its directory. Use **Node.js 22.23.1 or a later 22.x** ([.nvmrc](.nvmrc) 22.23.1, [package.json](package.json) `engines` `>=22.23.1 <23`).

```sh
npm ci
npm test
```

Expected: **58 unit tests pass; 21/21 PASS · PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** `npm test` checks the zero-install bundles against their build manifest, runs the unit tests and the 21 scored steps, replays the committed 28,000,000-round Pass 1 from its saved seeds inside Step 16, then runs `check-outputs` and `release-manifest --check`. It does not draw a new simulation.

```sh
npm run test:full                 # optional: also regenerates the simulation from its saved seeds and diffs it
node scripts/release-manifest.mjs --check
node scripts/spec-check.mjs       # optional: the specification, written out a second time, on every drop
```

See [reproduction details](MANIFEST.md#reproduce-the-audit) for the exit codes, comparison tolerances, the mutation battery and the deliberate artifact-refresh procedure.

## Verify a bet

The quickest way is the ProvablyFair.org verifier at [provablyfair.org/verify-bets/liqd](https://www.provablyfair.org/verify-bets/liqd): its Plinko verifier takes the revealed server seed, your client seed, the nonce, the rows and the risk level, and returns the path, the slot and the multiplier. It is the same verifier this package runs on every captured bet (Step 5).

To do it by hand: save the commitment (`hashedServerSeed`) before betting. After rotation reveals the server seed, check that the SHA-256 of the seed's hex string equals it, then derive one bit per row from `HMAC-SHA256(hex_decode(serverSeed), "clientSeed:nonce:cursor")` for cursor 1 … rows. The landing slot is the count of 1-bits, and the payout is that slot's multiplier in the table for your rows and risk level. The [complete verification instructions](MANIFEST.md#verify-a-bet) give the byte-level steps and a worked production bet; [docs/ALGORITHM.md](docs/ALGORITHM.md) is the written specification they follow. The bundled [plinkoConfig.json](plinkoConfig.json) holds the audited tables.

## Files and evidence

[MANIFEST.md — consolidated audit overview](MANIFEST.md) is the source document: game rules, algorithm, RTP calculation, verification results, evidence register, limitations and release history. [evidence.md](evidence.md) (the evidence register), [exploit-testing.md](exploit-testing.md) (the S5 fairness-integrity matrix and the mutation battery) and [SUMMARY.md](SUMMARY.md) (table of contents) are extracts of it, written by `scripts/build-docs.mjs`; `npm test` fails if an extract and its source disagree. The RNG's written specification, [docs/ALGORITHM.md](docs/ALGORITHM.md), is the source `src/rng.ts` was rebuilt from.

- [Captured production bets](data/plinko-prod-9750bets.json) — SHA-256 `83965cdc5381db3ad99bf7c1c1e1d2e0d90f574132f96642027599c0edea8a16`.
- [Payout tables](plinkoConfig.json) — SHA-256 `09bfaeab2b7885ef63d72cebcfe1a667cb8ec604c887cebcdea22e56c2960f0a`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json), [payout-table coverage](outputs/coverage-results.json) and [release manifest](RELEASE-MANIFEST.json).
- [Production page read](evidence/liqd-plinko-page-reads-2026-10-20.json): the multipliers `liqd.com/originals/plinko` displays, saved 20 October 2026.
- [Audit report](https://audit.provablyfair.org/casino/liqd/games/plinko/overview) · [Public repository](https://github.com/ProvablyFair-org/liqd-plinko) · [MIT license](LICENSE).

Releases are signed, commit and tag, with the ProvablyFair.org release key (SSH, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), which the release manifest records. Earlier releases are recorded in the [release history](MANIFEST.md#release-history).
