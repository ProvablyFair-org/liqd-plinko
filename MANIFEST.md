# LIQD Plinko — Consolidated Audit Overview

**Audit ID:** `PF-2026-LQ03` · **Auditor:** ProvablyFair.org · **Release:** `v1.1.0` · **Framework:** 1.1

Plinko (`gameId` `fast-games-5`) on LIQD.com, captured on the production site `liqd.com` in the auditor's logged-in browser session, staked in USDT. The 9,750 rounds were played in three runs: **7 November 2026, 16:29–18:20 UTC** (5,000 rounds), **9 November 2026, 20:51–22:31 UTC** (4,550 rounds) and **10 November 2026, 11:56–12:00 UTC** (200 rounds); after each run LIQD's own verifier was called once per round. Report: `https://audit.provablyfair.org/casino/liqd/games/plinko/overview`. The machine-readable release identity (audit ID status, release, artifact hashes, verdict and scored counts) is [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass (21/21 scored steps, 0 flags, 0 hard fails).** Every one of the 9,750 production drops recomputes bit-for-bit from its `(serverSeed, clientSeed, nonce, rows)` inputs; the commit-reveal chain is intact inside each of the three captures, across all 52 seed epochs; every paid multiplier matches the hash-pinned payout tables; and the per-setting theoretical RTP sits within 1 pp of the 99% baseline (per-setting edge 0.84%–1.09%), consistent with a 28,000,000-round simulation that shows no structural bias. Step 21 is informational: it can report a deviation as INFO but cannot fail, so it cannot change the verdict.

**What is certified.** What production offers and what was captured there: the 27 standard settings (rows 8–16 × risk low, medium, high) and WTF mode (risk 4, 13 rows), at 0.10 USDT, plus 200 drops at 10.00 USDT on one board. Every phase of the capture plan was played on `liqd.com`:

| Phase | Drops | Epochs | Stake (USDT) | Played | Purpose |
|---|---:|---|---:|---|---|
| A | 5,050 | 25 of 200, 1 of 50 | 0.10 | The 27 standard settings in turn, 185 or 186 drops each (5,000, 7 Nov), and 50 drops on WTF (9 Nov) | Every setting sampled |
| B | 2,000 | 10 of 200 | 0.10 | 16 rows, high risk (9 Nov) | Deep sample of the highest-variance standard board |
| C | 200 | 1 of 200 | 10.00 | 16 rows, high risk (10 Nov) | Bet-size invariance: the Phase B board at a second stake |
| D | 500 | 5 of 100 | 0.10 | The 27 standard settings in turn under five player-set client seeds (9 Nov) | Client-seed control |
| E | 2,000 | 10 of 200 | 0.10 | WTF mode (9 Nov) | The declared extra mode at full coverage |

**RTP is per setting, not flat.** LIQD's live Plinko page shows "Edge: 1.00%" and "99% on every board" (read 2026-10-01, `evidence/rtp-page-labels-2026-10-01.json`). Analytical RTP built from independent binomial probabilities ranges 98.90625%–99.16016% over the 28 settings (mean 99.0152%; WTF 98.9990%). The label is never used as evidence. The published-RTP rule (Step 10) holds every board to the 99% LIQD's page shows: 0 of 28 boards are more than 0.1 pp below it. Live-bet RTP (81.9387% across the 9,750 drops) is informational only.

**Seed substitution is blocked on every epoch, conditionally.** Each of the 52 epochs was opened by a rotation that submitted a client seed generated in the auditor's browser, after the epoch's server-seed commitment had been published as the previous state's next-seed hash (Steps 2 and 14). That is structural, conditional on authentic commitment timing (DL-3). The client seeds' unpredictability to the operator rests on a generator this package does not ship (DL-5). Pass 2, the statistical cross-check, is a synthetic fixed-board probe (DL-12). **Nothing here rules out cherry-picking across the capture as a whole.**

**What this audit does not establish.** The declared limitations are in the [register](#declared-limitations-register), each with its measured magnitude and why it cannot be closed from the settled data. The six that matter most to a reader:

1. **80 of the 365 payout-table cells were never paid** in the captures, both 1,000× WTF buckets among them. Every one of the 365 cells equals what `liqd.com/originals/plinko` displayed on 20 October 2026 (Step 20), but a display is not a payment: those 80 cells have no payout witness. They carry **7.59%** of summed theoretical RTP — up to **26.98%** on the 11-row high-risk board and **24.66%** on WTF. *(DL-1)*
2. **The report cannot prove where the data came from.** The hash pin shows the dataset has not changed since we pinned it and the population constants show it is the population we audited, but no offline verifier can establish that LIQD served these 9,750 rounds. That rests on capture discipline. *(DL-3)*
3. **The client seeds came from a runner this package does not ship.** Their unpredictability at commitment is consistent with the recorded shapes but is not demonstrated here. *(DL-5)*
4. **Pass 2 is a synthetic fixed-board probe, and its count statistic is weak at the scored window.** Each epoch is scored on one board — the board of its lowest-nonce bet — over its first 50 nonces. On 30 of the 52 epochs that board is one where no 50-drop window can fall below the threshold at all, so the count has no power there and the paired early−late statistic carries the test. *(DL-12)*
5. **The three captures are three separate runs.** The seed chain is verified inside each run and each run is anchored by its own pre-capture record; no link is asserted from one run to the next, because the account played other games in between. *(DL-13)*
6. **No account balance was read:** payouts are the amounts in LIQD's bet replies, not observed balance changes. *(DL-8)*

**In scope:** the Plinko RNG (HMAC-SHA256 draw, one bit per row from the first four digest bytes mod 2, `winningSlot` = count of `1` bits); the commit-reveal protocol (commitment, client seed, nonce, next-seed pre-commitment chain, rotation and reveal); the 28 multiplier tables (rows 8–16 × risk 1–3, and WTF); payout integrity at two stakes; RTP (analytical per-setting derivation plus Monte Carlo); and eight integrity-check categories, seven tested and the seed-rotation race not tested in this package. This page covers the package's offline checks; live-API integrity testing is in Section 5 of the report.

**Out of scope:** platform security (authentication, authorization, infrastructure); account systems, deposits, withdrawal processing, KYC; responsible gambling features; other games on the platform; the server-side RNG entropy source (unauditable without server access, mitigated by the commitment); promotional, bonus, loyalty and account-system behaviour; stakes other than 0.10 and 10.00 USDT and currencies other than USDT; bet and profit caps; and "Rapid Fire", an auto-bet speed feature that reuses the ordinary risk-level tables.

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

The dataset records three logged-in runs on `liqd.com`, LIQD's production site, on one account. It holds **9,750 drops** in **52 revealed seed epochs**; all 52 server seeds were revealed, so 100% of the dataset is verifiable. The runner rotated the seed pair on its own plan — every 200 drops (46 epochs), every 100 (the 5 Phase D epochs) or after 50 (the WTF epoch of Phase A) — and nothing in the captured records shows LIQD limiting a seed pair to any of those lengths. **2,955.00 USDT** was staked and **2,421.29 USDT** paid.

| Capture | Rounds (UTC) | Plan entries | Drops | Epochs | Staked / paid (USDT) | Source file (SHA-256) |
|---|---|---|---:|---:|---|---|
| 1 | 7 Nov 2026, 16:29:12–18:20:10 | A | 5,000 | 25 | 500.00 / 482.19 | `liqd-plinko-prod-capture-2026-11-08T16-56-54-731Z.ndjson` (`957c827a8110d5a34d5dbf2f47a40a4f55de6e4351c5e0fbf174a783fe07d4ba`) |
| 2 | 9 Nov 2026, 20:51:05–22:31:25 | D, B, A+W, E | 4,550 | 26 | 455.00 / 453.10 | `liqd-plinko-prod-capture-2026-11-09T23-47-31-606Z.ndjson` (`aede849a1eda06b59df1acbbada1e7d13e0e08094e7ec99d097c0684c8385eb5`) |
| 3 | 10 Nov 2026, 11:56:10–12:00:26 | C | 200 | 1 | 2,000.00 / 1,486.00 | `liqd-plinko-prod-capture-2026-11-10T12-03-39-147Z.ndjson` (`af21865db5d5f75b84e350ce0a9c88a87584d57add9fab764f2ed41958836890`) |

The per-capture money figures are the checker's (E22–E24); the totals are emitted by the verifier (`info.Live RTP` in `outputs/verification-stats.json`). The source file names carry the export time, not the play time. Plan entry `A+W` is Phase A's 50 drops on the WTF board, played so that the 28th setting also meets the Phase A floor of 50 drops per setting.

**Audited population as code constants.** `EXPECTED_BETS = 9750`, `EXPECTED_SEEDS = 52`, `EXPECTED_PHASE_BETS = { A: 5050, B: 2000, C: 200, D: 500, E: 2000 }`, `EXPECTED_CAPTURE_EPOCHS = [25, 26, 1]` and the plan table `EXPECTED_PLAN` (per plan entry: capture, drops, epochs, epoch length, stake) live in `src/loader.ts`. Steps 2, 4, 11, 12, 14, 15 and 18 compare the loaded data against these and reconcile the dataset's own header against them — `meta.plannedTotal` and `meta.phases` are evidence to be checked, never the expectation. A capture shrunk with its header doctored to agree, and its SHA-256 re-pinned, is a **hard fail**, not a flag: the pin proves the file has not changed since we pinned it, not that it is the capture (G-BIND — a row count is not an identity).

| Input | Identity |
|---|---|
| [data/plinko-prod-9750bets.json](data/plinko-prod-9750bets.json) — scored | SHA-256 `83965cdc5381db3ad99bf7c1c1e1d2e0d90f574132f96642027599c0edea8a16` |
| [plinkoConfig.json](plinkoConfig.json) | SHA-256 `09bfaeab2b7885ef63d72cebcfe1a667cb8ec604c887cebcdea22e56c2960f0a` |

These pins establish byte integrity relative to the values in the source; they do not authenticate the origin of the records. `loadDataset()` and `loadPlinkoConfig()` re-hash the dataset and the config at startup and abort on any single-byte change.

**How the dataset was made.** An in-page runner (`plinko-prod-capture-runner`, build `ec583e46adcf` for capture 1 and build `5646c06628df` for captures 2 and 3, kept in the auditor's private workshop, not in this package) played the plan in the auditor's logged-in `liqd.com` tab and exported every request and reply as NDJSON. A converter in the same workshop mapped the three exports, field by field, into one `{ meta, seeds, bets }` file: epochs are numbered 0–51 in the order played, every bet carries its capture, its phase letter and its plan entry, `meta.captures` records each source file with its SHA-256 and its own pre-capture record, and `meta.conversion` states the origin of every field. The workshop's offline checker over each raw capture reported ALL CHECKS PASS, including LIQD's own verifier (`POST /api/v1/originals/plinko/verify`) agreeing with the served round on 5,000/5,000, 4,550/4,550 and 200/200; its three printouts are in this package (E22–E24), re-run on 10 November 2026 and byte-identical to the stored ones. The raw captures and the checker are not in this package, so those statements are not reproducible from it and are not scored. The printouts name the table file by the hash it had when the checker ran (`f8eaf67e…`); its 365 cells are the cells of the file released here, whose descriptive strings alone differ (see the [release history](#release-history)).

**How the audit was built.** The RNG, `src/rng.ts` (`commitHash`, `generateProvablyFairNumber`, `revealPlinko`; Node.js `crypto` only, no LIQD dependency), was rebuilt on 20 October 2026 from a written specification by an implementer who never opened LIQD's code. [docs/ALGORITHM.md](docs/ALGORITHM.md) is that specification in its production revision: the construction is unchanged, and every line it marks DATA was measured again on the 9,750 production drops by `scripts/spec-check.mjs`, a second write-out of the specification that imports nothing from `src/`. The ProvablyFair.org site verifier is run as a third implementation (Step 5). The multiplier tables are pinned in `plinkoConfig.json`. Each of its 365 cells is held to what the production game page displays — the bucket labels and page statements of `liqd.com/originals/plinko`, read logged out on 20 October 2026 and saved as E21 (Step 20) — and every multiplier paid in the captures equals its cell (Step 7). The tables are the auditor's record of the page, not operator-supplied server source.

**Client seeds.** 47 epochs, and the three pre-capture records, use `audit` followed by 12 lowercase hex characters (e.g. `auditf011676cf201`). The five Phase D epochs use player-set seeds of the form `pfaudit-prod-plinko-d<k>-` followed by 12 lowercase hex characters, k = 1…5 (e.g. `pfaudit-prod-plinko-d3-b43f85abca8a`). All 52 are distinct and none equals the seed in force before its capture. The runner's own record names the generator as 6 bytes of `crypto.getRandomValues` (browser CSPRNG) for both forms, and says the five Phase D seeds were drawn when the plan was built and sent at the rotation opening each Phase D epoch; the runner does not ship with this package (DL-5).

### Reading a bet

The dataset has the structure `{ meta, seeds, bets }`. Join a bet's `hashedServerSeed` to the matching entry in `seeds` to obtain the revealed `serverSeed`. The verification-relevant subset is fixed in `src/types.ts` (`Bet`).

| Fields | Interpretation |
|---|---|
| `id`, `nonce`, `clientSeed`, `hashedServerSeed`, `serverSeedId` | Bet identifier (e.g. `4PmgyUj9xOP9CXphd0Wi0`) and RNG inputs, as served by `place-bet`; `serverSeedId` is an opaque id linking the bet to its epoch. |
| `gameId`, `numberOfRows`, `riskLevel` | The served `round.gameId` (`fast-games-5`) and the served board: rows 8–16; risks 1–3 are low, medium, high; risk 4 is WTF, always 13 rows. |
| `dropDetails`, `winningSlot` | Per-row bit string (`'0'` = left, `'1'` = right, e.g. `10010101`) and landing slot 0…rows, equal to the count of `1` bits (served `outcome.drops`, `outcome.ones`). |
| `multiplier`, `betAmount`, `winningAmount`, `result` | Served `outcome.multiplier`, stake and paid win, and the `won` / `lost` label. Amounts are the served strings, unchanged: 8 decimals, except that a WTF drop that pays nothing is served `"0"`. |
| `at`, `capture`, `epoch`, `phase`, `phaseId` | The runner's record of the round (`epoch` renumbered across the captures by the converter), consumed by verification and constrained by population, nonce and seed-join checks (premise P6). |
| `localPath`, `localSlot`, `verified`, `seeds[].commitVerified`, `seeds[].chainLinkOk` | Converter self-check fields. No scored step reads them; the checks recompute these properties independently. |

The dataset's `won` label means `multiplier ≥ 1`: the 699 drops that push at exactly 1.0× are labelled `won` ([docs/ALGORITHM.md](docs/ALGORITHM.md) §3.2 and §7). Payout verification uses the amount fields directly, and the informational lag-1 autocorrelation binarises on strict profit, not on `result`.

## Game and algorithm

A Plinko board has a selectable number of rows. On an `N`-row board the ball makes `N` independent left/right bounces, each a single bit, and lands in one of `N + 1` slots indexed `0 … N`: the landing slot is the **count of right-bounces**. Edge slots pay the most and are the hardest to reach. The bounce sequence is derived cryptographically from the client seed, the server seed and the bet nonce, so it can be reproduced after the fact.

### Configurations and payout tables

**Standard mode:** rows 8–16 × risk levels {1 = LOW, 2 = MEDIUM, 3 = HIGH} = **27 settings**, every one played on production. Risk controls the multiplier spread only, not the physics. In `plinkoConfig.json` the tables are `payout_tables[String(rows)][riskLevel − 1][slot]` (`rows: {min: 8, max: 16}`). The 8-row tables:

| Risk | Slot 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 1 (LOW) | 5.6 | 2.1 | 1.1 | 1 | 0.5 | 1 | 1.1 | 2.1 | 5.6 |
| 2 (MEDIUM) | 13 | 3 | 1.3 | 0.7 | 0.4 | 0.7 | 1.3 | 3 | 13 |
| 3 (HIGH) | 29 | 4 | 1.5 | 0.3 | 0.2 | 0.3 | 1.5 | 4 | 29 |

**WTF mode:** a fourth risk level (`riskLevel` 4) with the row count fixed at 13, also played on production. Its table (`wtf_mode.odds`) is `[1000, 235, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 235, 1000]`: the two outer buckets pay 1,000×, the next two 235× and the ten middle buckets pay nothing. The same RNG draws the path; only the table differs. The probability that a WTF drop pays nothing is 99.6582%.

All 28 tables are left/right symmetric, `table[k] == table[rows−k]`, mirroring `C(rows, k) = C(rows, rows−k)` (Step 19). **Rapid Fire is not a payout mode:** it fires drops in quick succession using the ordinary risk-level tables.

### API and seed lifecycle

Production calls target `https://liqd.com/api/v1`, sent by the logged-in page itself with the browser session; the runner reads no cookie, storage or token.

| Endpoint | Role |
|---|---|
| `GET /fast-games/provably-fair/active` | Active pair: `activeServerSeedHash` (commitment, published before any bet), `nextServerSeedHash` (pre-commitment for the next seed), `clientSeed`, `nonce`. Read before the first bet of each capture (`meta.captures[i].preCapture`). |
| `POST /fast-games/provably-fair/rotate` | Body `{ "clientSeed": "<new client seed>" }`. Reply: `revealedServerSeed` (plaintext of the retiring seed), `activeServerSeedHash`, `nextServerSeedHash`, the echoed `clientSeed`, `nonce: 0`. One rotation before the first bet of each capture and one closing each of the 52 epochs. |
| `POST /originals/plinko/place-bet` | Body `{ "idempotencyKey", "stake": "0.10000000", "currencyId": 3, "stakeCurrency": "USDT", "params": { "numberOfRows", "riskLevel" } }` (`"10.00000000"` in Phase C). Reply: the round (`betId`, `gameId`), `provablyFair` (`serverSeedHash`, `clientSeed`, `nonce`), `outcome` (`drops`, `ones`, `multiplier`), stake and winning amount. 9,750 calls. |
| `POST /originals/plinko/verify` | LIQD's verifier: body `{ serverSeed, clientSeed, nonce, params }`. Called once per round after its seed was revealed; the replies are in the raw captures, not in this package. |

The two `provably-fair` paths are the ones the runner's source uses; the raw captures record the rotation replies but not their request URLs. The `place-bet` and `verify` paths are recorded in the captures themselves.

**Lifecycle.** (1) Before any bet of a capture, the runner reads the active pair and rotates, which reveals the seed in force (the pre-capture record) and opens the capture's first epoch with a fresh client seed. (2) The epoch's bets are placed; each reply carries `nonce` 0, 1, 2 … and the epoch's constant `serverSeedHash` and `clientSeed`. (3) After the epoch's last bet the runner rotates with a fresh client seed, which reveals the retiring server seed and makes the pre-committed next seed active. Rotation N, submitting client seed N, returns the commitment for N+1.

**Pre-capture links.** `meta.captures[i].preCapture` records, for each capture, the commitment in force before its first bet, its plaintext reveal and its `nextHashedServerSeed`. `SHA-256(utf8(preCapture.revealedServerSeed)) == preCapture.hashedServerSeed`, and `preCapture.nextHashedServerSeed` equals the `hashedServerSeed` of the capture's first epoch, on all three. This is the evidence that each capture's first server seed was committed before its client seed was sent, which the epoch-to-epoch chain alone does not show; Step 2 scores the three links with the 49 transitions as 52 pre-commitments. Equality is computationally verifiable; the real-world ordering of capture events relies on the collection records. No link is asserted from the last epoch of one capture to the first of the next (DL-13).

### Commitment and bit derivation

```text
commit    = SHA-256( ascii( serverSeed_hex_string ) )         // the 32 characters as written
key       = hex_decode(serverSeed)                            // 16 raw bytes
path      = ''
for cursor in 1..numberOfRows:
    digest  = HMAC_SHA256(key, `${clientSeed}:${nonce}:${cursor}`)
    u       = digest[0..3] as an unsigned 32-bit big-endian integer
    bit     = u mod 2
    path   += String(bit)

winningSlot = count of '1' in path            // range [0, numberOfRows]
multiplier  = table[rows][riskLevel][winningSlot]
```

This is the algorithm as [docs/ALGORITHM.md](docs/ALGORITHM.md) §1.2–§3 writes it; `src/rng.ts` implements it.

- **Commitment** hashes the 32-character hex *string* (its ASCII bytes), not the 16 decoded bytes, confirmed against all 52 revealed production seeds and the three pre-capture seeds.
- **Key encoding** is the 16 decoded bytes, deliberately distinct from the commitment.
- **Message** is `clientSeed`, `nonce` and `cursor` joined by literal colons, in plain base 10 with no padding; the four bytes are read big-endian.
- **Cursor is per row:** `cursor` runs `1 … rows`, one fresh HMAC per row, one bit per HMAC. Row count sets only the loop length and risk only selects the table; neither seeds the bit stream, and stake is not an input.
- **No rejection step.** The bit is `u mod 2` over the whole 2^32 domain; 2 divides 2^32, so each bit value has exactly 2^31 preimages and the draw is exactly unbiased. Step 5 checks this on the module itself (`src/bias.ts`).
- **No external entropy.** No drand beacon, block hash or VRF participates; `revealPlinko` reproduces all 9,750 production paths and slots from `(serverSeed, clientSeed, nonce, rows)` alone.

**LIQD's byte-level algorithm.** On 20 October 2026 `liqd.com/provably-fair` named HMAC-SHA256, the three inputs and "count the rights", but not the key form, message format, cursor base or bit rule ([docs/ALGORITHM.md](docs/ALGORITHM.md) §6, O1); those rest on the standard construction and the captured drops. Publishing the byte-level spec is the top operator recommendation (P1).

**Trust boundary.** The active server seed and the RNG execution are server-held until reveal. Before a bet the player can observe the commitment, the next-seed pre-commitment, the editable client seed and the nonce. After reveal the player can verify `SHA-256(utf8(revealedServerSeed))` against the committed hash (Step 1), recompute path and slot (Step 5) and check the multiplier against the table (Step 7). Because the server published the commitment before any bet under the pair, it cannot swap in a different server seed afterwards without breaking it.

## Payouts and RTP

### Settlement and table conformance

For landing slot `s`, the paid multiplier is a direct table lookup and `winningAmount = betAmount × multiplier`. Step 7 confirms `multiplier == payoutTable[winningSlot]` at 1e-9 using the recorded `winningSlot`, which Step 5 independently binds to the seed-derived slot; Step 8 confirms `winningAmount == betAmount × multiplier` exactly, in integer 1e-8 settlement units, with finite operands required. Together they bind the payout in LIQD's bet replies to the seed-derived outcome: 9,750/9,750 multipliers match, 0 mismatches; 9,750/9,750 amounts reconcile, 0 off the grid, 0 errors, at both stakes. No undisclosed deduction, rake or rounding leakage is present. The production bet reply carries no running wallet-balance field, so the payout cannot be cross-confirmed against a balance delta (DL-8).

| Bet ID | Phase | Epoch / nonce | Rows / risk | Path | Slot | Multiplier | Stake | Paid |
|---|---|---|---|---|---:|---:|---:|---:|
| `4PmgyUj9xOP9CXphd0Wi0` | A | 0 / 0 | 8 / 1 | `10010101` | 4 | 0.5 | 0.10000000 | 0.05000000 |
| `25W86HCn4PrfZmufod6Gb` | B | 35 / 122 | 16 / 3 | `0000000000000000` | 0 | 1000 | 0.10000000 | 100.00000000 |
| `DPxB7CeG9KawitDYBSLLK` | C | 51 / 9 | 16 / 3 | `1001111111111111` | 14 | 26 | 10.00000000 | 260.00000000 |
| `Bf7iSHzTp0Kok4POS5gY8` | D | 27 / 15 | 16 / 3 | `1110111111011111` | 14 | 26 | 0.10000000 | 2.60000000 |
| `cDX_oAX6QiJ3afe1imueh` | E | 41 / 34 | 13 / WTF | `1011111111111` | 12 | 235 | 0.10000000 | 23.50000000 |

These five are the vectors V1–V5 of [docs/ALGORITHM.md](docs/ALGORITHM.md) §5. `25W86HCn4PrfZmufod6Gb` landed sixteen lefts in a row on the 16-row high-risk board: the 1,000× bucket, the largest multiplier in the game, paid on production. `DPxB7CeG9KawitDYBSLLK` is the largest amount paid in the captures.

**Table coverage.** Multipliers are stored at the platform's native precision, one or two decimals. Because the tables are exact rationals, the theoretical RTP built from them is deterministic, and the 0.254 pp spread across boards (98.90625% to 99.16016%) is a property of the published values, not measurement noise. The captures exercised **285 of 365** table cells (78.1%). The 80 never-paid cells carry **7.59%** of summed theoretical RTP, and **26.9844%** (11r/3), **24.6609%** (WTF) and **18.2575%** (13r/3) of those boards' RTP (DL-1, emitted per setting in `outputs/coverage-results.json`). On the 16-row high-risk board, which Phases B and C sample deeply, 15 of the 17 buckets were paid, the 1,000× bucket at slot 0 among them; slots 1 and 16 were not reached. On WTF, slots 1 to 12 were reached and four drops paid (235×, two in slot 1 and two in slot 12); the two 1,000× buckets (probability 2⁻¹³ each) were not reached in the 2,050 WTF drops. The simulation exercises every cell as pinned, not the operator's live table, so it cannot confirm the never-paid cells.

### Theoretical RTP

Each row is an independent Bernoulli(0.5) trial, so slot `k` on an `n`-row board has the exact binomial probability, computed from first principles in `src/config.ts` (`binomP`, `theoreticalRTP`) and never taken from any LIQD-supplied table:

```text
P(slot = k)  = C(n, k) / 2^n
RTP(n, risk) = Σ_k C(n, k) × payout[k] / 2^n
house edge   = 1 − RTP
```

The binomial masses sum to 1.0 exactly for every row count (`steps.step13.maxAbsSumMinusOne` in `outputs/verification-stats.json`). Example: the 8-row low-risk table `[5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6]` with binomial weights `[1, 8, 28, 56, 70, 56, 28, 8, 1]` gives a weighted payout sum of 253.4, and 253.4 / 256 = 0.98984375, or 98.984375% RTP.

| Rows | Low RTP | Medium RTP | High RTP |
|---:|---:|---:|---:|
| 8 | 98.984375% | 98.906250% | 99.062500% |
| 9 | 98.984375% | 99.140625% | 99.062500% |
| 10 | 99.003906% | 98.906250% | 99.062500% |
| 11 | 99.003906% | 99.023438% | 99.160156% |
| 12 | 98.979492% | 98.989258% | 99.116211% |
| 13 | 98.999023% | 98.994141% | 99.086914% |
| 14 | 99.000244% | 98.994141% | 98.978271% |
| 15 | 99.000854% | 98.998413% | 99.026489% |
| 16 | 98.998718% | 98.988342% | 98.976440% |

WTF (13 rows): 98.999023% (4055/4096).

| Statistic | Value | Setting |
|---|---|---|
| Minimum RTP | 98.90625% | rows 8 risk 2 and rows 10 risk 2 (tie, exactly 98.90625%) |
| Maximum RTP | 99.16016% (99.16015625%) | rows 11, risk 3 |
| Equal-weighted mean RTP | 99.0152% (99.0152413504464%) | all 28 |
| House-edge range | 0.83984375%–1.09375% | — |
| Max deviation from 99% | 0.1602% | rows 11, risk 3 |

The minimum and maximum rows are taken from the Step 10 argmin/argmax lists in the verification record, not hand-derived. These are setting averages, not a forecast for an unspecified betting mix. Every setting sits within 1 pp of the 99% baseline; the spread exists because one- and two-decimal multipliers cannot hit 99.0000% exactly at every row count.

**Model anchors.**

| Modelled figure | Anchor method | Tolerance | Enforcing test |
|---|---|---|---|
| Per-setting RTP range and mean | Exhaustive enumeration of all `2^rows` equally likely paths (popcount → slot, pure counting) cross-checking the binomial RTP (`steps.step10.enumerationWorstDelta`), a hard FAIL above tolerance | 1e-12 | `tests/steps/payouts.ts` (Step 10) |
| Published min / max / mean and WTF figures | Full-precision pins on exact rationals; the mean pin equals the simulation artifact's `meanTheoreticalRTP` | 1e-12 | `tests/plinko/rtpPinTests.ts` |
| Calibrated null for the Pass 2 payout-weighted count — primary 50-nonce window and extended 5,000-nonce window | Exact lattice convolution of the per-drop payout distribution at each window length, anchored by brute-force enumeration of every payout sequence at small windows, by a closed-form multinomial sum on WTF and by simulated windows | exact (brute force); 5·SE against simulated windows | `tests/plinko/calibrationTests.ts`, `tests/steps/simulation.ts` (Step 17) |
| Slot probabilities against the binomial model | A literal Pascal recurrence over the board, so a binomial-coefficient error is inexpressible in it | Exact integers | `tests/steps/anti-circularity.ts` (Step 13) |

**Declared anchor residuals.** The oracle and the engine share one reading of the rules — fixed row count, independent left/right steps, popcount to slot, lookup by slot — so a misreading of the rules would move both together. Both also read the same `plinkoConfig.json`; the pin locks our record of the table, not an operator artifact. LIQD publishes no machine-readable payout-table spec and there is no third-party RTP for this operator, so the enumeration anchors the *math*, not the *table*.

### The published-RTP rule

LIQD's live Plinko page shows one figure for every board: "Released: June 2026 | Edge: 1.00%", an RTP panel reading "99% on every board", and the answer "Does the number of rows change the RTP? No. Every combination of rows and risk returns 99%." (read 2026-10-01, logged out, in a headless browser; `evidence/rtp-page-labels-2026-10-01.json`, exhibit E19). Taken literally that is not true: no board returns exactly 99.00%; 15 of the 28 boards return less and 13 return more.

RTP-CLAIM (rule 1.2.0, Methodology v1.1, agreed 2026-10-14; code in `src/rtp-claim.ts`, a byte-identical copy of the framework's) holds a game to the figure it shows players. For a flat figure, every board must return within **0.1 pp** of it: a board more than 0.1 pp **below**, on the house side, fails; a board above is player-favourable and never fails. It is **enforced** in this package (`src/rtp-claim-switch.ts`) and scored on Step 10: a miss marks Step 10 RTP FIGURE OVERSTATED and makes the verdict RTP FIGURE OVERSTATED (exit 5), not a hard fail. Step 10 fails if the committed per-board table, `outputs/rtp-claim-table.json` (pinned in `src/rtp-settings.ts`), no longer equals the table the run computes. Each board's RTP is computed exactly as a rational, with no floating point.

**Result: 0 of 28 boards fail.** The worst gap is −0.09375 pp, rows 8 and 10 at medium risk (633/640); 25 boards are inside the band and 3 are more than 0.1 pp above 99% on the player's side: rows 9 medium 99.140625%, rows 11 high 99.160156% and rows 12 high 99.116211%.

| Board | Exact RTP | RTP | Gap to 99% (pp) | Side of the band |
|---|---|---|---|---|
| 8 rows, low | 1267/1280 | 98.984375% | −0.015625 | within 0.1 pp |
| 8 rows, medium | 633/640 | 98.906250% | −0.093750 | within 0.1 pp |
| 8 rows, high | 317/320 | 99.062500% | +0.062500 | within 0.1 pp |
| 9 rows, low | 1267/1280 | 98.984375% | −0.015625 | within 0.1 pp |
| 9 rows, medium | 1269/1280 | 99.140625% | +0.140625 | above, player-favourable |
| 9 rows, high | 317/320 | 99.062500% | +0.062500 | within 0.1 pp |
| 10 rows, low | 5069/5120 | 99.003906% | +0.003906 | within 0.1 pp |
| 10 rows, medium | 633/640 | 98.906250% | −0.093750 | within 0.1 pp |
| 10 rows, high | 317/320 | 99.062500% | +0.062500 | within 0.1 pp |
| 11 rows, low | 5069/5120 | 99.003906% | +0.003906 | within 0.1 pp |
| 11 rows, medium | 507/512 | 99.023438% | +0.023438 | within 0.1 pp |
| 11 rows, high | 5077/5120 | 99.160156% | +0.160156 | above, player-favourable |
| 12 rows, low | 20271/20480 | 98.979492% | −0.020508 | within 0.1 pp |
| 12 rows, medium | 20273/20480 | 98.989258% | −0.010742 | within 0.1 pp |
| 12 rows, high | 20299/20480 | 99.116211% | +0.116211 | above, player-favourable |
| 13 rows, low | 4055/4096 | 98.999023% | −0.000977 | within 0.1 pp |
| 13 rows, medium | 10137/10240 | 98.994141% | −0.005859 | within 0.1 pp |
| 13 rows, high | 20293/20480 | 99.086914% | +0.086914 | within 0.1 pp |
| 14 rows, low | 81101/81920 | 99.000244% | +0.000244 | within 0.1 pp |
| 14 rows, medium | 10137/10240 | 98.994141% | −0.005859 | within 0.1 pp |
| 14 rows, high | 81083/81920 | 98.978271% | −0.021729 | within 0.1 pp |
| 15 rows, low | 162203/163840 | 99.000854% | +0.000854 | within 0.1 pp |
| 15 rows, medium | 162199/163840 | 98.998413% | −0.001587 | within 0.1 pp |
| 15 rows, high | 32449/32768 | 99.026489% | +0.026489 | within 0.1 pp |
| 16 rows, low | 324399/327680 | 98.998718% | −0.001282 | within 0.1 pp |
| 16 rows, medium | 64873/65536 | 98.988342% | −0.011658 | within 0.1 pp |
| 16 rows, high | 162163/163840 | 98.976440% | −0.023560 | within 0.1 pp |
| WTF (13 rows) | 4055/4096 | 98.999023% | −0.000977 | within 0.1 pp |

What the rule can and cannot see: it catches any table error that takes a board more than 0.1 pp below 99%, whether or not the error is in cells the captures paid. An error that keeps every board within the band, or moves a board in the player's favour, passes. Mutation `M51` raises the claim to 99.02% and Step 10 fails, because rows 8 and 10 medium then sit more than 0.1 pp below it.

### Simulation

**Pass 1 — RTP convergence and slot uniformity.** Per-setting server/client seed pairs (`crypto.randomBytes`) drive 1,000,000 rounds on each of the 28 settings: **28,000,000 rounds** (`src/simulate.ts`). Pass 1 does not read any capture: it tests the algorithm and the pinned tables on the auditor's own seeds. Its 28 rows are regenerated by `src/simulate.ts` from the seed pairs saved in the artifact itself (`SIM_SEEDS_FROM`; `npm run regen`). Each setting's running mean RTP is sampled every 50,000 rounds and rendered as a per-setting convergence trace in `outputs/rtp-convergence.html`. Scored Step 16 replays the committed run in full on every `npm test`.

- **Chi-squared** (`df = rows`): 0/28 settings fail at the Bonferroni threshold α/28 = 3.571e-4.
- **Serial independence** (lag-1 autocorrelation, reported beside the Wald-Wolfowitz runs *z*): 1/28 above the uncorrected threshold and 0/28 at Bonferroni. These are **not two independent tests**: on this binarisation the runs *z* is the lag-1 *z* with the sign reversed — over the 28 committed rows `corr(r₁z, runsZ) = −0.9999999643` and `max |r₁z + runsZ| = 1.65×10⁻³` (`steps.step16.serialR1ZRunsZCorrelation`, `steps.step16.serialMaxAbsR1ZPlusRunsZ`).

**Pass 2 — a synthetic fixed-board probe (DL-12).** Pass 2 measures a property of each revealed production server seed's payout stream **on one stated board**. Each of the 52 seeds is evaluated on the board of that epoch's **lowest-nonce bet** (`boardOfEpoch` in `src/calibration.ts`), extended to 10,000 nonces and split into an early and a late window at two lengths:

- **Primary, scored — 50 nonces** (early 0–49, late 50–99). 50 is the shortest epoch of the capture plan, so it is the longest window that every one of the 52 seeds actually played; on 51 of the 52 seeds more nonces than that were played (100 or 200), and on the one 50-drop epoch the late window is a hypothetical continuation. `outputs/calibration-results.json` is calibrated for this window at its top level.
- **Extended, reported — 5,000 nonces** (0–4,999 / 5,000–9,999). It has more power against a seed biased across its whole stream, but 5,000 drops is 25 to 100 times what was played under any seed here, so it is reported, not scored; its calibration is the artifact's `extendedWindow` block.

22 of the 52 epochs played one board only (Phases B, C and E and the WTF epoch of Phase A). The other 30 (the 25 standard Phase A epochs and the 5 Phase D epochs) spread their drops over all 27 standard boards in turn, so for those the probe evaluates one board out of 27 and is not a replay of the mixed-board payout schedule played. Different boards evaluated on the same (seed, nonce) are **not independent** — their RNG paths share row prefixes — so they must not be pooled as separate observations.

| Metric | Window | Value |
|---|---|---|
| Casino seeds / nonces per seed | — | 52 / 10,000 |
| **Payout-weighted: seeds below z = −1.645** | **Primary (50, scored)** | **1 of 52** (calibrated expectation 0.3242 ± 0.5623, Poisson-binomial P(X≥1) = 0.2798) |
| **Payout-weighted: early−late paired t** | **Primary (50, scored)** | **−1.64** |
| Payout-weighted: seeds below z = −1.645 | Extended (5,000) | 2 (calibrated expectation 1.5227 ± 1.2091, P(X≥2) = 0.4533) |
| Payout-weighted: early−late paired t | Extended (5,000) | −0.90 (two-sided p = 0.3671) |
| Slot chi² flags (`earlyP < 0.05 AND lateP ≥ 0.05`) | Extended (5,000) | 2 vs 2.47 expected by chance, survival P = 0.7139, on a null that assumes the tail-merged chi² has size exactly 0.05 |

Both statistics are within noise: no early-window anomaly on this probe, at this power, under this model. A statistical non-rejection is not proof that bias is absent, and nothing here supports a claim that LIQD manipulated outcomes or rules one out. Both are re-executed from the committed seeds and attested within 1e-9 by Step 17.

**Calibrated null, not 0.05·n.** A window payout sum is heavily right-skewed, so the left-tail probability is setting- and window-specific. `npm run calibrate` (`src/calibrate.ts`) writes the per-setting probabilities by exact lattice convolution, and Step 17 recomputes them over the dataset's own epoch population and fails on disagreement. At the primary window the 52 epochs fall on 26 boards, with per-board left-tail probabilities from exactly 0 to 4.1307% (14 rows / risk 1). **On 8 of those boards — every high-risk board from 10 rows up, and WTF — the probability is exactly 0**: no 50-drop window on them can reach the threshold. Those boards carry 30 of the 52 epochs (12 on 16r/3 and 11 on WTF among them), so the count has no power there, and the paired early−late t, not the count, is the load-bearing statistic at this window.

**The slot-flag null is nominal (DL-2).** `expectedFlagsByChance = 2.47` is `52 × 0.05 × 0.95`. Independence of the two windows holds (disjoint nonce ranges), but the size of the discrete, tail-merged chi² at 5,000 draws is near, not equal to, 0.05 and depends on the board. That size is not measured in this repository, so the expectation and survival are nominal figures. Step 21, which uses the same tail-merge rule, inherits the caveat.

**Live-bet statistics, informational only.** Live RTP across the 9,750 drops is **81.9387%** (2,421.29 / 2,955.00 USDT). The figure is dominated by Phase C: its 200 drops at 10.00 USDT are two thirds of the stake, on the board where a 1,000× bucket is 2 × 2⁻¹⁶ per drop. Unrealised rare high-multiplier tails dominate every per-setting sample, so the figure is variance illustration, not RTP evidence. Live slot frequencies are informational for the same reason, while Pass 1 tests slot distributions at 1,000,000 rounds per setting. Lag-1 autocorrelation is **r₁ = 0.0758**; the sequence mixes boards whose win rates differ by construction (Phase A and D cycle the settings, Phase E is WTF), so it reflects between-setting composition, not within-setting dependence. The strictly-profitable rate (multiplier > 1) ranges from 0.1951% (WTF) to 47.0588% (12r/2); on the dataset's `result == "won"` definition (multiplier ≥ 1) from 0.1951% (WTF) to 80.3922% (14r/1). The authoritative independence evidence is the Pass 1 serial test.

## Verification results

The verifier scores **21 steps: 21 PASS, 0 flags, 0 hard fails — PROVABLY FAIR — Full Pass**, over the 9,750 rounds played on `liqd.com` on 7, 9 and 10 November 2026 and the pinned tables. EC-*n* is Step *n*; the numbering is per audit. Eighteen steps carry hard-fail weight (1–8, 10–13, 15–20). Steps 9 and 14 (capture-design checks) can only FLAG. Step 21 is informational: it reports PASS or INFO, never FLAG or FAIL, so it cannot change the verdict.

| Step | Check | Result and scope |
|---:|---|---|
| 1 | Seed hash integrity | PASS: 52/52 revealed seeds satisfy `SHA-256(utf8(serverSeed)) == hashedServerSeed`, 0 mismatches; the count is checked against `EXPECTED_SEEDS`, not the dataset's own seed count |
| 2 | Next-seed pre-commitment chain | PASS: 52/52 pre-commitments — 49 epoch transitions inside the three captures plus the pre-capture link of each capture. The basis for the substitution-blocking position, conditional on authentic commitment timing (DL-3 / P1). No link is asserted across two captures (DL-13) |
| 3 | Hash consistency within epoch | PASS: every bet in each of 52 epochs shares one `hashedServerSeed`; 0 violations — no mid-epoch seed switching |
| 4 | Nonce audit | PASS: 52 epochs sequential 0…n−1 with n the length of the epoch's plan entry in `EXPECTED_PLAN` (200, 100 or 50; not a figure from the dataset header), one client seed per epoch, 0 gaps, 0 repeats |
| 5 | Path + slot recomputation | PASS: 9,750/9,750 recorded paths and slots reproduced by `src/rng.ts` (rebuilt from the specification in [docs/ALGORITHM.md](docs/ALGORITHM.md)), 0 mismatches, 0 skipped; bit-extraction bias 0 at range 2, with the census of `src/bias.ts` on all 127,830 row draws. The site verifier also runs here: 4/4 pins, 9,750/9,750 bets, paytable 365/365 cells |
| 6 | Client seed influence, measured locally | PASS: 260/260 sampled bets (5 per epoch) change path under a wrong client seed; 0 coincidences against an exact null of Σ 2^−rows = 0.1282, Poisson-binomial P(X ≥ 0) = 1 against α = 1e-3 |
| 7 | Multiplier lookup | PASS: 9,750 bets at 1e-9, 0 mismatches. Paid multipliers only: 285/365 cells exercised; the other 80 have no payout witness (DL-1, `S00`) |
| 8 | Payout math | PASS: 9,750 bets reconciled exactly in integer 1e-8 units — no tolerance on money; 0 amounts off the grid, 0 errors |
| 9 | Config completeness | PASS: 27/27 standard settings and WTF present; Phase A holds 185–186 drops on each standard setting and 50 on WTF against the 50-bet floor `MIN_PHASE_A_BETS_PER_CONFIG`; never-paid cells 80/365, 7.59% of summed theoretical RTP |
| 10 | House edge / RTP (per-setting) | PASS: 28 analytical RTPs, each cross-checked by exhaustive path enumeration (worst difference 8.76e-13 against 1e-12); min 98.90625% (8r/2, 10r/2), max 99.16016% (11r/3), edge span 0.83984%–1.09375%. Published-RTP rule: 0 of 28 boards fail, worst −0.09375 pp (`M51` raises the claim to 99.02% and must fail) |
| 11 | Phase labels | PASS: A = 5,050, B = 2,000, C = 200, D = 500, E = 2,000 against `EXPECTED_PHASE_BETS`; 9,750 bets and 52 seed records against code constants; the header (`meta.plannedTotal`, `meta.phases`) is reconciled, not believed |
| 12 | Epoch size | PASS: every plan entry of `EXPECTED_PLAN` played in full — A 25 × 200, D 5 × 100, B 10 × 200, A+W 1 × 50, E 10 × 200, C 1 × 200 — each epoch at its entry's length, stake and capture file; Σ epochs = 52 and Σ epochs × length = 9,750 asserted; this shows the capture ran as planned, not a LIQD limit |
| 13 | Anti-circularity | PASS: rows 8–16, `binomP(n,k)·2^n` equals the exact `C(n,k)` from an independent Pascal recurrence on every coefficient and the masses sum to 1.0; both residuals 0. No operator data used |
| 14 | Phase D — player-set client seeds | PASS: 500/500 Phase D drops recompute under 5 distinct player-set seeds (floor 2), one per epoch, none used outside Phase D; every epoch of the dataset: 52/52 opened with a distinct auditor-submitted seed, 0 equal to the seed in force before its capture, 9,750/9,750 bets carry their epoch's seed and recompute under it, 52/52 commitments published before the rotation that sent the epoch's client seed (shapes only, DL-5) |
| 15 | Phase E — WTF mode | PASS: 2,000/2,000 Phase E drops are risk 4 on 13 rows; with Phase A's 50, all 2,050 WTF drops recompute from the revealed seed and pay `odds[slot]`; slots 1–12 reached, 4 drops paid; WTF table RTP 98.9990%; no WTF drop anywhere else in the data |
| 16 | Simulation Pass 1 | PASS: 28 × 1,000,000 rounds; chi² 0/28 and serial 0/28 at Bonferroni α/28 = 3.571e-4; theory recomputed from the pinned config (28/28 at 1e-12) and `simRTP` within 6 SE of it (28/28); the committed experiment replayed in full, 784 figures compared, 784 bit-identical; 560 trace points bound; the chart re-rendered byte for byte |
| 17 | Simulation Pass 2 | PASS: 52 seeds × 10,000 nonces, all 52 epochs re-executed; slot flags 2 vs 2.47 nominal (P = 0.7139); payout-weighted primary window 1 below z = −1.645 vs 0.3242 calibrated (P(X≥1) = 0.2798), t = −1.64; extended window 2 vs 1.5227 (P(X≥2) = 0.4533), t = −0.90 |
| 18 | Bet-size invariance | PASS: 200/200 Phase C drops at 10.00000000 USDT on 16 rows / high risk — the Phase B board, read from the bets — recompute path and slot and are settled at stake × the table cell exactly; `revealPlinko` declares 4 parameters, none a wager |
| 19 | Multiplier table symmetry | PASS: all 28 tables satisfy `multiplier[k] == multiplier[rows−k]`, 0 asymmetric |
| 20 | Artifact hash + value-domain integrity | PASS: dataset `83965cdc…` and config `09bfaeab…` match their pins; every published 64-hex token in the Markdown equals a pin, an exhibit hash, a capture-file hash named by the dataset or a worked-example commitment; the pinned table equals the production page read on 365/365 cells of 28 boards (351 by a numeric bucket label, 4 by the label `1k` with the page's "1,000x" sentence, 10 WTF middle cells by the page's "pay nothing" sentence); 871 numeric leaves of the two emission artifacts lie in domains derived from the pinned config |
| 21 | Epoch-window slot fit (informational) | PASS: the 9,750 captured drops pooled by board size give per-group p from 0.0139 (rows 13, which pools the 2,050 WTF drops with the 13-row standard boards) to 0.9898 (rows 11); Fisher X² = 18.50, df = 18, combined p = 0.4234; no group below the Bonferroni per-group alpha 1.11e-3; nominal p-values (DL-2) |

Step sources: `tests/steps/commitment.ts` (Steps 1–4), `determinism.ts` (5–6), `payouts.ts` (7–10), `dataset.ts` (11–12), `anti-circularity.ts` (13), `phase-d.ts` (14), `wtf.ts` (15), `simulation.ts` (16–17), `standardization.ts` (18–20) and `live-fit.ts` (21). EC-1 to EC-7 are the core cryptographic criteria with automatic-fail weight; none was triggered.

**Step 6 is local.** It computes both the correct-seed and the wrong-seed path from `src/rng.ts`, so it is a client-seed sensitivity property of our own re-implementation plus a test of the coincidence predicate — not an independent observation of server behaviour. The recorded-outcome comparison is Step 5 (`M27` regenerates 200 recorded paths from another client seed and must be rejected).

**Step 16 compares against recomputed theory.** It derives the reference from the pinned `plinkoConfig.json`, requires the declared theory column to match at 1e-12, compares `simRTP` against that value within 6 SE, and reconciles every header scalar and every convergence trace with the rows (`M26`). Its population is bound to `allConfigs(plinkoConfig.json)`: the 28 boards as a set, each exactly once. The replay plays all 28 × 1,000,000 rounds with `src/pass1.ts` — the loop `src/simulate.ts` itself calls — on worker threads, compares simRTP and every convergence point exactly and the rest at 1e-14 + 1e-12·max, pins the replayed slot counts (`PASS1_CENSUS_SHA256`), gates on statistics re-derived from those counts, binds each trace to its histogram and re-renders the chart byte for byte.

**Step 20 owns the emission artifacts' values and the table's provenance.** Every numeric leaf of `outputs/coverage-results.json` and `outputs/verification-stats.json` must be a value the game physically admits — counts non-negative and bounded by populations known from code, probabilities in [0, 1], payout averages inside the pinned paytable's range — with every bound derived from `plinkoConfig.json` and `src/loader.ts`, never from the artifact. A leaf matched by no declared domain fails too (`M28`–`M30`). The step also holds every cell of the pinned table to the saved production page read (`src/page-labels.ts`; `M52`).

### Integrity matrix

This page covers the package's offline checks; live-API integrity testing is in Section 5 of the report.

<!-- S5-MATRIX:START -->

| ID | Category | Recorded result and limit |
|---|---|---|
| S5-1 | Seed substitution | Pass. 52/52 revealed seeds hash to their commitment (Step 1); substitution would need a SHA-256 second preimage and would break the 9,750/9,750 recomputation |
| S5-2 | Client-seed manipulation | Pass. the recorded outcomes track the client seed on 9,750/9,750 (Step 5, `M27`); 500/500 Phase D drops recompute under 5 player-set seeds and every epoch was played under a distinct auditor-submitted seed (Step 14); Step 6 is a local property of the re-implementation |
| S5-3 | Stake-conditional outcome | Pass. 200/200 drops at 10.00 USDT on the Phase B board recompute from the same four inputs and are settled at stake × the table cell (Step 18); the draw takes no wager argument. Two stakes were played, 0.10 and 10.00; others were not |
| S5-4 | Server-seed cherry-picking | Pass. Conditional: substitution blocked on 52/52 epochs, each commitment published before its client seed was sent (Steps 2, 14), conditional on commitment timing (DL-3); unpredictability of the client seeds rests on a generator not shipped here (DL-5); statistical cross-check Step 17 and the informational Step 21. Nothing here rules out cherry-picking across the capture as a whole |
| S5-5 | Seed-rotation race (TOCTOU) | Not tested in this package. The captures are sequential, one bet in flight and rotation only after a settled epoch. Structurally bounded — a bet's `hashedServerSeed` is fixed at accept time and 52/52 epochs recompute against it — but only a concurrency capture is a positive test (A3) |
| S5-6 | Multiplier-table tampering | Pass. On paid cells: 9,750/9,750 at 1e-9 (Step 7); the config pin is checked before any step scores and all 365 cells equal the production page read (Step 20); all 28 tables symmetric (Step 19); 80 cells have no payout witness |
| S5-7 | Nonce manipulation | Pass. 52/52 epochs sequential from 0 under one client seed, 0 gaps, 0 duplicates (Step 4); the epoch lengths come from `EXPECTED_PLAN`, not from the dataset (Step 12) |
| S5-8 | Modulo bias | Pass. `src/rng.ts` takes the bit as `u mod 2` over the whole 2^32 domain; range 2 divides 2^32, so the split is exact (bias 0), and Step 5's census shows the module drawing every recomputed bit that way (`src/bias.ts`). Measured: 0/28 chi² rejections at Bonferroni (Step 16), against probabilities re-derived by an independent Pascal recurrence (Step 13, max error 0) |

<!-- S5-MATRIX:END -->

S5: fairness-integrity matrix.

All integrity checks held in the 7 tested categories.

Under an unknown client seed the HMAC output does not depend on which server seed the operator picks. The cherry-pick residual applies to players who keep a *predictable* client seed across rotations (kept across rotations, or a platform default); setting your own client seed after seeing the commitment removes it.

### Baseline-deviation review

Re-derivation proves the game behaves as the operator's own model says; it cannot notice that the model departs from what a player would assume. The left column is the standard commit-reveal Plinko baseline, written down independently of LIQD; every departure is dispositioned.

| Standard-Plinko baseline | LIQD observed | Disposition |
|---|---|---|
| Rows selectable (commonly 8–16), 3 risk levels | Rows 8–16, risk low/medium/high, all 27 played on production; plus a fourth level, WTF, fixed at 13 rows | Conforms on the standard levels; WTF is an added mode, disclosed and audited (Step 15) |
| Every slot pays a nonzero multiplier (centre slots typically 0.2×–0.7×) | All 27 standard tables pay at least 0.2× on every slot. WTF pays nothing on its ten middle buckets: 99.6582% of WTF drops return 0 | **Deviation on WTF, disclosed by the operator**: the page says "the ten middle buckets pay nothing". 2,046 of the 2,050 captured WTF drops paid nothing, as the table says; the board's RTP is 98.9990% |
| Payout tables published or queryable | The page shows each board's multipliers on its bucket strip; no machine-readable table is published | Deviation, disclosed; the audited tables are hash-pinned in `plinkoConfig.json` and held to the page display (Step 20) |
| One bit per row, slot = popcount, binomial slot law | Path recomputed for 9,750/9,750 bets; slot law anchored by exhaustive path enumeration (Steps 5, 10) | Conforms |
| Multiplier symmetric in the slot index | Confirmed for all 28 tables (Step 19) | Conforms |
| Advertised edge ≈ derived edge | The live page shows "Edge: 1.00%", RTP "99% on every board" and "Every combination of rows and risk returns 99%." (read 2026-10-01); derived per-setting edge 0.83984%–1.09375% (Step 10) | **Not literally true.** No board returns exactly 99.00%: 15 of 28 return less (lowest 98.90625%, rows 8 and 10 medium) and 13 more; 25 of 28 are inside the ±0.10 pp band and 3 above it on the player's side; none is more than 0.1 pp below 99%, so the published-RTP rule passes. The label is never used as evidence |
| Auto-bet is a speed feature, not a payout mode | "Rapid Fire" is speed-only | Conforms |

No undisclosed deviation was found.

## Reproduce the audit

Use **Node.js 22.23.1 or a later 22.x** (`.nvmrc` 22.23.1, `package.json` `engines` `>=22.23.1 <23`); the committed artifacts were produced on that line, and a derived statistic's last bits are runtime-dependent. From the extracted repository directory:

```sh
npm ci
npm test
```

`npm test` is `node scripts/run-stages.mjs test`, which runs `node scripts/check-standalone.mjs`, `node test.js`, `node verify.js`, `node scripts/check-outputs.mjs` and `node scripts/release-manifest.mjs --check` in that order, every stage whatever the one before it returned, and exits 1 if any stage other than `verify.js` failed, otherwise with `verify.js`'s verdict code. It checks source/bundle integrity, runs the **58 unit tests** (`npx mocha` runs the same 58), runs the 21 scored steps — including Step 16's full replay of the committed 28,000,000-round Pass 1 and Step 17's full Pass 2 recompute — and checks the published record and hashes. **Expected: 21/21 PASS · PROVABLY FAIR — Full Pass, REPRODUCED, exit 0.** The verifier is deterministic given the committed artifacts, but the run is not free of randomness end to end: two unit tests in `tests/plinko/calibrationTests.ts` draw fresh random windows and check the exact left-tail calculation within 5 standard errors.

**Exit contract** (`tests/verify.ts`, end of file). Read the exit code, not the console output:

| Exit | Meaning |
|---:|---|
| 0 | Full Pass: every scored step PASSed and this run reproduced the committed artifacts |
| 1 | Any FAIL: a hard-failed step, a derived emission artifact that disagrees with what this run computed, or a reproduction beyond tolerance |
| 2 | Any FLAG with no FAIL — a Conditional Pass, most often an under-scale run |
| 5 | RTP FIGURE OVERSTATED: the enforced RTP-CLAIM 1.2.0 rule finds the published figure overstated on Step 10 and no step FAILs |

**The reproduction gate is "beyond tolerance", not "any field".** `npm run verify` compares what it computed with the committed artifacts field by field and writes `outputs/run/diff.json`, with the runtime it ran on. Exact content — dataset, config, seeds, integers, strings, hashes — must be identical; derived floating-point statistics may differ by **1e-14 absolute + 1e-12 relative** (`src/diff.ts`), and two distinct integers never agree. Outside the bound the run exits 1.

**Verification never writes the evidence it scores.** It writes only under `outputs/run/` (gitignored). A run with a hard fail is quarantined to `outputs/run/verification-results.failed.json`. Two consecutive runs on unchanged input leave every committed file byte-identical.

| Command | Purpose |
|---|---|
| `npm test` / `npm run test:quick` | Bundle integrity, unit suite, scored verifier with full Pass 1 replay, artifact guard, manifest check; no development dependencies needed |
| `npm run replay` / `npm run replay:standalone` | Re-execute the committed Pass 1 from its saved seeds; writes nothing |
| `npm run regen` | Regenerate the committed simulation with `src/simulate.ts` from its saved seeds (`SIM_SEEDS_FROM`) and calibrate, into `outputs/run/regen/` |
| `npm run diff-simulation` | Compare that regeneration with `outputs/` field by field and the chart byte for byte → `outputs/run/diff-simulation.json` |
| `npm run test:full` | `npm test` + `replay.js` + `regen` + `diff-simulation` |
| `npm run verify` | The 21 steps under ts-node, with the full replay |
| `node scripts/spec-check.mjs` | The specification written out a second time and run on every drop; prints the figures [docs/ALGORITHM.md](docs/ALGORITHM.md) quotes (`--vectors` adds its §5) |
| `npm run check-outputs` | Pre-push guard on the committed canonical artifacts |
| `npm run build` / `npm run check:build` | Rebuild the three bundles and their manifest from TypeScript / rebuild in memory and require byte-identical output |
| `npm run mutate` | The declared mutation battery, in a temporary copy |
| `npm run gate` | `check:build` + `npm test` + `mutate` + `release-manifest --check` |
| `npm run simulate` | A **new** Pass 1 + Pass 2 experiment → `outputs/fresh/`; `npm run calibrate` must use the same `SIM_OUT_DIR` |
| `npm run check-site-verifier -- <site>/src/components/VerifyBets/games/plinko/derive.js` | Compare a ProvablyFair.org site checkout with the pinned verifier bytes |

**Replay is not a fresh experiment (DL-11).** Pass 1 draws fresh seeds per setting, so `npm run simulate` is a new experiment whose statistics legitimately differ; it writes to `outputs/fresh/` and never touches the artifact of record. Reproducing the published experiment is replaying it (Step 16 or `npm run replay`) or regenerating it from its saved seeds (`npm run regen`).

**Local-only escapes.** `PF_P1_REPLAY=off` replays only the first 50,000 rounds per row and caps Step 16 at FLAG (the mutation battery uses it); `ATTEST_SAMPLE=<n>` recomputes an evenly spaced subset of Pass 2 epochs; `EMIT_BASELINE=1` skips the emission-divergence guard. The mode is recorded in `runMode`, and `check-outputs` refuses any canonical run made with any of them.

**Pre-push guard.** `npm run check-outputs` exits non-zero unless the committed `outputs/verification-results.json` has `summary.hardFail === 0`, the verdict exactly `PROVABLY FAIR — Full Pass` (or exactly `RTP FIGURE OVERSTATED` in the one shape the rule allows), **21 distinct steps** under the names their modules declare, a completed passing run, full epoch attestation, a full Pass 1 replay of 28 × 1,000,000 rounds and `emitBaseline: false`, and re-hashes the committed JSON artifacts against the recorded pins.

| Output | Produced by | Contents |
|---|---|---|
| `outputs/verification-results.json` | `PF_EMIT=1 npm run verify` | 21 scored steps, info items, coverage block, profile coverage, summary verdict |
| `outputs/simulation-results.json` | `npm run simulate` (re-execute with `npm run replay`) | Pass 1 per-setting results and Pass 2 seed-consistency results |
| `outputs/rtp-convergence.html` | `npm run simulate`; bound by Step 16 | Per-setting convergence chart |
| `outputs/calibration-results.json` | `npm run calibrate` | Calibrated null for the Pass 2 payout-weighted count, both windows |
| `outputs/rtp-claim-table.json` | `npm run rtp-claim:write`, then re-pin `RTP_CLAIM_TABLE_SHA256` in `src/rtp-settings.ts` | Published-RTP rule per-board table |
| `outputs/coverage-results.json` | `PF_EMIT=1 npm run verify` | Payout-table cell coverage (285/365) and never-observed RTP share |
| `outputs/verification-stats.json` | `PF_EMIT=1 npm run verify` | Every figure the steps and informational items emit, as machine values |

**Regenerating after a change to a step's output — the order matters.**

```text
1.  make the code change                     (declare any NEW numeric leaf in src/domains.ts)
2.  EMIT_BASELINE=1 PF_EMIT=1 npm run verify  # bootstrap the derived artifacts
3.  PF_EMIT=1 npm run verify                  # settling pass — writes a clean record
4.  npm run build                            # the bundles embed the sources
5.  npm run check-outputs                     # must report OK and runMode.emitBaseline=false
6.  npm run verify                            # outputs/run/diff.json must be empty on all three
7.  npm run release-manifest                  # ALWAYS LAST — it lists the hashes steps 2–3 rewrote
```

**Mutation battery.** The per-entry list is in [exploit-testing.md](exploit-testing.md). `npm run mutate` runs two registries: `tests/mutations.json` (53 counterexamples, each of which a named scored step must reject, except `M01`, `M02` and `M35`, which the unit tests or the config pin reject, and `M46`, which shows the informational Step 21 reacting) and `tests/mutations-extra.json` (27 entries — publication-guard refusals, reviewer configurations, the RTP FIGURE OVERSTATED route `C3i`/`C3ii`, and the declared survivor `S00`) — 80 in total. The battery is outside `npm test` because it re-runs the verifier once per mutation. It never edits the working tree: it copies the package to a temporary directory and restores every touched file after each entry. For the declared survivor the runner requires proof that the steps ran, read from the run's own scored record. **Result on this release: 80 of 80 entries behaved as declared** (79 rejected, each printing the marker its entry declares; the declared survivor `S00` survived as declared). None was a timeout or a run stopped by a signal. How the battery was run, by git tree. 73 entries (`M00` to `M52`, `X00` to `X17`, `S00`, `X19`) ran on the tree of commit `7dba1be` (src `251e7b54`, tests `3fe7b561`, data `429a88b5`, outputs `cfab36eb`); `X18`'s run there was stopped by SIGTERM and is not counted. Commit `6ac4bca` then changed only `src/loader.ts` (adds `EXPECTED_EPOCH_SIZE`, the planned epoch length per plan id, built from `EXPECTED_PLAN`), `tests/steps/commitment.ts` and `tests/steps/dataset.ts` (Steps 4 and 12 compare epoch lengths against it) and the rebuilt bundles. On its tree (src `978267e8`, tests `b8d00c7c`, data `429a88b5`, outputs `cfab36eb`) the 7 entries that edit `src/loader.ts` or are rejected by Steps 1 to 4, 11 or 12 (`M03`, `M05`, `M06`, `M24`, `M25`, `M37`, `M38`) and the declared survivor `S00` (whose result requires Steps 1 to 4, 11 and 12 to report PASS) were rerun, and the 7 not yet run (`X18`, `C3i`, `C3ii`, `X20` to `X23`) were run: 15 of 15 behaved as declared. The other 65 were not rerun: the steps and checks that reject them (Steps 5 to 10 and 13 to 21, check-outputs, the unit specs and the config pin) are in files that commit did not change, and the one source addition is read only by Steps 4 and 12. This release's tree differs from the `6ac4bca` tree only in comments, wording and the Node pin: comments in the source and scripts, the `guard` and `note` texts of the two registries, the documents, one unit-test title, one profile-coverage note, `.nvmrc` and `engines`, and the record, bundles and manifests regenerated with them; with comments removed, every changed `.ts` and `.mjs` file transpiles to the same code as on `6ac4bca` except for those two strings.

`S00` changes both never-paid 15-row high-risk 620× cells to 610 in `plinkoConfig.json` **and** in the saved page read, regenerates both pins and propagates them to the documents: the tree that a wrong display, recorded faithfully from the first commit, would have produced. **17 of the 21 scored steps still pass**, Step 20 among them. The registry declares `expectFail: [5, 10, 16, 17]`, all of one kind — **artifact staleness, not detection**: the committed simulation was produced with the original table, so its stored theory column (Step 16) and Pass 2 values (Step 17) no longer re-derive; Step 5's site-verifier `paytables.js` is a hash-pinned copy of the original table; Step 10's committed `outputs/rtp-claim-table.json` likewise. Had the cells been wrong from the first commit, every copy would carry the same error and agree. The published-RTP rule does not detect this error, because the board stays inside the band (32429/32768 = 98.965454%, −0.035 pp). A wrong number in the table alone is a different case and is detected: `M52` moves two never-paid cells off what the page displayed and Step 20 rejects it.

## Verify a bet

**With the ProvablyFair.org verifier.** Open [provablyfair.org/verify-bets/liqd](https://www.provablyfair.org/verify-bets/liqd); its Plinko verifier takes the revealed server seed, the client seed, the nonce, the rows and the risk level and returns the path, the slot and the multiplier. Its code is the code vendored in `verifier-parity/`, which Step 5 runs on all 9,750 production bets (below).

**By hand.** Any past LIQD Plinko drop reproduces from published inputs alone — the revealed server seed, client seed, nonce and row count — with a standard crypto library. No LIQD code, no API call, no secret state.

1. **Commitment.** `SHA-256(utf8(serverSeed))` must equal the bet's `hashedServerSeed`, published before the round. Hash the 32-character hex string, not its decoded bytes.
2. **Per-row bits.** For `cursor` in `1 … rows`, take `digest = HMAC_SHA256(key = hex_decode(serverSeed), msg = "{clientSeed}:{nonce}:{cursor}")`, then `bit = big_endian_uint32(digest[0:4]) % 2` (0 = left, 1 = right).
3. **Winning slot.** `winningSlot` = the count of 1-bits across the rows, a value in `[0, rows]`.
4. **Payout.** Look `winningSlot` up in the pinned table for `(rows, riskLevel)` — `plinkoConfig.json`, `payout_tables[String(rows)][riskLevel − 1][slot]`, or `wtf_mode.odds[slot]` for WTF — and check `winningAmount = betAmount × table[winningSlot]`.

**Worked example — production bet `4PmgyUj9xOP9CXphd0Wi0`** (epoch 0, nonce 0, played 2026-11-07T16:29:12Z): `serverSeed` `9ef0b85313bd2d1b8d96e22df9b08ff4`, `clientSeed` `auditf011676cf201`, `nonce` 0, `rows` 8, `riskLevel` 1.

Commitment: `SHA-256(utf8("9ef0b85313bd2d1b8d96e22df9b08ff4")) = fc09cc34555528c74b6242b31ea0fbe2e4a51b085b66d58c5aa50d68b1c090fd`, which equals the bet's recorded hashedServerSeed — and the `nextHashedServerSeed` of the first capture's pre-capture record, published before the epoch's client seed was sent.

The HMAC key is the 16 decoded bytes of the seed and the message is `auditf011676cf201:0:<cursor>`:

| Cursor | First four bytes | Unsigned integer | Bit |
|---:|---|---:|---:|
| 1 | `5269454b` | 1,382,630,731 | 1 |
| 2 | `a9775d54` | 2,843,172,180 | 0 |
| 3 | `e100079a` | 3,774,875,546 | 0 |
| 4 | `2be90945` | 736,692,549 | 1 |
| 5 | `f0673592` | 4,033,295,762 | 0 |
| 6 | `3b0c412b` | 990,658,859 | 1 |
| 7 | `53efc4cc` | 1,408,222,412 | 0 |
| 8 | `944aba01` | 2,487,925,249 | 1 |

The path is `10010101`, four right decisions, so slot 4, equal to the served `dropDetails` and `winningSlot`. The 8-row low-risk table pays 0.5 at slot 4, matching the served multiplier, and `0.10 × 0.5 = 0.05` matches the paid `0.05000000`.

The reference verifier `src/rng.ts` (`revealPlinko`) was rebuilt from the written specification in [docs/ALGORITHM.md](docs/ALGORITHM.md), which these steps follow, by an implementer who never opened LIQD's code, and reproduces all 9,750 production drops with zero mismatches. A matching drop verifies that round against its inputs; it does not by itself establish when its commitment was published or that every other round is fair.

**The ProvablyFair.org verifier for this game is checked too.** The LIQD Plinko verifier in ProvablyFair.org's documentation site (`VerifyBets` → `games/plinko/derive.js`, with the HMAC library and paytable it imports and the source card the page displays) is vendored byte for byte in `verifier-parity/`, its four SHA-256 digests are pinned in `src/site-verifier.ts`, and Step 5 runs that code, unmodified, on all 9,750 production bets: same L/R path, same slot and the same multiplier LIQD served on every one, a paytable equal to `plinkoConfig.json` on all 365 cells, and a source card whose text is `derive.js` exactly. The vendored files are byte-exact copies of the site's files, pinned on 24 September 2026; a player can run the same verifier at `https://www.provablyfair.org/verify-bets`.

## Evidence

The primary evidence is the dataset (E06) and the reproducible verification outputs (E08), not page reads. Every listed path exists in the repository. There are no exhibits E01–E05: this release carries no screenshot.

| ID | File | Format and date | Evidence and limits |
|---|---|---|---|
| E06 | [Production dataset](data/plinko-prod-9750bets.json) | JSON · SHA-256 `83965cdc5381db3ad99bf7c1c1e1d2e0d90f574132f96642027599c0edea8a16` | 9,750 drops, 52 revealed seed epochs, three captures on `liqd.com`, 7, 9 and 10 November 2026. `loadDataset()` aborts on a hash mismatch. |
| E07 | [Payout tables](plinkoConfig.json) | JSON · SHA-256 `09bfaeab2b7885ef63d72cebcfe1a667cb8ec604c887cebcdea22e56c2960f0a` | The 27 standard tables and the WTF table. `loadPlinkoConfig()` aborts on a mismatch; Step 20 holds every cell to E21. |
| E19 | [RTP page labels](evidence/rtp-page-labels-2026-10-01.json) | JSON · SHA-256 `e159a3c173a1887c6c5dd2728caf9378ade2c6b2fbd6ce8f410a3bca3e13b0e2` · read 2026-10-01 | The RTP and house-edge figures LIQD's live `liqd.com/originals` pages show players, read in a headless browser, logged out. For Plinko: "Released: June 2026 \| Edge: 1.00%", "99% on every board". The source of the claim Step 10 holds the game to (`src/rtp-settings.ts`). |
| E21 | [Production page read](evidence/liqd-plinko-page-reads-2026-10-20.json) | JSON · SHA-256 `769754a5cb5ddd1156759940ca6b000982b5872384103a66d997fad4b093aab0` · read 2026-10-20 | The text of `liqd.com/originals/plinko` and `liqd.com/provably-fair` and the bucket-strip labels of every board (27 standard and WTF), read logged out in a browser by selecting each risk button and stepping the Rows slider; no bet. The display Step 20 holds the table to. A text read, not a screenshot, and not made on the capture days. |
| E22 | [Capture check, Phase A](evidence/E22-prod-capture-check-phase-A-2026-11-08.txt) | Text · SHA-256 `02f3a84789a8120fb86535ebbe472ed14f913393c940f076c01738a6a767e2d1` | The workshop checker's printout over capture 1: ALL CHECKS PASS; LIQD's verifier equals the served round on 5,000/5,000. Not reproducible from this package. |
| E23 | [Capture check, Phases D, B, A+W, E](evidence/E23-prod-capture-check-phases-D-B-AW-E-2026-11-09.txt) | Text · SHA-256 `eef748900323467c4558f9a5007551f754b05dc4e8cd24b2c731a152a1f52256` | The same over capture 2: ALL CHECKS PASS; 5 player-set seeds taken by the site; LIQD's verifier 4,550/4,550. Its line "26/26 drawn after the commitment they were used under was published" overstates the timing of the five Phase D seeds: by the runner's record they were drawn when the plan was built, before the capture's first rotation, and each was submitted only after the commitment of its epoch was served (Step 14: 5/5). |
| E24 | [Capture check, Phase C](evidence/E24-prod-capture-check-phase-C-2026-11-10.txt) | Text · SHA-256 `4868159c6e86f3bd85b651e45b77ddc0237442ede6c539963a885d0140f3166c` | The same over capture 3: ALL CHECKS PASS; 200/200 at 10.00000000 USDT; LIQD's verifier 200/200. |

| ID | File | Role |
|---|---|---|
| E08 | [Verification results](outputs/verification-results.json) | 21 scored steps, 21 PASS. Records `artifactHashes` for the committed JSON artifacts, the `runMode`, per-step details and machine `data`, the coverage block, informational items and the verdict. |
| E09 | [Simulation results](outputs/simulation-results.json) | Pass 1: 28 × 1,000,000 rounds, seeds stored per row. Pass 2: 52 production casino seeds × 10,000 nonces, the synthetic fixed-board probe. Hash-pinned (`SIMULATION_RESULTS_SHA256`, `src/artifact-pins.ts`). |
| E10 | [Convergence chart](outputs/rtp-convergence.html) | Self-contained per-setting running-RTP chart; re-rendered by Step 16 from the committed traces and required byte for byte. |
| E16 | [Calibrated null](outputs/calibration-results.json) | Per-setting exact left-tail probabilities, the per-epoch assignment over the 52 seeds and the Poisson-binomial summary at both windows. Pinned (`CALIBRATION_RESULTS_SHA256`); rebuilt in full by Step 17. |
| E17 | [Coverage](outputs/coverage-results.json) | 285/365 cells exercised, 80 never paid, the 7.59% never-observed RTP share. |
| E18 | [Verification statistics](outputs/verification-stats.json) | Every figure the steps and informational items compute, as machine values. The figures quoted in this overview come from here; the record's `detail` strings are prose and are not the source. |
| E20 | [RTP claim table](outputs/rtp-claim-table.json) | Per-board exact RTP as a rational, gap to the 99% in E19, side of the band and outcome — 0 of 28 fail. Pinned as `RTP_CLAIM_TABLE_SHA256` in `src/rtp-settings.ts`. |
| E11 | [src/rng.ts](src/rng.ts) | Dependency-free reference RNG: `commitHash`, `generateProvablyFairNumber`, `revealPlinko`. Reproduces all 9,750 production drops. |
| E12 | [tests/verify.ts](tests/verify.ts) | The 21-step suite, run against E06 using E07; re-hashes both at startup. |
| E13 | [src/simulate.ts](src/simulate.ts) | Two-pass simulation writing E09 and E10; a fresh run writes to `outputs/fresh/`. `src/replay.ts` re-executes the committed Pass 1 and writes nothing. |
| E14 | [src/config.ts](src/config.ts) | Config loader, `binomP`, `payoutTable`, `theoreticalRTP`, `allConfigs`; enforces the config pin. |
| E15 | [scripts/spec-check.mjs](scripts/spec-check.mjs) | The specification of [docs/ALGORITHM.md](docs/ALGORITHM.md) written out a second time, with no import from `src/`; reproduces all 9,750 drops and prints every DATA figure the specification quotes. |

**Integrity.** The dataset SHA-256 is recorded in the verification record and recomputable with `shasum -a 256 data/plinko-prod-9750bets.json`; the config SHA-256 likewise with `shasum -a 256 plinkoConfig.json`. The outputs (E08–E10, E16–E18, E20) were generated by E12, E13, `src/calibrate.ts` and `src/rtp-settings.ts` against this exact dataset and config; a single-byte change to either input aborts the suite before any result is written. `RELEASE-MANIFEST.json` lists the SHA-256 of every artifact of record, E21 included.

## Limitations and trust

The cryptographic checks prove that every captured drop was consistent with a pre-committed server-seed hash and a player-controlled client seed, and paid against the pinned table. Commit-reveal proves, against the full dataset: no post-bet tampering (each outcome is bound to a server seed committed beforehand); truthful reveal (52/52); client-seed consumption (9,750/9,750 under 52 distinct auditor-submitted seeds; the recorded-outcome comparison is Step 5); faithful execution (9,750/9,750); and payout conformance (9,750/9,750). This section records what those checks do not prove.

| Entropy component | Source | Player-observable? | Player-controllable? |
|---|---|---|---|
| Server seed (secret) | LIQD | No (until reveal) | No |
| Server-seed hash (commitment) | `SHA-256(utf8(serverSeed hex string))` | Yes (before any drop) | No |
| Client seed | Player | Yes | Yes (editable) |
| Nonce | LIQD state | Yes | Only via ordering |

**R-CHERRY — server-seed cherry-picking.** Commit-reveal binds outcomes to a seed after commitment; it does not constrain which seed the operator commits to. On these captures every epoch's commitment was published (as the previous state's next-seed hash, or the capture's pre-capture record for its first epoch) before the rotation that sent that epoch's client seed (Steps 2 and 14, 52/52), and the 52 client seeds are distinct, none reused. Seed substitution is therefore blocked on every epoch, structurally, with two conditions: authentic commitment timing (DL-3 / P1), since chronology inside one self-published file does not establish when the commitment was public; and unpredictability of the client seeds to the operator at commitment, which rests on a generator not shipped here (DL-5). By the runner's record the five Phase D seeds were drawn in the auditor's browser when it built the plan, before the capture's first rotation, and each was sent to LIQD only at the rotation opening its epoch. The statistical cross-checks agree and find no early-window anomaly at their own power (Step 17; Step 21 informational). **Nothing here rules out cherry-picking across the capture as a whole.** No external-entropy pinning is in use, which is peer-standard for commit-reveal Plinko (recommendation P2).

**R-PAYOUT — payout-table integrity. Containment: partial — 285/365 cells paid, 80 displayed only.** A wrong value in any paid cell fails Step 7. A wrong value in a never-paid cell fails Step 20 if it differs from what the production page displayed, and Step 10 if it takes a board more than 0.1 pp below 99%. What remains is a cell the page displays differently from what the server would pay: no settled data can see that until a drop lands there.

**R-CONFIG — payout-table update after capture. Disclosed.** The page was read on 20 October 2026 and the drops were paid on 7, 9 and 10 November; they agree on all 285 paid cells. Nothing in the captured records carries a table version or content hash, so a later rebalance could leave the snapshot disagreeing with live tables (recommendation P3).

**R-MULTI — multi-account seed correlation. Out of scope, disclosed:** a single-account dataset cannot detect cross-account seed reuse (A2). **R-RACE** is S5-5 (A3).

Further boundaries: the audit verifies game-logic correctness, not the quality of the server's entropy source, which the commitment bounds; outcomes were collected in three windows on three days, and platform behaviour could change after them; LIQD is centralized, with no on-chain record — verifiability rests on commit-reveal, not a blockchain.

### Declared limitations register

Everything this audit knows it cannot prove, with its measured magnitude where one exists. A limitation missing from this list is a defect in this list.

| # | Limitation | Registered as | Magnitude (measured) | Why it cannot be closed offline |
|---|---|---|---|---|
| **DL-1** | **The never-paid payout cells.** Step 7 can only check cells a captured drop landed on. The other cells equal what the production page displayed (Step 20), which is a display, not a payment. | `S00`, declared survivor in `tests/mutations-extra.json`; premise **P3**; Step 7's detail string; `outputs/coverage-results.json` | 80 of 365 cells never paid (285 exercised, 78.1%). **7.59%** of summed theoretical RTP; **26.9844%** (11r/3), **24.6609%** (WTF) and **18.2575%** (13r/3) of those boards' RTP. Both 1,000× WTF buckets and the 1,000× bucket at slot 16 of the 16-row high-risk board are among them; the 1,000× bucket at slot 0 of that board was paid. | Settled data has zero power over a cell that never paid. `S00` reproduces the tree that a wrong value shown by the page and recorded in the table from the first commit would produce; see the battery paragraph for the steps that still pass. Closing it requires a paid drop in each cell, or the operator's table committed as evidence with a hash the game serves. This is a limit of our capture, not a finding against the operator. |
| **DL-2** | **The Pass 2 slot-flag null is nominal, not calibrated.** `expectedFlagsByChance` is `52 × 0.05 × 0.95`, which assumes the tail-merged chi² has size exactly 0.05. Step 21 uses the same rule and inherits the caveat. | `A4b`; Step 17's and Step 21's detail strings | **Not measured in this repository.** 2 flags vs 2.47 (survival P = 0.7139) and Step 21's Fisher p = 0.4234 are nominal. | Measurable offline (exact-null multinomial Monte Carlo per board size at n = 5,000); deferred because it is immaterial at these counts and the exactly calibrated payout-weighted statistic agrees. |
| **DL-3** | **Dataset provenance.** Nothing offline proves the 9,750 rounds came from LIQD. The pin proves the file has not changed since we pinned it; the population constants prove it is the population audited. Neither speaks to origin. | Premise **P1**; the population guard in Steps 11/12 (`G-BIND`) | The whole dataset — 9,750 drops, 52 epochs, 2,955.00 USDT staked. | Provenance rests on capture discipline: the auditor's logged-in session on `liqd.com`, the runner's exports and their SHA-256 recorded in `meta.captures`, and each capture's pre-capture record anchoring its commitment chain. The raw captures and the runner are in the private workshop, not in this package. Only an independent capture by a second party closes it. |
| **DL-4** | **Three production sessions, three days.** The captures are of `liqd.com` on 7, 9 and 10 November 2026, on one account; the table display was read on 20 October 2026. | Premise **P5** | The entire audit. | Whether later deployments serve the same game build and tables is not observable from these captures; a later capture is a new audit window. |
| **DL-5** | **The client seeds were generated by a runner this package does not ship.** 47 use `audit` + 12 lowercase hex characters and the 5 Phase D seeds use `pfaudit-prod-plinko-d<k>-` + 12 lowercase hex characters; the runner's record names the generator as 6 bytes of `crypto.getRandomValues` (browser CSPRNG), but its source is not in this repository, so their unpredictability to the operator at commitment is an assumption. | Step 14, whose detail carries the figures; premise **P4**; R-CHERRY above | 52 of 52 epochs: 48 random bits each by the runner's record, all distinct, consistent with — but not demonstrating — a cryptographic source. Substitution-blocking does not depend on the generator; unpredictability at commitment does. | Closed by shipping the exact runner with the capture, or by an independent capture whose seed generator is reviewable (`A4`). |
| **DL-7** | **Live-bet RTP is not RTP evidence.** | The verifier's informational item, labelled *informational, not authoritative* | Observed **81.9387%** across the 9,750 drops; two thirds of the stake is 200 drops on one high-variance board. | A sample this size cannot resolve a 1% edge against tails that pay up to 1,000×. The authoritative evidence is the analytical calculation plus the simulation. |
| **DL-8** | **The payouts in LIQD's bet replies are not cross-confirmed against a balance delta.** The production bet reply carries no running wallet-balance field. | `A6` | All 9,750 payouts. The claim rests on the seed-recomputed multiplier and the exact `betAmount × multiplier` identity. | Closed only by a capture that records balance before and after each bet. |
| **DL-9** | **Untested surfaces, disclosed rather than cleared:** seed-rotation race (TOCTOU), multi-account seed correlation, selective bet rejection, server-seed entropy and custody, bet/profit caps, stakes other than 0.10 and 10.00 USDT, currencies other than USDT, and the elevated stake on any board other than 16 rows / high risk. | Rotation race: `S5-5`, `A3`. Multi-account: `R-MULTI`, `A2`. The others: this row | Not quantified — no capture addresses any of them. | Each needs a capture design this engagement did not run. None is implied to have passed, and no scored step touches them. |
| **DL-11** | **Historical replay and fresh experiment are separated.** | [Reproduce the audit](#reproduce-the-audit); the `replay` / `simulate` scripts | — | `npm test` never draws seeds — Step 16 replays the committed Pass 1 from its saved seeds; `npm run simulate` writes a new experiment to `outputs/fresh/`. The published Pass 1 numbers can only be re-derived by replaying their saved seeds, and `verification-stats.json` and `coverage-results.json` are deterministic given the dataset, the config **and** the committed simulation and calibration artifacts. |
| **DL-12** | **Pass 2 is a synthetic fixed-board probe, not the observed payout schedule, and its count has no power on most epochs at the scored window.** Each epoch is evaluated on one board chosen by an explicit nonce rule — the board of its lowest-nonce bet (`boardOfEpoch`) — extended to 10,000 synthetic nonces; the scored window is the first 50. | `A4c`; the Pass 2 section above | **30 of 52 epochs are mixed-board** (each spread its drops over all 27 standard boards), so for those the probe evaluates one board out of 27. **On 30 of 52 epochs the board's left-tail probability at 50 nonces is exactly 0**, so the count cannot register there. The scored window is 50 nonces although 51 seeds played 100 or 200. | The calculation is internally consistent and reproduces exactly; it does not measure the mixed-board schedule played, and at 50 nonces the paired early−late t is the only statistic with power on the high-variance boards. Boards evaluated on the same (seed, nonce) share row prefixes and are not independent. Closed only by the statistic in `A4c`. |
| **DL-13** | **The commitment chain is verified inside each capture, not across them.** The dataset is three runs; between them the account played other games and the seed pairs used in between are not in this dataset. | Step 2's detail string; `EXPECTED_CAPTURE_EPOCHS` in `src/loader.ts` | 49 transitions verified inside the captures and 3 pre-capture links, one per capture; 2 boundaries (7 → 9 November, 9 → 10 November) carry no link. | Each capture is anchored by the pair that was active before its first round, read and then revealed by the runner's first rotation. A single continuous run, or a capture of every pair used in between, would close it. This is a property of how we captured, not a finding against the operator. |

DL-6 and DL-10 were closed under earlier releases; their records are in the [release history](#release-history).

### Load-Bearing Premises

The claims this audit rests on that the settled data cannot fully check. Each row names its witness — the captured dataset, or an external or ASSUMED source — never an `outputs/` file, which would only prove the pipeline agrees with itself.

| # | Premise | Witness | What the captured data can contradict |
|---|---|---|---|
| **P1** | The 9,750 records are rounds LIQD actually served on `liqd.com` — a capture, not a construction | ASSUMED — capture discipline: the auditor's logged-in session, the runner exports named with their SHA-256 in `meta.captures`, and the three pre-capture records. `EXPECTED_DATASET_SHA256` proves the bytes have not changed since pinning; `EXPECTED_BETS` / `EXPECTED_SEEDS` / `EXPECTED_PLAN` prove the population. Neither speaks to origin | A self-consistent forged capture would satisfy all 21 scored steps; the data cannot show its origin. This is DL-3; only an independent capture by a second party closes it |
| **P2** | Every multiplier a player was paid matches the pinned table | `data/plinko-prod-9750bets.json` (Steps 7 and 8 over all 9,750 bets) | All 9,750 paid multipliers equal their cell; a wrong value in any of the 285 of 365 paid cells fails Step 7 |
| **P3** | The 80 never-observed cells (incl. both 1,000× WTF buckets) equal the operator's live tables | ASSUMED beyond the display — E21 shows what `liqd.com/originals/plinko` displayed for every one of them on 20 October 2026, and Step 20 holds the table to it; a display is not what the server pays | No captured drop landed on these 80 cells, so the data says nothing about them (7.59% of summed theoretical RTP). The published-RTP rule bounds how far an error can move a board below 99%; it cannot confirm the cells. This is DL-1 |
| **P4** | Each epoch's client seed was outside the operator's control when its server-seed hash was committed | `data/plinko-prod-9750bets.json` (the three pre-capture records, the 52/52 chain, and 52 distinct seeds, Step 14) | The ordering (commitment published before the client seed was sent) is checked on 52 of 52 epochs, conditional on authentic commitment timing (DL-3 / P1) — a digest carries no time; the seeds' unpredictability rests on a generator not shipped here (DL-5) |
| **P5** | The game LIQD served on 7, 9 and 10 November 2026 is the game players get afterwards | ASSUMED — three production sessions | The data covers 7, 9 and 10 November 2026 only; it shows nothing about later days. This is DL-4 |
| **P6** | The runner's `epoch`, `phase` and `phaseId` labels group the records correctly | ASSUMED as an input — written by the runner and carried by the converter. Scoring reads them: Step 11 checks cohort sizes, Steps 4 and 12 key the epoch length on the plan entry, Step 17 and `src/calibration.ts` key the calibrated null on `epoch` | The grouping must yield exactly the 52 epochs of `EXPECTED_PLAN`, each with its entry's length, stake and capture and nonces {0…n−1}, and `epoch` is redundant with the `hashedServerSeed` join, so an inconsistent relabelling fails Steps 4/11/12; a globally consistent one would not be detected |

Four premises are ASSUMED and disclosed rather than claimed as verified: P1, P3, P5 and P6 (as an input). Every mention of P3 or P5 must carry the same qualification.

**Scope and coverage.** Payout-table coverage is 285 of 365 cells. Capture provenance relies on the recorded collection process; independent capture or external attestation is not supplied. Seed-selection protection is the conditional position above; no universal guarantee is made. Statistical sensitivity is limited by the nominal slot-test reference and the synthetic Pass 2 probe. Checks cover reported game payouts; wallet balances, withdrawals, payments and custody are excluded.

### Recommendations

**Operator recommendation P1 — publish the algorithm and payout tables.** A byte-level description of the HMAC-SHA256 bit draw (`cursor = row + 1`, one bit per row, slot = count of 1-bits); the hex-decoded key and the `SHA-256(utf8(serverSeed hex string))` commitment, explicitly distinguished; the bit rule (the first four digest bytes, big-endian, mod 2); machine-readable per-`(rows, riskLevel)` tables linked from the PF panel; and a validation vector, e.g. `serverSeed=9ef0b85313bd2d1b8d96e22df9b08ff4`, `clientSeed=auditf011676cf201`, `nonce=0`, `rows=8` → path `10010101`, slot 4.

**Operator recommendation P2 — adopt an external-entropy beacon.** Pinning one entropy component to drand or an L1 randomness beacon would collapse R-CHERRY to LOW by construction. An architecture upgrade, not a fix for a current defect.

**Operator recommendation P3 — payout-table version stamp.** Add a per-setting `version` or `contentHash` field so the client can display the table version beside each bet. Addresses R-CONFIG.

**A1 — table evidence.** A hashed game-settings response served with each bet, or the operator's table committed as evidence, would let the never-paid cells be verified against the live table rather than against the page display.

**A2 — multi-account correlation study (R-MULTI).** **A3 — seed-rotation race capture (R-RACE).** **A6 — balance-delta capture** (DL-8).

**A4 — ship the seed generator with the capture.** Publish the production runner, or the part of it that generates and submits client seeds, beside the dataset, so the unpredictability of the client seeds is reviewable rather than assumed (DL-5).

**A4b — measure the true size of the tail-merged slot chi²** (DL-2). **A4c — a statistic on the board and stake actually played** at each nonce, over each epoch's full played length, with a matching null and a power study (DL-12).

## Terms

**Provably fair:** an outcome the player can verify after the fact from seeds committed before the bet. **Commit-reveal:** the server publishes `hashedServerSeed` before any bet and reveals the plaintext `serverSeed` on rotation. **Server seed:** a 32-character hex string (16 bytes), secret during betting, used as the HMAC key hex-decoded. **Commitment:** `SHA-256(utf8(serverSeed hex string))`, deliberately distinct from the key. **Next server seed hash:** the following epoch's commitment, pre-committed before rotation. **Client seed:** the first HMAC message field, fixed within an epoch; a different client seed reproduces an identical path only by coincidence, at rate 2^−rows. **Nonce:** the bet's position in its epoch, starting at 0 (the `nonce` field). **Cursor:** the per-row HMAC index, `row + 1`. **Epoch:** the bets under one `(serverSeed, clientSeed)` pair; 200, 100 or 50 in these captures. **Capture:** one run of the runner, exported as one file; the dataset holds three. **Plan entry (`phaseId`):** a line of the capture plan — the phase letter, or `A+W` for Phase A's drops on the WTF board. **Path / `dropDetails`:** the per-row bit string. **Winning slot:** the count of `1` bits, binomial B(rows, 0.5) on a fair board. **Risk level:** `{ LOW: 1, MEDIUM: 2, HIGH: 3, WTF: 4 }`; controls the multiplier spread, not the physics. **WTF:** the fourth risk level, 13 rows only, paying on the four outer buckets. **Rapid Fire:** an auto-bet speed control, not a payout mode. **RTP:** return divided by stake; here the authoritative figure is theoretical, `Σ_k C(rows,k)·0.5^rows · multiplier(k)`; observed RTP is labelled as such. **House edge:** 1 − RTP. **Published-RTP rule (RTP-CLAIM):** holds every board to the RTP shown to players within 0.1 pp on the house side. **Anti-circularity:** deriving probabilities from combinatorics, never from operator tables. **Chi-squared test:** observed against expected slot counts, `df = rows`. **Bonferroni correction:** family-wise control across the 28 settings, α/28. **Serial independence:** lag-1 autocorrelation and the Wald-Wolfowitz runs *z* — one statistic, not two. **Cherry-picking:** choosing a server seed after seeing or predicting its client seed; **substitution** swaps a seed after commitment, **grinding** searches candidate seeds before committing. **Pass 1 / Pass 2:** the fresh-seed simulation and the casino-seed fixed-board probe. **EC-n:** scored Step n. **Hard fail:** a result that invalidates the claim outright. **Hash-pinning:** recording an artifact's SHA-256 and aborting on any change.

**Guard codes** used in the source comments and here: **G-BIND** — every population assertion binds to source records and `src/loader.ts` constants, never to a count the artifact supplies about itself; a row count is not an identity. **G-VALID** — nothing is rejected for being merely surprising; exactness, a zero deviation or a round number is not evidence of fabrication. **G-RECOMPUTE** — a reference value is derived from the pinned config on every run, never read out of the artifact being checked.

## Release history

**v1.1.0 — re-certification on production data (this release, 10 November 2026).** Every check of LIQD's behaviour rests on production data: 9,750 drops played on `liqd.com` on 7, 9 and 10 November 2026 in every phase of the capture plan (`data/plinko-prod-9750bets.json`, SHA-256 `83965cdc…`). Verdict **PROVABLY FAIR — Full Pass**, 21 of 21 scored steps. What this release contains:

- **Scored dataset and plan.** `src/loader.ts`: the dataset pin, `EXPECTED_BETS 9750`, `EXPECTED_SEEDS 52`, `EXPECTED_PHASE_BETS`, `EXPECTED_PLAN`, `EXPECTED_CAPTURE_EPOCHS` and `PRIMARY_WINDOW_NONCES`. Epochs do not have one length: Steps 4 and 12 hold each epoch to the length of its plan entry. Step 2 verifies the chain inside each of the three captures and each capture's own pre-capture link.
- **Steps on the production phases.** Step 14 scores Phase D (five player-set seeds) and client-seed control on every epoch; Step 15 scores Phase E and every WTF drop; Step 18 scores Phase C at 10.00 USDT against the Phase B board, with the exact payout check at that stake; Step 9 holds all 28 settings to the Phase A floor.
- **Payout-table provenance.** Step 20 holds every cell of `plinkoConfig.json` to the saved production page read (`src/page-labels.ts`, E21). The table's `payout_tables`, `wtf_mode.odds`, `rows` and `houseEdge` are those of the `v1.0.1` file (`f8eaf67e…`); its four descriptive strings (`_source`, `platform` and the two `wtf_mode` notes) state the production basis, so its SHA-256 differs.
- **Specification.** [docs/ALGORITHM.md](docs/ALGORITHM.md) is the production revision: every DATA line and the five test vectors are measured on the production dataset by `scripts/spec-check.mjs`. `tests/plinko/rngSpecTests.ts` and `rngTests.ts` carry the production vectors.
- **Artifacts.** `outputs/simulation-results.json`: Pass 1 regenerated from its saved seed pairs (28 rows; Pass 1 reads no capture), Pass 2 on the 52 production seeds; `outputs/calibration-results.json` by `npm run calibrate`, primary window 50 nonces; `outputs/rtp-claim-table.json` by `npm run rtp-claim:write`; the three verification records by `PF_EMIT=1 npm run verify`; all pinned. `RELEASE-MANIFEST.json`: `release v1.1.0`, `supersedes v1.0.1`, stage `production`.
- **Documents.** `evidence.md`, `exploit-testing.md` and `SUMMARY.md` are extracts of this overview and of the mutation registries, written by `scripts/build-docs.mjs`; `npm test` fails if an extract and its source disagree.
- **Mutation registry** aimed at the production dataset and artifacts; `M52` covers the page-read check and `S00` is the declared survivor (see the battery paragraph).

**v1.0.1** (errata, 21 October 2026): adds `.gitattributes` (`* -text`) so a Windows git clone keeps every file byte-identical; no audit content changed.

**v1.0.0 — first public release, 21 October 2026.** A release is a signed, squashed commit with a matching tag and a `RELEASE-MANIFEST.json`; no tag is ever moved or deleted.

**Before v1.0.0.** DL-10 was closed by the convergence-chart binding in Step 16, and DL-6 (a stale sentence in a simulation artifact) no longer applied by `v1.0.0`.
