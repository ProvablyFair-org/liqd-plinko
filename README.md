# LIQD Plinko — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** `PF-2026-LQ03` · **Release:** `v1.0.0` (the first public release) · **Capture:** 7 July 2026 on `qa.liqd.com` (pre-production)

**Result: PROVABLY FAIR — Full Pass** *(provisional — pre-launch capture)*. Every one of the 10,100 captured drops recomputes bit-for-bit from its `(serverSeed, clientSeed, nonce, rows)` inputs; the commit-reveal chain is intact across all 202 seed epochs; the payout tables (standard risk 1–3 and WTF) match every paid multiplier; and 28,000,000 simulated rounds are consistent with the per-config RTP and show no structural bias. The verifier reports 21 of 21 scored steps passing, 0 flags and 0 hard fails. Step 21 is informational: it can report a deviation but cannot fail.

**Scope:** Plinko on [LIQD.com](https://liqd.com) (`gameId` `fast-games-5`), in USDC: the 27 standard configurations (rows 8–16 × risk low, medium, high) plus WTF mode (risk 4, rows fixed at 13). All evidence is from LIQD's pre-production environment (`qa.liqd.com`); production parity will be confirmed by an anonymous post-launch capture, and the certification page reflects provisional status until then. Theoretical RTP is per configuration, 98.9063%–99.1602%, mean 99.0152% (0.985% house edge), where the $250,000 maximum-profit setting does not bind: a 1000× win's profit (999 × stake) exceeds it above a stake of $250,000 / 999, and how the cap is applied was not tested.

## What was verified

| Check | Captured evidence |
|---|---|
| Commit-reveal | 202/202 revealed seeds hash to their commitment; 201/201 next-seed transitions, 202/202 pre-commitments including the pre-capture link |
| Drops | 10,100/10,100 paths and slots reproduced from server seed, client seed, nonce and row count. The RNG code, `src/rng.ts`, was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened LIQD's code; LIQD's code is not the source and is not in this package |
| Payouts | 10,100/10,100 multipliers match the payout tables (incl. WTF) at 1e-9; 10,100/10,100 payouts equal stake × multiplier exactly, in integer 1e-8 units |
| Table coverage | 285 of 365 payout cells were paid in the capture; the other 80, including both WTF 1000× tails, carry 7.41% of summed theoretical RTP (DL-1) |
| Theoretical RTP | 98.9063%–99.1602% per configuration, mean 99.0152%, from independent binomial probabilities. Published-RTP rule (Step 10): 0 of 28 boards more than 0.1 pp below the 99% LIQD's Plinko page shows; worst gap −0.09375 pp |
| Observed return | 80.6843% over the 10,100 drops; informational, not RTP evidence |
| Simulation | 28,000,000 Pass 1 rounds: 0/28 chi² and 0/28 serial fails at Bonferroni. Pass 2 cherry-pick probe passes in three tiers: substitution blocked for 192/202 epochs, epoch 152 unresolved, epochs 153–161 statistical only |
| Player verification | The ProvablyFair.org docs-site Plinko verifier, vendored and hash-pinned, reproduces all 10,100 captured bets (Step 5), as a second check beside `src/rng.ts` |

A Full Pass is a statement about what was tested. Thirteen limitations are declared; the largest is DL-1, the 80 never-paid table cells, which rest on our hash-pinned transcription of the operator's client bundle. No claim in this package rules out cherry-picking across the capture as a whole. Provenance, production parity (provisional until the post-launch capture), the seed-selection tiers and residual operator trust are set out in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Extract this package and open a terminal in its directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **57 unit tests pass; 21/21 PASS · PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** `npm test` checks the zero-install bundles against their build manifest, runs the unit tests and the 21 scored steps, replays the committed 28,000,000-round Pass 1 from its saved seeds inside Step 16, then runs `check-outputs` and `release-manifest --check`. It does not draw a new simulation.

```sh
npm run test:full                 # optional: also regenerates the simulation from its saved seeds and diffs it
node scripts/release-manifest.mjs --check
```

The optional full run took 19 min 34 s on Node 22.23.1 on 24 September 2026. Ordinary runs write only to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the exit codes, comparison tolerances, the mutation battery and the deliberate artifact-refresh procedure.

## Verify a bet

Save the commitment (`hashedServerSeed`) before betting. After rotation reveals the server seed, check that the SHA-256 of the seed's hex string equals it, then derive one bit per row from `HMAC-SHA256(hex_decode(serverSeed), "clientSeed:nonce:cursor")` for cursor 1 … rows. The landing slot is the count of 1-bits, and the payout is that slot's multiplier in the table for your rows and risk level. The [complete verification instructions](MANIFEST.md#verify-a-bet) give the byte-level steps and a worked captured bet; [docs/ALGORITHM.md](docs/ALGORITHM.md) is the written specification they follow. The bundled [plinkoConfig.json](plinkoConfig.json) holds the tables transcribed for this audit.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The RNG's written specification, [docs/ALGORITHM.md](docs/ALGORITHM.md), is the source `src/rng.ts` was rebuilt from. The overview contains the game rules, algorithm, RTP calculation, verification results, evidence register, limitations and release history.

- [Captured bets](data/plinko-master-10100bets.json) — SHA-256 `871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95`.
- [Payout tables](plinkoConfig.json) — SHA-256 `f8eaf67e1ffc63ee0dc21123447581c55f443c167dcb451b45ab7cd108fe712f`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json), [payout-table coverage](outputs/coverage-results.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/liqd/games/plinko/overview) · [Public repository](https://github.com/ProvablyFair-org/liqd-plinko) · [MIT license](LICENSE).

The release commit and tag are signed with the ProvablyFair.org release key (SSH, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), which the release manifest records; publication date 21 October 2026. The documentation consolidation is recorded in the [release history](MANIFEST.md#release-history).
