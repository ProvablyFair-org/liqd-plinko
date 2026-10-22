# LIQD Plinko — Consolidated Audit Overview

**Audit ID:** `PF-2026-LQ03` · **Auditor:** ProvablyFair.org · **Release:** `v1.0.1` (errata to `v1.0.0`, the first public release) · **Framework:** 1.1

Plinko (`gameId` `fast-games-5`) on LIQD.com, captured against `qa.liqd.com` in an authenticated browser session, currency USDC. Audited July 2026; dataset captured on **7 July 2026, 02:12–04:16 UTC**, in a single session. Publication date: 21 October 2026 (release `v1.0.0`). Report: `https://audit.provablyfair.org/casino/liqd/games/plinko/overview`. This overview consolidates the package documentation as of 4 October 2026. The machine-readable release identity (audit ID status, release, artifact hashes, verdict and scored counts) is [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass, provisional — pre-launch capture (21/21 scored steps, 0 flags, 0 hard fails).** Assessment: PASS for the audited QA dataset; certification provisional pending production validation. Every one of the 10,100 captured drops recomputes bit-for-bit from its `(serverSeed, clientSeed, nonce, rows)` inputs; the commit-reveal chain is intact across all 202 seed epochs; every paid multiplier, standard and WTF, matches the hash-pinned payout tables; and the per-config theoretical RTP sits within 1 pp of the 99% baseline (per-config edge 0.84%–1.09%), consistent with a 28,000,000-round simulation that shows no structural bias. Step 21 is informational: it can report a deviation as INFO but cannot fail, so it cannot change the verdict.

**Provisional scope.** All evidence comes from LIQD's pre-production environment (`qa.liqd.com`) prior to public launch. LIQD's live Plinko page labels the game "Released: June 2026" (read 2026-10-01, `evidence/rtp-page-labels-2026-10-01.json`), a month before this capture of 7 July 2026; this report does not establish what that label refers to, and "pre-launch" here means only that no bet was captured on `liqd.com`. The certification applies to the audited build; that `liqd.com` production serves the same game build is not established by this capture (DL-4). Production parity will be confirmed by an anonymous post-launch capture, and the certification page reflects provisional status until that verification completes.

**RTP is per configuration, not flat.** The advertised house edge is 1.00%: `houseEdge: 1` in the `currentGameSettings` string every captured bet carries, and "Edge: 1.00%" on LIQD's live Plinko page. Analytical RTP built from independent binomial probabilities ranges 98.9063%–99.1602% (mean 99.0152%); WTF sits at 98.9990%. The label is never used as evidence. The published-RTP rule (Step 10) holds every board to the 99% LIQD's page shows: 0 of 28 boards are more than 0.1 pp below it. Live-bet RTP (80.6843% across the 10,100 drops) is informational only.

**Cherry-picking is layered, not closed.** Seed **substitution** is blocked for 192 of the 202 epochs by prior publication of the hash — structural, but conditional on authentic commitment timing (DL-3). Epoch 152 is **unresolved** (DL-5a). The nine Phase D epochs 153–161 rest on statistical consistency only (DL-5), and Pass 2, which they lean on, is a synthetic fixed-board probe (DL-12). **Nothing here rules out cherry-picking across the capture as a whole.**

**What this audit does not establish.** Thirteen limitations are declared: DL-10 is closed, DL-6 no longer applies and DL-11 is fixed with a declared residual; the other ten are open. Each is in the [declared limitations register](#declared-limitations-register) with its measured magnitude, why it cannot be closed from the settled data, and where it is registered. The four that matter most to a reader:

1. **80 of the 365 payout-table cells were never paid** in the capture, including both 1000× WTF tails. They rest on our hash-pinned transcription of the operator's client bundle, not on live data, and carry **7.41%** of summed theoretical RTP — up to **29.0%** on the 15-row/high-risk board. Nothing offline can tell a correct transcription of a never-paid cell from a wrong one unless the error takes a board more than 0.1 pp below the 99% LIQD's page shows; the published-RTP rule (Step 10) catches that. The battery executes such a forgery on every run (`S00`, both 1000× tails at 990×): 17 of the 21 scored steps still pass; Step 10 detects it, and Steps 5, 16 and 17 reject it only because committed copies of the original table no longer match. *(DL-1)*
2. **The report cannot prove where the data came from.** The hash pin shows the dataset has not changed since we pinned it and the population constants show it is the population we audited, but no offline verifier can establish that LIQD served these 10,100 rounds. That rests on capture discipline. *(DL-3)*
3. **The verdict is provisional** because the capture is pre-launch (`qa.liqd.com`), and the cherry-pick position is layered: structural for 192 epochs conditional on authentic commitment timing, unresolved for epoch 152, statistical only for the nine epochs 153–161 (450 bets, $45.00). *(DL-4, DL-5, DL-5a)*
4. **Pass 2 is a synthetic fixed-board probe.** Each epoch is scored on one board — the board of its lowest-nonce bet — extended to 10,000 synthetic nonces. For the ten mixed-board Phase D epochs 152–161 that is one board out of 27, not a replay of the payout schedule those epochs played. *(DL-12)*

**In scope:** the Plinko RNG (HMAC-SHA256 draw, one bit per row from the first four digest bytes mod 2, `winningSlot` = count of `1` bits); the commit-reveal protocol (commitment, client seed, nonce, next-seed pre-commitment chain, rotation and reveal); the 27 standard multiplier tables (rows 8–16 × risk 1–3, `PLINKO_FIXED_ODDS`) and WTF (`riskLevel = 4`, rows 13, `PLINKO_WTF_ODDS`); payout integrity; RTP (analytical per-config derivation plus Monte Carlo); and eight adversarial categories, seven tested and the seed-rotation race disclosed as not tested. All are offline checks on the captured data and on our own re-implementation; no attack was attempted against LIQD's servers.

**Out of scope:** platform security (authentication, authorization, infrastructure); account systems, deposits, withdrawal processing, KYC; responsible gambling features; other games on the platform (the other LIQD fast-games and originals); the server-side RNG entropy source (unauditable without server access, mitigated by the commitment); promotional, bonus, loyalty and account-system behaviour outside the captured base-game calculations; and "Rapid Fire", an auto-bet speed feature that reuses the ordinary risk-level tables — it is not a payout mode and introduces no new odds table.

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

The dataset records one authenticated session against `qa.liqd.com`, LIQD's pre-release environment, on 7 July 2026, 02:12–04:16 UTC, in USDC. It holds **10,100 bets** in **202 revealed seed epochs** of **50 bets** each, nonces 0–49; the capture rotated the seed pair every 50 bets, and nothing in the captured records shows LIQD limiting a seed pair to 50 bets. All server seeds were revealed, so 100% of the dataset is verifiable. Recorded stakes total **$2,990.00** and reported payouts **$2,412.46**.

| Phase | Bets | Stake | Configurations | Purpose |
|---|---:|---:|---|---|
| A | 5,400 | $0.10 | All 27 standard (rows 8–16 × risk 1–3), 200 each | Full-grid coverage of every standard config |
| B | 2,000 | $0.10 | rows 16, risk 3 | Deep sample of the highest-variance standard config (WTF's per-drop spread is about three times larger) |
| C | 200 | $10.00 | rows 16, risk 3 (the Phase B board) | Stake independence at 100× the base stake |
| D | 500 | $0.10 | 10 custom `pfaudit-` client-seed epochs across standard configurations | Auditor client-seed variation |
| E | 2,000 | $0.10 | WTF (`riskLevel = 4`, rows 13) | WTF-mode payout path (`PLINKO_WTF_ODDS`) |

**Audited population as code constants.** `EXPECTED_BETS = 10100`, `EXPECTED_SEEDS = 202`, `EXPECTED_EPOCH_SIZE = 50` and `EXPECTED_PHASE_BETS = { A: 5400, B: 2000, C: 200, D: 500, E: 2000 }` live in `src/loader.ts`. Steps 11 and 12 compare the loaded data against these and reconcile the dataset's own header against them — `meta.plannedTotal`, `meta.epochSize` and `meta.phases` are evidence to be checked, never the expectation. Step 4's nonce-range check uses the same constant. A capture shrunk with its header doctored to agree, and its SHA-256 re-pinned, is a **hard fail**, not a flag: the pin proves the file has not changed since we pinned it, not that it is the capture (G-BIND — a row count is not an identity).

| Input | Identity |
|---|---|
| [data/plinko-master-10100bets.json](data/plinko-master-10100bets.json) | SHA-256 `871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95` |
| [plinkoConfig.json](plinkoConfig.json) | SHA-256 `f8eaf67e1ffc63ee0dc21123447581c55f443c167dcb451b45ab7cd108fe712f` |

These pins establish byte integrity relative to the values in the source; they do not authenticate the origin of the records. `loadDataset()` and `loadPlinkoConfig()` re-hash both at startup and abort on any single-byte change.

**How the audit was built.** The RNG, `src/rng.ts` (`commitHash`, `generateProvablyFairNumber`, `revealPlinko`; Node.js `crypto` only, no LIQD dependency), was rebuilt from a written specification, [docs/ALGORITHM.md](docs/ALGORITHM.md), by an implementer who never opened LIQD's code. The specification was written from LIQD's public pages, the standard provably-fair construction and the 10,100 captured drops, without opening LIQD's code or client bundle (its §8 lists every file and page read). Before 20 October 2026 the module was reconstructed from the LIQD client bundle; LIQD's code is not the source of the current module and is not committed in this package. The ProvablyFair.org site verifier is run as a second check (Step 5). The multiplier tables were extracted from the client bundle (`0pm_um5zrrwwn.js`, `qa.liqd.com/originals/plinko`, 2026-07-06) and pinned in `plinkoConfig.json`; that bundle chunk is not included in this package, and the tables are the auditor's transcription, not operator-supplied server source. The reference verifier was matched against LIQD's own in-game verify surface, and for every revealed epoch `SHA-256(utf8(serverSeed))` was confirmed to equal the published commitment (202/202; e.g. epoch 0 server seed `fc9a1d6f…` → commit `3b34a0fc…`). The capture then ran the five phases above in the auditor's own session. Every drop is recomputed, every paid multiplier is matched against the pinned tables, and 28,000,000 simulated rounds test RTP convergence, slot fit and serial independence.

**Client seeds.** Two forms appear. The ten Phase D epochs 152–161 used `pfaudit-<run-id>-<epoch>`, whose run-id is a millisecond Unix timestamp. The other **192** epochs — Phases A, B, C and E, plus the pre-capture record — used `audit` followed by 12 lowercase hex characters (e.g. `auditb1141320acde`): 48 bits each, all 192 distinct. The generator that produced those is not in this repository and its randomness source is not documented anywhere in this package (DL-5). The shipped `capture/` scripts are illustrative (E15): they emit `randHex(16)` (32 hex characters) or `audit-liqd-plinko-<phase>-<16 hex>`, and differ from the executed tool in config ordering (the executed tool ran contiguous rows-major blocks, not a risk-major interleave), Phase D seed naming and the recorded field schema. No credentials are committed.

### Reading a bet

The dataset has the structure `{ meta, seeds, bets }`. Join a bet's `hashedServerSeed` to the matching entry in `seeds` to obtain the revealed `serverSeed`. Each bet stores 17 API response fields plus 6 capture-added fields (23 in total); the verification-relevant subset is fixed in `src/types.ts` (`Bet`).

| Fields | Interpretation |
|---|---|
| `id`, `nonce`, `clientSeed`, `hashedServerSeed`, `serverSeedId` | Bet identifier (e.g. `SLOjmT9dyuUEi1que576R`) and RNG inputs; `serverSeedId` is an opaque id linking the bet to its epoch. |
| `numberOfRows`, `riskLevel` | Board selection echoed from the request: rows 8–16 (13 for WTF); risks 1–3 are low, medium, high; risk 4 is WTF. |
| `dropDetails`, `winningSlot` | Per-row bit string (`'0'` = left, `'1'` = right, e.g. `01101111`) and landing slot 0…rows, equal to the count of `1` bits. |
| `multiplier`, `coefficient`, `betAmount`, `winningAmount` | Recorded payout values; amounts are full-precision decimal strings; `winningAmount` is the credited win. |
| `result`, `createdAt` | `won` / `lost` label and ISO 8601 timestamp. |
| `epoch`, `phase` | Capture grouping labels consumed by verification and constrained by population, nonce and seed-join checks (premise P6). |
| `localPath`, `localSlot`, `verified`, `seeds[].commitVerified`, `seeds[].chainLinkOk` | Capture self-check fields. No scored step reads them; the checks recompute these properties independently. |
| `currentGameSettings` | JSON string: `minBet`, `maxBet`, `maxProfit`, `minOdds`, `maxOdds`, `houseEdge`. It holds limits and a house-edge label, not the payout tables. |

A representative `currentGameSettings` payload, identical on all 10,100 bets: `{"minBet":0.1,"maxBet":62500,"maxProfit":250000,"minOdds":1.01,"maxOdds":10000,"houseEdge":1}`. The dataset's `won` label means `multiplier ≥ 1`: the 751 drops that push at exactly 1.0× are labelled `won`, so `result == 'won'` holds for 2,753 bets, whereas strict profit (`winningAmount > betAmount`) holds for 2,002. Payout verification uses the amount fields directly, and the informational lag-1 autocorrelation in `tests/steps/statistical.ts` binarises on strict profit, not on `result`.

## Game and algorithm

A Plinko board has a selectable number of rows. On an `N`-row board the ball makes `N` independent left/right bounces, each a single bit, and lands in one of `N + 1` slots indexed `0 … N`: the landing slot is the **count of right-bounces**. Edge slots pay the most and are the hardest to reach. The bounce sequence is derived cryptographically from the client seed, the server seed and the bet nonce, so it can be reproduced after the fact.

### Configurations and payout tables

**Standard mode:** rows 8–16 × risk levels {1 = LOW, 2 = MEDIUM, 3 = HIGH} = **27 configurations**. Risk controls the multiplier spread only, not the physics: higher risk pushes more payout into the rare edge slots and pays less in the centre. Multipliers come from `PLINKO_FIXED_ODDS`, indexed `[rows][riskLevel][winningSlot]` (in `plinkoConfig.json`: `payout_tables[String(rows)][riskLevel − 1][slot]`; `rows: {min: 8, max: 16}`). The 8-row tables:

| Risk | Slot 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 1 (LOW) | 5.6 | 2.1 | 1.1 | 1 | 0.5 | 1 | 1.1 | 2.1 | 5.6 |
| 2 (MEDIUM) | 13 | 3 | 1.3 | 0.7 | 0.4 | 0.7 | 1.3 | 3 | 13 |
| 3 (HIGH) | 29 | 4 | 1.5 | 0.3 | 0.2 | 0.3 | 1.5 | 4 | 29 |

**WTF mode** is a first-class fourth risk level (`riskLevel = 4`), not a cosmetic skin; the risk-level table is `{ LOW: 1, MEDIUM: 2, HIGH: 3, WTF: 4 }`. WTF forces 13 rows (14 slots; `wtf_mode.rows = 13`, and `src/config.ts` `payoutTable` throws on any other row count) and uses a dedicated table, `wtf_mode.odds`:

```text
PLINKO_WTF_ODDS = [1000, 235, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 235, 1000]
```

Only 4 of the 14 slots pay: the outermost two at 1000× and the next-in two at 235×. The bounce derivation is identical to the standard game; WTF changes only the row count and the payout table. All 28 tables (27 standard plus WTF) are left/right symmetric, `table[k] == table[rows−k]`, mirroring `C(rows, k) = C(rows, rows−k)`. **Rapid Fire is not a payout mode:** it fires drops in quick succession using the ordinary risk-level tables.

The tables are calibrated to a `0.99` baseline; the runtime scaling `(1 − houseEdge/100)/0.99` collapses to `1.000` at the launch 1.00% edge, so the published table value is exactly the paid multiplier.

### API and seed lifecycle

All calls target `https://qa.liqd.com/api/v1`, authenticated by the browser session's cookies (Cloudflare Access gate plus application login); no additional device or bot-protection header was required.

| Endpoint | Role |
|---|---|
| `GET /fast-games/provably-fair/active` | Active pair: `activeServerSeedHash` (commitment, published before any bet), `nextServerSeedHash` (pre-commitment for the next seed), `clientSeed`, `nonce`. Read at each phase start and on resume. |
| `POST /fast-games/plinko-game/place-bet` | Body `{"betAmount": 0.10, "currencyCode": "USDC", "clientSeed": "auditb1141320acde", "riskLevel": 1, "numberOfRows": 8}`. For WTF the server forces `numberOfRows = 13`. |
| `POST /fast-games/provably-fair/rotate` | Body `{ "clientSeed": "<new_client_seed>" }`. Response (shape confirmed 2026-06-29): `revealedServerSeed` (plaintext of the retiring epoch), `activeServerSeedHash`, `nextServerSeedHash`, the echoed `clientSeed`, `nonce: 0`. The client seed is generated by the player's browser before the call; the server echoes it and does not assign it. |
| `GET /fast-games/system/get-game-settings` | LIQD's game-settings endpoint. No response from it is in this package and the capture scripts do not call it, so this report does not show what it returns. |

**Lifecycle.** (1) Before the first bet of each phase, the capture reads the active pair and records the active and next commitments and the client seed. (2) 50 bets are placed; each response carries `nonce` 0…49 and the epoch's constant `hashedServerSeed` and `clientSeed`. (3) After the 50th bet the capture snapshots the pre-rotation state, rotates with a fresh browser-generated client seed, and stores `revealedServerSeed` beside the pre-rotation hashes, so the verifier can check both hash integrity and chain continuity. (4) The promoted pair becomes active. Rotation N, submitting client seed N, returns the commitment for N+1.

**Pre-capture link.** Before epoch 0 the capture recorded `meta.preCapture`: the commitment in force at the start of the session, its later plaintext reveal and its `nextHashedServerSeed`. `SHA-256(utf8(preCapture.revealedServerSeed)) == preCapture.hashedServerSeed`, and `preCapture.nextHashedServerSeed == seeds[0].hashedServerSeed`. This is the evidence that epoch 0's server seed was committed before the first captured bet, which the epoch-to-epoch chain alone does not show; Step 2 scores it as the 202nd pre-commitment. Equality is computationally verifiable; the real-world ordering of capture events relies on the collection records.

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
multiplier  = standard: PLINKO_FIXED_ODDS[rows][riskLevel][winningSlot]
              WTF:      PLINKO_WTF_ODDS[winningSlot]
```

This is the algorithm as [docs/ALGORITHM.md](docs/ALGORITHM.md) §1.2–§3 writes it; `src/rng.ts` implements it, and §4 there names the source of every step (LIQD's public pages, the standard construction, or the 10,100 captured drops).

- **Commitment** hashes the 32-character hex *string* (its ASCII bytes, the same bytes as UTF-8), not the 16 decoded bytes (the Stake convention), confirmed against all 202 revealed seeds and the pre-capture seed.
- **Key encoding** is the 16 decoded bytes, deliberately distinct from the commitment.
- **Message** is `clientSeed`, `nonce` and `cursor` joined by literal colons, in plain base 10 with no padding; the four bytes are read big-endian.
- **Cursor is per row:** `cursor` runs `1 … rows`, one fresh HMAC per row, one bit per HMAC. Row count sets only the loop length and risk only selects the table; neither seeds the bit stream, and stake is not an input.
- **No rejection step.** The bit is `u mod 2` over the whole 2^32 domain; 2 divides 2^32, so each bit value has exactly 2^31 preimages and the draw is exactly unbiased. Only the first 4 bytes of each per-row digest are consumed. Step 5 checks this on the module itself (`src/bias.ts`): on every row of every recomputed drop the path bit equals the range-2 draw, and that equals the full 32-bit draw mod 2. Before 20 October 2026, `src/rng.ts` carried the rejection rule of LIQD's general draw helper as reconstructed from the client bundle (chunks at or above `floor(2^32 / range) × range` rejected, a retry at cursor + 1,000,000 when all eight were); for range 2 that rule rejects nothing, so it never changed a Plinko bit, and the rebuilt module does not have it.
- **No external entropy.** No drand beacon, block hash or VRF participates; `revealPlinko` reproduces all 10,100 captured paths and slots from `(serverSeed, clientSeed, nonce, rows)` alone.

LIQD's in-game PF panel exposes a server-side verifier taking `(serverSeed, clientSeed, nonce, rows, riskLevel)` and returning path and slot; the dependency-free `src/rng.ts` reproduces the captured outcomes offline, so a player need not trust the operator's verifier. No reply of that verifier is captured in this package, so it is not one of the checks run here. **LIQD did not publish the byte-level algorithm:** when this audit was written, the footer "Provably Fair" link resolved to a dead anchor and `/fairness`, `/provably-fair` and `/how-it-works` all returned 404. On 20 October 2026 `liqd.com/provably-fair` was live and names HMAC-SHA256, the three inputs and "count the rights", but not the key form, message format, cursor base or bit rule ([docs/ALGORITHM.md](docs/ALGORITHM.md) §6, O1); those rest on the standard construction and the captured drops. Publishing the byte-level spec is the top operator recommendation (P1).

**Trust boundary.** The active server seed and the RNG execution are server-held until reveal. Before a bet the player can observe the commitment, the next-seed pre-commitment, the editable client seed and the nonce. After reveal the player can verify `SHA-256(utf8(revealedServerSeed))` against the committed hash (Step 1), recompute path and slot (Step 5) and check the multiplier against the table (Step 7). Because the server published the commitment before any bet under the pair, it cannot swap in a different server seed afterwards without breaking it.

## Payouts and RTP

### Settlement and table conformance

For landing slot `s`, the paid multiplier is a direct table lookup — `PLINKO_FIXED_ODDS[rows][riskLevel][s]` or `PLINKO_WTF_ODDS[s]` — and `winningAmount = betAmount × multiplier`. The audit verifies the credited `winningAmount` field. Step 7 confirms `multiplier == payoutTable[winningSlot]` at 1e-9 using the recorded `winningSlot`, which Step 5 independently binds to the seed-derived slot (the binding to the recomputed outcome holds transitively via Step 5, not within Step 7 itself); Step 8 confirms `winningAmount == betAmount × multiplier` exactly, in integer 1e-8 settlement units, with finite operands required. Together they bind the credited amount to the seed-derived outcome: 10,100/10,100 multipliers match, 0 mismatches; 10,100/10,100 amounts reconcile, 0 off the grid, 0 errors, including the $10 Phase C stakes. No undisclosed deduction, rake or rounding leakage is present. The LIQD bet response carries no running wallet-balance field, so the credit cannot be cross-confirmed against a balance delta (DL-8).

| Bet ID | Phase | Rows / risk | Path | Slot | Multiplier | Stake | Credited | Stake × multiplier |
|---|---|---|---|---:|---:|---:|---:|---:|
| `SLOjmT9dyuUEi1que576R` | A, epoch 0 / nonce 0 | 8 / 1 | `01101111` | 6 | 1.1 | 0.10000000 | 0.11000000 | 0.11000000 |
| `Fj4Kfh41bSVPiGZgcHPWn` | A, epoch 0 / nonce 49 | 8 / 1 | `00010110` | 3 | 1 | 0.10 | 0.10 | 0.10 |
| `VKKaYIxBU4NPLU_vc01v9` | A | 8 / 3 | `00000000` | 0 | 29 | 0.10000000 | 2.90000000 | 2.90000000 |
| `xrCFhXxywfY7R9_O9gMLK` | B | 16 / 3 | `1111111111011111` | 15 | 130 | 0.10000000 | 13.00000000 | 13.00000000 |
| `GPo6VRX5ozyp8mZABG3ag` | C, epoch 148 / nonce 0 | 16 / 3 | `1111010101001110` | 10 | 0.2 | 10.00000000 | 2.00000000 | 2.00000000 |
| `b1Ot4NpfMzpQe4ku9cZ7O` | D, epoch 161 / nonce 47 | 11 / 3 | `11111111111` | 11 | 120 | 0.10000000 | 12.00000000 | 12.00000000 |
| `tTrs85fv3NF028ROZv0WQ` | E, epoch 162 / nonce 0 | 13 / 4 | `1000100111001` | 6 | 0 | 0.10 | 0.00 | 0.00 |
| `2tGmOv7FZHfyCwhX7yCS3` | E, epoch 175 / nonce 32 | 13 / 4 | `1111101111111` | 12 | 235 | 0.10000000 | 23.50000000 | 23.50000000 |

`b1Ot4NpfMzpQe4ku9cZ7O` lands the edge slot of the maximum-RTP board (11r/3, 120×); `GPo6VRX5ozyp8mZABG3ag` is a $10 bet on a 0.2× centre slot, and its credited $2.00 confirms identical payout arithmetic at 100× the stake. `0.10 × 1.1` evaluates to `0.11000000000000001` in IEEE-754; the comparison is made in grid units, not on the double, and the credited string is `0.11000000`. The symmetric 29× edge pair on 8r/3 — `VKKaYIxBU4NPLU_vc01v9` (`00000000`, slot 0) and `U10OkvkfU3FwjCy17z3tC` (`11111111`, slot 8) — landed in the same epoch under seed `0d4d79f7eb58d2831817a81415a1fd2f`.

**Table precision and coverage.** Multipliers are stored at the platform's native precision: one or two decimals on standard boards, integers on WTF. Because the tables are exact rationals, the theoretical RTP built from them is deterministic, and the 0.254 pp spread across boards (98.90625% to 99.16016%) is a property of the published values, not measurement noise. The capture exercised **285 of 365** table cells (78.1%). The 80 never-paid cells, including both WTF 1000× tails, carry **7.4086%** of summed theoretical RTP, and **28.9685%** (15r/3), **24.9497%** (14r/3) and **24.6609%** (WTF) of those boards' RTP; roughly a quarter of the WTF return is transcription-only (DL-1, emitted per config in `outputs/coverage-results.json`). Observed spans: 8 rows `[0, 8]` across the 600 Phase A bets, both edges reached; 16r/3 `[2, 15]` across Phase B. The 16-row 1000× edges (probability 2⁻¹⁶ each, about once per 65,536 drops) did not appear in the 2,854 sixteen-row bets and rest on the pinned table (`PLINKO_FIXED_ODDS[16][3][0] = 1000`). In the 2,000 WTF bets the observed span was `[1, 12]`: 6 paid, all at 235× on slot 1 or 12, and the 1000× slots (each about 1 in 8,192, expected count ≈ 0.24) did not occur. The 28,000,000-round simulation exercises those cells as transcribed, not the operator's live table, so the suite cannot confirm them; a targeted deep-tail WTF capture is a disclosed future item (A1, R-BRACKET).

**WTF risk profile.** Only 4 of 14 slots pay: **P(zero payout) = 99.6582%** per drop and P(paying slot) = 0.3418% (emitted in the Step 15 detail). A player treating WTF as merely "a higher risk level" loses the entire stake on roughly 299 of every 300 drops, with the RTP carried almost entirely by the 1000× and 235× slots.

### Theoretical RTP

Each row is an independent Bernoulli(0.5) trial, so slot `k` on an `n`-row board has the exact binomial probability, computed from first principles in `src/config.ts` (`binomP`, `theoreticalRTP`) and never taken from any LIQD-supplied table:

```text
P(slot = k)  = C(n, k) / 2^n
RTP(n, risk) = Σ_k C(n, k) × payout[k] / 2^n
house edge   = 1 − RTP
```

The binomial masses sum to 1.0 exactly for every row count (max deviation 0, `steps.step13.maxAbsSumMinusOne` in `outputs/verification-stats.json`). For the 16-row board, sampled 2,854 times across Phases A–D (600 + 2,000 + 200 + 54):

| Slot pair | 0, 16 | 1, 15 | 2, 14 | 3, 13 | 4, 12 | 5, 11 | 6, 10 | 7, 9 | 8 (centre) |
|---|---|---|---|---|---|---|---|---|---|
| P(slot) each | 0.001526% | 0.024414% | 0.183105% | 0.854492% | 2.777100% | 6.665039% | 12.219238% | 17.456055% | 19.638062% |

Example: the 8-row low-risk table `[5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6]` with binomial weights `[1, 8, 28, 56, 70, 56, 28, 8, 1]` gives a weighted payout sum of 253.4, and 253.4 / 256 = 0.98984375, or 98.984375% RTP.

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

| Statistic | Value | Configuration |
|---|---|---|
| Minimum RTP | 98.90625% | rows 8 risk 2 and rows 10 risk 2 (tie, exactly 98.90625%) |
| Maximum RTP | 99.16016% (99.16015625%) | rows 11, risk 3 |
| Equal-weighted mean RTP | 99.0152% (99.0152413504464%) | all 28; mean house edge 0.9847586495536% |
| WTF RTP | 98.9990% (98.9990234375% = (2 × 1000 + 2 × 13 × 235) / 8192) | rows 13, risk 4 |
| House-edge range | 0.83984375%–1.09375% | — |
| Max deviation from 99% | 0.1602% | rows 11, risk 3 |

The minimum and maximum rows are taken from the Step 10 argmin/argmax lists in the verification record, not hand-derived. These are configuration averages, not a forecast for an unspecified betting mix. Every configuration sits within 1 pp of the 99% baseline; the spread exists because integer and decimal multipliers cannot hit 99.0000% exactly at every row count.

**Model anchors.** Every modelled headline number has an anchor from outside the engine's own method:

| Modelled figure | Anchor method | Tolerance | Enforcing test |
|---|---|---|---|
| Per-config RTP range and mean | Exhaustive enumeration of all `2^rows` equally likely paths (popcount → slot, pure counting) cross-checking the binomial RTP; a counting enumeration cannot share an arithmetic error with the closed form. Committed run: max difference 8.76e-13 (`steps.step10.enumerationWorstDelta`), a hard FAIL above tolerance | 1e-12 | `tests/steps/payouts.ts` (Step 10) |
| Published min / max / mean / WTF figures | Full-precision pins on exact rationals (Σ table[k]·C(rows,k)·2^-rows; not all dyadic — e.g. 633/640, 5077/5120 — hence 1e-12 rather than exact float equality); the mean pin equals the simulation artifact's `meanTheoreticalRTP` | 1e-12 | `tests/plinko/rtpPinTests.ts` |
| WTF zero-payout probability 99.6582% | Independent binomial over the WTF odds vector, outside the payout path | 1e-12 | `tests/plinko/rtpPinTests.ts`, `tests/steps/wtf.ts` (Step 15) |
| Calibrated null for the Pass 2 payout-weighted count — primary 50-nonce window (expectation 1.4099, P(X≥1) = 0.7603) and extended 5,000-nonce window (expectation 5.8556, P(X≥6) = 0.5337) | Exact lattice convolution of the per-drop payout distribution at each window length, anchored by (a) a closed-form multinomial sum at the full 5,000-drop window on WTF and (b) brute-force enumeration of every payout sequence at small windows | 1e-9 relative (closed form); exact (brute force); 5·SE against simulated windows (150,000 on 8 rows / low risk, 100,000 on 16 rows / high risk) | `tests/plinko/calibrationTests.ts`, `tests/steps/simulation.ts` (Step 17) |
| Slot probabilities against the binomial model | A literal path count over the board rather than the modelled distribution, so a binomial-coefficient error is inexpressible in it | Exact integers | `tests/steps/anti-circularity.ts` (Step 13) |

**Declared anchor residuals.** The oracle and the engine share one reading of the rules — fixed row count, independent left/right steps, popcount to slot, lookup by slot — so a misreading of the rules would move both together. Both also read the same `plinkoConfig.json`, a hand-transcription of the operator's client bundle; the pin locks our transcription, not the operator artifact, and if a cell was transcribed wrong, model and enumeration agree on the expected value of the wrong table. LIQD publishes no payout-table spec page and there is no third-party RTP for this operator, so the enumeration anchors the *math*, not the *table*. The enumeration was written by the same audit team; its defence is architectural, not organisational.

### The published-RTP rule

LIQD's live Plinko page shows one figure for every board: "Released: June 2026 | Edge: 1.00%", an RTP panel reading "99% on every board", and the answer "Does the number of rows change the RTP? No. Every combination of rows and risk returns 99%." (read 2026-10-01, logged out, in a headless browser; `evidence/rtp-page-labels-2026-10-01.json`, exhibit E19). Taken literally that is not true: no board returns exactly 99.00%; 15 of the 28 return less and 13 return more.

RTP-CLAIM (rule 1.0.0 agreed 2026-09-29; 1.1.0, which adds the "no claim" case, agreed 2026-10-01; 1.2.0, Methodology v1.1, agreed 2026-10-14; code in `src/rtp-claim.ts`, a byte-identical copy of the framework's) holds a game to the figure it shows players. For a flat figure, every board must return within **0.1 pp** of it: a board more than 0.1 pp **below**, on the house side, fails; a board above is player-favourable and never fails. It is **enforced** in this package since 2026-10-01 (`src/rtp-claim-switch.ts`) and scored on Step 10: under 1.2.0 a miss marks Step 10 RTP FIGURE OVERSTATED and makes the verdict RTP FIGURE OVERSTATED (exit 5), not a hard fail (until 2026-10-14, under 1.1.0, it was a hard fail). The claim's source names the game page, one of the six places 1.2.0 recognises. Step 10 fails if the committed per-board table, `outputs/rtp-claim-table.json` (pinned in `src/rtp-settings.ts`), no longer equals the table the run computes. The claim held is the page's flat 99%, the same figure as `"houseEdge": 0.01` in `plinkoConfig.json`, and each board's RTP is computed exactly as a rational, with no floating point.

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
| 13 rows, WTF | 4055/4096 | 98.999023% | −0.000977 | within 0.1 pp |

What the rule can and cannot see: it catches any table error that takes a board more than 0.1 pp below 99%, whether or not the error is in cells the capture paid. Declared survivor `S00` (both WTF 1000× tails mis-transcribed as 990×) takes the WTF board to 8090/8192, under 98.8%, and Step 10 fails on it even when the table and its pin are regenerated from the wrong config. An error that keeps every board within the band — changing the tails to 997× would leave the WTF board at 8104/8192, above 98.9% — or moves a board in the player's favour, passes. Mutation `M51` raises the claim to 99.02% and Step 10 fails, because rows 8 and 10 medium then sit more than 0.1 pp below it.

### Simulation

**Pass 1 — RTP convergence and slot uniformity.** Fresh per-config server/client seed pairs (`crypto.randomBytes`) are generated at runtime and each of the 28 configurations is simulated for 1,000,000 rounds: **28,000,000 rounds** (`src/simulate.ts`). Each config's running mean RTP is sampled every 50,000 rounds and rendered as a per-config convergence trace in `outputs/rtp-convergence.html`. Because Pass 1 draws fresh seeds every run, the simulated RTP and the uncorrected flag counts vary within sampling noise and are not quoted as fixed values; the authoritative RTP is the deterministic theoretical mean, 99.0152%. Any given run is reproducible from the seed pair stored in each row, and since 2026-09-24 scored Step 16 replays the committed run in full on every `npm test`.

- **Chi-squared** (`df = rows`): 0/28 configs fail at the Bonferroni threshold α/28 = 3.5714e-4. The uncorrected α = 0.01 count is not the scored figure.
- **Serial independence** (lag-1 autocorrelation, reported beside the Wald-Wolfowitz runs *z*): 0/28 fail at Bonferroni; about 1.4 uncorrected α = 0.05 flags are expected by chance across 28 tests. These are **not two independent tests**: on this binarisation the runs *z* is the lag-1 *z* with the sign reversed — over the 28 committed rows `corr(r₁z, runsZ) = −0.999999964` and `max |r₁z + runsZ| = 1.65×10⁻³` (`steps.step16.serialR1ZRunsZCorrelation`, `steps.step16.serialMaxAbsR1ZPlusRunsZ`). The family is 28 tests, not 56, which is why a clean fresh run trips Step 16 about 1 time in 50 rather than 1 in 33: 1 − 0.99² = 1.99%.

**What one million rounds can and cannot resolve.** Step 16 passes a board whose simulated RTP is within 6 standard errors of its exact theory. On WTF the per-drop payout standard deviation is 20.46× the stake (`byConfig[].sd` for 13 rows / risk 4 in `outputs/calibration-results.json`), about three times the largest standard board's (16 rows / risk 3), so one standard error of WTF's simulated RTP is about 2 pp and the 6-SE band about ±12 pp. A one-million-round simulation cannot resolve a 1% edge on WTF; WTF's RTP rests on the exact calculation (98.9990%).

**Pass 2 — a synthetic fixed-board probe (DL-12).** Pass 2 measures a property of each revealed server seed's payout stream **on one stated board**. Each of the 202 captured casino seeds is evaluated on the board of that epoch's **lowest-nonce bet** (`boardOfEpoch` in `src/calibration.ts`), an explicit nonce rule chosen so the result cannot depend on record order, extended to 10,000 nonces and split into an early and a late window at two lengths:

- **Primary, scored — 50 nonces**, what was played under each server seed in this capture (early 0–49, late 50–99). For the 192 single-board epochs every early-window drop was observed. `outputs/calibration-results.json` is calibrated for this window at its top level.
- **Extended, reported — 5,000 nonces** (0–4,999 / 5,000–9,999). It has far more power against a seed biased across its whole stream, but 5,000 drops is a hundred times what was played under any seed here, so it is reported, not scored; its calibration is the artifact's `extendedWindow` block.

192 of the 202 epochs carry exactly one board, so the board rule is vacuous for them. The ten Phase D epochs 152–161 each spread 50 bets across all 27 standard boards, so for those the probe evaluates one board out of 27 and is not a replay of the mixed-board payout schedule played; nonces 50–9,999 are a hypothetical continuation, not observed play. Different boards evaluated on the same (seed, nonce) are **not independent** — their RNG paths share row prefixes — so they must not be pooled as separate observations. The predictable-seed epochs, where an operator would have the cherry-pick opportunity and Pass 2 tests a live hypothesis rather than the null, are exactly the ten mixed-board epochs where the probe is weakest (`A4c`). The rule was previously "the first bet encountered in file-array order"; reversing the in-memory bet array moved epoch 152 from 8r/1 to 15r/2 and epoch 161 from 14r/1 to 12r/2 and changed the selection in all eight epochs between. On the committed capture the two rules agree on all 202 epochs (bets are stored in nonce order), so no published figure changes.

Two statistics. The **slot chi²** fits each window *separately* against the independent binomial (same tail-merge rule as Pass 1) — the windows are never compared to each other — and flags a seed on the conjunction `earlyP < 0.05 AND lateP ≥ 0.05`. The **payout-weighted window-RTP z-test**, the economically relevant statistic, compares each window's RTP against its exact per-config mean and standard deviation, merges nothing, and compares the two windows directly, as a count and as a paired early−late t.

| Metric | Window | Value |
|---|---|---|
| Casino seeds / nonces per seed | — | 202 / 10,000 |
| **Payout-weighted: seeds below z = −1.645** | **Primary (50, scored)** | **1 of 202** (calibrated expectation 1.4099 ± 1.1721, Poisson-binomial P(X≥1) = 0.7603) |
| **Payout-weighted: early−late paired t** | **Primary (50, scored)** | **−0.19** |
| Payout-weighted: seeds below z = −1.645 | Extended (5,000) | 6 (calibrated expectation 5.8556 ± 2.3708, P(X≥6) = 0.5337) |
| Payout-weighted: early−late paired t | Extended (5,000) | 0.60 (two-sided p = 0.5518) |
| Slot chi² flags (`earlyP < 0.05 AND lateP ≥ 0.05`) | Extended (5,000) | 11 vs 9.595 expected by chance, survival P = 0.3652, on a null that assumes the tail-merged chi² has size exactly 0.05 |

Both statistics are within noise: no early-window anomaly on this probe, at this power, under this model. A statistical non-rejection is not proof that bias is absent, and nothing here supports a claim of casino exploitation or rules one out. Both are re-executed from the committed seeds and attested within 1e-9 by Step 17.

**Calibrated null, not 0.05·n.** A window payout sum is heavily right-skewed, so the left-tail probability is config- and window-specific and the naive 0.05·n = 10.1 is the wrong comparison at either window. At the **primary** window the per-configuration left-tail probability ranges from 0.0002% (9 rows / risk 3) to 4.1307% (14 rows / risk 1) across the 20 configurations with any power, and is exactly 0 on the other eight — 10r/3, 11r/3, 12r/3, 13r/3, WTF (13r/4), 14r/3, 15r/3 and 16r/3 — because the z = −1.645 threshold falls below the smallest window RTP 50 drops can produce. Those eight carry 115 of the 202 epochs: the count is a coarse screen with no power over more than half the population, and the paired early−late t, not the count, is the load-bearing statistic at this window. At the **extended** window the count has power everywhere: 2.5599% for WTF (40 epochs), 0.1893% for 16 rows / risk 3 (49 epochs), and 1.1790% to 4.9317% across the remaining 26 configurations. `npm run calibrate` (`src/calibrate.ts`) writes these figures by exact lattice convolution, and Step 17 recomputes them over the dataset's own epoch population and fails on disagreement.

**The slot-flag null is nominal (DL-2).** `expectedFlagsByChance = 9.595` is `202 × 0.05 × 0.95`. Independence of the two windows holds (disjoint nonce ranges), but the size of the discrete, tail-merged chi² at 5,000 draws is near, not equal to, 0.05 and depends on the board. That size is not measured in this repository, so 9.595 and P = 0.3652 are nominal figures. The correction is immaterial at these counts — 11 against ~9.6 is not a signal at any plausible size near 0.05, and the exactly calibrated payout-weighted statistic agrees — and measuring it is recommendation `A4b`. Step 21, which uses the same tail-merge rule, inherits the caveat.

**Live-bet statistics, informational only.** Live RTP across the 10,100 drops is **80.6843%** ($2,412.46 / $2,990.00). Per-config samples are small and uneven (26 of the 28 configs have about 218 bets each; 16r/3 has 2,418 and WTF 2,000), and Phase C/E variance and unrealised rare high-multiplier tails dominate, so the figure is variance illustration, not RTP evidence. Live slot frequencies are informational for the same reason: at about 200 bets per standard config the edge slots have expected counts far below 1, while Pass 1 tests slot distributions at 1,000,000 rounds per config. Lag-1 autocorrelation is **r₁ = 0.0899**; it reflects between-config composition, not within-config dependence, because the capture runs in contiguous config blocks whose strictly-profitable rate (multiplier > 1) ranges from 0.3000% (WTF) to 45.8716% (16 rows / risk 1), or 0.3000% to 81.1927% on the dataset's `result == "won"` definition (multiplier ≥ 1). Within each configuration, 1 of 28 configs exceeds |z| > 1.96, against about 1.4 expected by chance. The authoritative independence evidence is the Pass 1 serial test.

## Verification results

The verifier scores **21 steps: 21 PASS, 0 flags, 0 hard fails — PROVABLY FAIR — Full Pass**, over the 10,100 rounds captured on 7 July 2026 and the pinned tables. EC-*n* is Step *n*; the numbering is per audit. Eighteen steps carry hard-fail weight (1–8, 10–13, 15–20). Steps 9 and 14 (capture-design checks) can only FLAG. Step 21 is informational under the profile policy decided 2026-09-29: it reports PASS or INFO, never FLAG or FAIL, so it cannot change the verdict. Steps 11 and 12 moved from FLAG-only to hard-fail in revision 4, when the audited population was bound to code constants: a withheld population is not a disclosable irregularity, it is a different audit.

| Step | Check | Result and scope |
|---:|---|---|
| 1 | Seed hash integrity | PASS: 202/202 revealed seeds satisfy `SHA-256(utf8(serverSeed)) == hashedServerSeed`, 0 mismatches; the count is checked against `EXPECTED_SEEDS`, not the dataset's own seed count |
| 2 | Next-seed pre-commitment chain | PASS: 202/202 pre-commitments — 201 epoch transitions plus the pre-capture link. The basis for the structural substitution tier, conditional on authentic commitment timing (DL-3 / P1); it does not speak to grinding against a predictable future client seed (DL-5a, DL-5) |
| 3 | Hash consistency within epoch | PASS: every bet in each of 202 epochs shares one `hashedServerSeed`; 0 violations — no mid-epoch seed switching |
| 4 | Nonce audit | PASS: 202 epochs sequential 0–49 against `EXPECTED_EPOCH_SIZE` (not `meta.epochSize`), one client seed per epoch, 0 gaps, 0 repeats |
| 5 | Path + slot recomputation | PASS: 10,100/10,100 recorded paths and slots reproduced by `src/rng.ts` (rebuilt from [docs/ALGORITHM.md](docs/ALGORITHM.md)), 0 mismatches, 0 skipped; bit-extraction bias bound 0 at range 2, with the census of `src/bias.ts` on every row draw. This, not Step 6, is the comparison against the outcomes the operator recorded (`M27` regenerates 200 recorded paths from another client seed and must be rejected). The site verifier also runs here: 4/4 pins, 10,100/10,100 bets, paytable 365/365 cells |
| 6 | Client seed influence, measured locally | PASS: 1,008/1,010 sampled bets change path under a wrong client seed; the 2 coincidences are scored against the exact null, Σ 2^−rows = 0.5425262451171875 expected, Poisson-binomial P(X ≥ 2) = 0.10318193106557218 against α = 1e-3 |
| 7 | Multiplier lookup (incl. WTF) | PASS: 10,100 bets at 1e-9, 0 mismatches. Paid multipliers only: 285/365 cells exercised; the other 80 rest on the transcription (DL-1, `S00`) |
| 8 | Payout math | PASS: 10,100 bets reconciled exactly in integer 1e-8 units — no tolerance on money; 0 amounts off the grid, 0 errors |
| 9 | Config completeness | PASS: 27/27 standard configs plus WTF; Phase A has 200 bets per standard config against the 50-bet floor `MIN_PHASE_A_BETS_PER_CONFIG` |
| 10 | House edge / RTP (per-config) | PASS: 28 analytical RTPs, each cross-checked by exhaustive path enumeration (8.76e-13 against 1e-12); min 98.90625% (8r/2, 10r/2), max 99.16016% (11r/3), edge span 0.83984%–1.09375%. Published-RTP rule: 0 of 28 boards fail, worst −0.09375 pp (`M51` raises the claim to 99.02% and must fail) |
| 11 | Phase labels | PASS: A=5,400, B=2,000, C=200, D=500, E=2,000 against `EXPECTED_PHASE_BETS`; 10,100 bets and 202 seed records against code constants; the header (`meta.plannedTotal`, `meta.phases`) is reconciled, not believed |
| 12 | Epoch size | PASS: 202 epochs, min = max = 50 against `EXPECTED_SEEDS` and `EXPECTED_EPOCH_SIZE`, with `202 × 50 = 10,100` asserted; this shows the capture ran as planned, not a LIQD limit |
| 13 | Anti-circularity | PASS: rows 8–16, `binomP(n,k)·2^n` equals the exact `C(n,k)` from an independent Pascal recurrence on every coefficient and the masses sum to 1.0; both residuals 0. No operator data used |
| 14 | Phase D client-seed variation | PASS: 500 bets, 10 distinct client seeds, 500/500 recompute. Epoch 152 unresolved (DL-5a); epochs 153–161 used seeds the operator already held: 450 bets, $45.00 wagered, $49.74 paid — a description of what happened, not a demonstration of containment |
| 15 | Phase E WTF | PASS: 2,000/2,000 drops are risk 4 / 13 rows, paths recomputed and multipliers equal to `odds[slot]`; WTF RTP 98.9990%; P(zero payout) 99.6582% |
| 16 | Simulation Pass 1 | PASS: 28 × 1,000,000 rounds; chi² 0/28 and serial 0/28 at Bonferroni α/28 = 3.571e-4; theory recomputed from the pinned config (28/28 at 1e-12) and `simRTP` within 6 SE of it; the committed experiment replayed in full, 784 figures compared, 784 bit-identical; the chart re-rendered byte for byte |
| 17 | Simulation Pass 2 | PASS: 202 seeds × 10,000 nonces, all 202 epochs re-executed; slot flags 11 vs 9.595 nominal (P = 0.3652); payout-weighted primary window 1 below z = −1.645 vs 1.4099 calibrated (P(X≥1) = 0.7603), t = −0.19; extended window 6 vs 5.8556 (P(X≥6) = 0.5337), t = 0.60 |
| 18 | Bet-size invariance | PASS: 200/200 Phase C $10 drops on 16r/3 — the Phase B board, so bet size is the only variable that moved — recompute path and slot; stakes present are exactly {$0.10, $10.00}; other stakes were not captured |
| 19 | Multiplier table symmetry | PASS: all 28 tables satisfy `multiplier[k] == multiplier[rows−k]`, 0 asymmetric — no side of the board is quietly under-paid |
| 20 | Artifact hash + value-domain integrity | PASS: dataset `871c485e…` and config `f8eaf67e…` match their pins; every published 64-hex token in the Markdown equals a pin, an exhibit hash or a worked-example commitment; 835 numeric leaves of the two emission artifacts lie in domains derived from the pinned config |
| 21 | Epoch-window slot fit (informational) | PASS: the 10,100 captured drops (first 50 nonces of every seed) pooled by board size give per-group p from 0.0814 (rows 15) to 0.9325 (rows 14); Fisher X² = 19.50, df = 18, combined p = 0.3615; no group below the Bonferroni per-group alpha 1.11e-3; nominal p-values (DL-2) |

Step sources: `tests/steps/commitment.ts` (Steps 1–4), `determinism.ts` (5–6), `payouts.ts` (7–10), `dataset.ts` (11–12), `anti-circularity.ts` (13), `phase-d.ts` (14), `wtf.ts` (15), `simulation.ts` (16–17), `standardization.ts` (18–20) and `live-fit.ts` (21). EC-1 to EC-7 are the core cryptographic criteria with automatic-fail weight; none was triggered.

**Step 6 is local.** It computes both the correct-seed and the wrong-seed path from `src/rng.ts`, so it is a client-seed sensitivity property of our own re-implementation plus a test of the coincidence predicate — not an independent observation of server behaviour. The p-value concerns those 1,010 local comparisons (67 on 8 rows … 287 on 16 rows); it is not the probability that all 10,100 recorded matches happened by chance. A local re-drop forced to coincide on 5% of samples would give about 51 coincidences, P(X ≥ 51) = 2.9e-83, and hard-fail the step: that is `M23`, "Step 6 local re-drop forced to coincide on 5% of samples (injected coincidence rate)", renamed in round 4 from "server ignores the client seed on 5% of drops" because a local mutation cannot demonstrate remote server behaviour. The earlier rule, `changed / tested ≥ 0.95`, tolerated 51 coincidences — about 94× the exact null — and was replaced in revision 3.

**Step 16 compares against recomputed theory.** It used to compare `simRTP` with the artifact's own `theoreticalRTP`, two editable values in one file. It now derives the reference from the pinned `plinkoConfig.json`, requires the declared theory column to match at 1e-12, compares `simRTP` against that value within 6 SE, and reconciles every header scalar (`meanSimulatedRTP`, `meanTheoreticalRTP`, the four fail counts, `bonferroniAlpha`, `bonferroniZCritical`) and every convergence trace with the rows (`M26`). Its population is bound to `allConfigs(plinkoConfig.json)`: the 28 audited boards as a set, each exactly once. The replay plays all 28 × 1,000,000 rounds with `src/pass1.ts` — the loop `src/simulate.ts` itself calls — on worker threads, compares simRTP and every convergence point exactly and the rest at 1e-14 + 1e-12·max, pins the replayed slot counts (`PASS1_CENSUS_SHA256`), gates on statistics re-derived from those counts, binds each trace to its histogram and re-renders the chart byte for byte (DL-10).

**Step 20 owns the emission artifacts' values.** Neither `outputs/coverage-results.json` nor `outputs/verification-stats.json` is read by a scored step, so until round 4 setting `totalConfigs` to `-1` returned 21/21 and a Full Pass. Every numeric leaf must now be a value the game physically admits — counts non-negative and bounded by populations known from code, probabilities in [0, 1], payout averages inside the pinned paytable's range — with every bound derived from `plinkoConfig.json` and `src/loader.ts`, never from the artifact. A leaf matched by no declared domain fails too (`M28`–`M30`). The domains encode possibility, not plausibility; `tests/plinko/domainTests.ts` pins the honest values a naive classifier would reject.

**Step 21 is informational.** Unlike Pass 2 it measures observed play, but it is a slot-distribution fit only, with nominal p-values. Mutation `M46` forces every 8-row drop into slot 0: Step 21 reports INFO, and the run fails because Steps 5 and 7 reject the same edit.

### Adversarial matrix

These are offline checks on the captured data and on our re-implementation; no attack was attempted against LIQD's servers.

<!-- S5-MATRIX:START -->

| ID | Category | Recorded result and limit |
|---|---|---|
| S5-1 | Seed substitution | PASS: 202/202 revealed seeds hash to their commitment (Step 1); substitution would need a SHA-256 second preimage and would break the 10,100/10,100 recomputation |
| S5-2 | Client-seed manipulation | PASS: the recorded outcomes track the client seed on 10,100/10,100 (Step 5, `M27`); Step 6's 1,008/1,010 is a local property of the re-implementation; Phase D's 10 `pfaudit-` seeds recompute 500/500 |
| S5-3 | Stake-conditional outcome | PASS at the two stakes tested ($0.10 and $10.00): 200 Phase C drops recompute under the identical algorithm (Step 18); other stakes were not captured |
| S5-4 | Server-seed cherry-picking | PASS in three tiers: substitution blocked for 192/202 (conditional on commitment timing, DL-3); epoch 152 unresolved (DL-5a); epochs 153–161 statistical only via Step 17 and the informational Step 21 (DL-5). Nothing here rules out cherry-picking across the capture as a whole |
| S5-5 | Seed-rotation race (TOCTOU) | NOT TESTED, disclosed: the capture is sequential, one bet in flight and rotation only after a settled 50-bet epoch. Structurally bounded — a bet's `hashedServerSeed` is fixed at accept time and 202/202 recompute against it — but only a concurrency capture is a positive test (R-RACE, A3) |
| S5-6 | Multiplier-table tampering | PASS on paid cells: 10,100/10,100 at 1e-9 (Step 7); the config pin is checked before any step scores (Step 20); all 28 tables symmetric (Step 19); 80 cells have no live payout witness |
| S5-7 | Nonce manipulation | PASS: 202/202 epochs sequential 0–49 under one client seed, 0 gaps, 0 duplicates (Step 4); the epoch size comes from `EXPECTED_EPOCH_SIZE`, not from the dataset (Step 12) |
| S5-8 | Modulo bias | PASS: `src/rng.ts` takes the bit as `u mod 2` over the whole 2^32 domain; range 2 divides 2^32, so the split is exact (bias 0), and Step 5's census shows the module drawing every recomputed bit that way (`src/bias.ts`). Measured: 0/28 chi² rejections uncorrected and at Bonferroni (Step 16), against probabilities re-derived by an independent Pascal recurrence (Step 13, max error 0) |

<!-- S5-MATRIX:END -->

S5: fairness-integrity matrix; game-integrity testing not commissioned.

Under an unknown client seed the HMAC output does not depend on which server seed the operator picks. The cherry-pick residual applies to players who keep a *predictable* client seed across rotations (kept across rotations, or a platform default); setting your own client seed after seeing the commitment removes it.

### Baseline-deviation review

Re-derivation proves the game behaves as the operator's own model says; it cannot notice that the model departs from what a player would assume. The left column is the standard commit-reveal Plinko baseline, written down independently of LIQD; every departure is dispositioned.

| Standard-Plinko baseline | LIQD observed | Disposition |
|---|---|---|
| Rows selectable (commonly 8–16), 3 risk levels | Rows 8–16, risk low/medium/high | Conforms |
| Every slot pays a nonzero multiplier (centre slots typically 0.2×–0.7×) | Standard tables conform; the **WTF table pays 0× on 10 of 14 slots** — P(zero payout) = 99.6582% per drop (Step 15) | **Deviation, disclosed.** RTP is a normal 98.9990%, but the risk profile is unlike any standard Plinko mode |
| Payout tables published or queryable | Tables live in the client bundle; no public spec page (`/fairness` etc. 404) | Deviation, disclosed; the audited tables are hash-pinned in `plinkoConfig.json` |
| One bit per row, slot = popcount, binomial slot law | Path recomputed for 10,100/10,100 bets; slot law anchored by exhaustive path enumeration (Steps 5, 10) | Conforms |
| Multiplier symmetric in the slot index | Confirmed for all 28 tables (Step 19) | Conforms |
| Advertised edge ≈ derived edge | Label `houseEdge: 1`; the live page shows "Edge: 1.00%", RTP "99% on every board" and "Every combination of rows and risk returns 99%." (read 2026-10-01); derived per-config edge 0.83984%–1.09375% (Step 10) | **Not literally true.** No board returns exactly 99.00%: 15 of 28 return less (lowest 98.90625%, rows 8 and 10 medium) and 13 more; 25 of 28 are inside the ±0.10 pp band and 3 above it on the player's side; none is more than 0.1 pp below 99%, so the published-RTP rule passes. The label is never used as evidence |
| Auto-bet is a speed feature, not a payout mode | "Rapid Fire" is speed-only; WTF is the only additional payout mode | Conforms |

No undisclosed deviation was found. The one substantive deviation, the WTF zero-slot concentration, is player-visible in the table itself, carries a standard 1% edge, and is quantified rather than merely described.

## Reproduce the audit

Use **Node.js 22.x**, pinned by `.nvmrc` and `package.json` `engines`; the committed artifacts were produced on that line, and a derived statistic's last bits are runtime-dependent. From the extracted repository directory:

```sh
npm ci
npm test
```

`npm test` is `node scripts/run-stages.mjs test`, which runs `node scripts/check-standalone.mjs`, `node test.js`, `node verify.js`, `node scripts/check-outputs.mjs` and `node scripts/release-manifest.mjs --check` in that order, every stage whatever the one before it returned, and exits 1 if any stage other than `verify.js` failed, otherwise with `verify.js`'s verdict code (until 14 October 2026 it was the same five commands joined by `&&`, which stopped at the verifier on any verdict other than a Full Pass); the zero-install bundle. It checks source/bundle integrity, runs the **57 unit tests** (`npx mocha` runs the same 57; 58 until the two rejection-sampling vectors in `tests/plinko/rngTests.ts` were added on 2026-10-02, 60 until 20 October 2026, when the four range-25/52/3,000,000,000 vectors were removed with the rebuild of `src/rng.ts` and the spec self-test `tests/plinko/rngSpecTests.ts` was added), runs the 21 scored steps — including Step 16's full replay of the committed 28,000,000-round Pass 1 and Step 17's full Pass 2 recompute — and checks the published record and hashes. **Expected: 21/21 PASS · PROVABLY FAIR — Full Pass, REPRODUCED, exit 0.** The verifier is deterministic given the committed artifacts, but the run is not free of randomness end to end: two unit tests in `tests/plinko/calibrationTests.ts` draw 250,000 fresh random 5,000-drop windows (150,000 on 8 rows / low risk, 100,000 on 16 rows / high risk) and check the exact left-tail calculation within 5 standard errors.

**Exit contract** (`tests/verify.ts`, end of file). Read the exit code, not the console output:

| Exit | Meaning |
|---:|---|
| 0 | Full Pass: every scored step PASSed and this run reproduced the committed artifacts |
| 1 | Any FAIL: a hard-failed step, a derived emission artifact that disagrees with what this run computed, or a reproduction beyond tolerance |
| 2 | Any FLAG with no FAIL — a Conditional Pass, most often an under-scale run; a distinct code because a FLAG that exited 0 would read as clean to anything automated |
| 5 | RTP FIGURE OVERSTATED: the enforced RTP-CLAIM 1.2.0 rule finds the published figure overstated on Step 10 and no step FAILs (outranks 2; 1 outranks it). `check-outputs` accepts it as a committed verdict (14 October 2026) when Step 10 is the one OVERSTATED step and `outputs/rtp-claim-table.json` records the miss |

1 outranks 2: a run that both FLAGs and disagrees with the committed evidence exits 1, and a FLAG usually causes a reproduction gap because the flag text is part of the recorded step detail. The verdict describes the whole command: `outcome.overallStatus`, `outcome.completed` and `outcome.validationErrors` cover the run, and the 21 scored checks are the subordinate `outcome.scored` / `outcome.scoredVerdict`.

**The reproduction gate is "beyond tolerance", not "any field".** `npm run verify` compares what it computed with the committed artifacts field by field and writes `outputs/run/diff.json`, with the runtime it ran on. Exact content — dataset, config, seeds, integers, strings, hashes — must be identical; derived floating-point statistics may differ by **1e-14 absolute + 1e-12 relative** (`src/diff.ts`), and two distinct integers never agree. A difference inside the bound is marked `withinTolerance`; outside it, the run exits 1. Declared bounds such as the Step 17 attestation residual are enforced at their own 1e-9.

**Verification never writes the evidence it scores.** It writes only under `outputs/run/` (gitignored): this run's results, recomputed emission artifacts and `diff.json`. A run with a hard fail is quarantined to `outputs/run/verification-results.failed.json`. Two consecutive runs on unchanged input leave every committed file byte-identical. Until 2026-09-11 (client QA D1, found on the sibling Dice audit, where a FAIL on one Node release and a PASS on the re-run left nothing to show the first result) the last statements of `tests/verify.ts` overwrote all three committed emissions on every run.

| Command | Purpose |
|---|---|
| `npm test` / `npm run test:quick` | The same command list: bundle integrity, unit suite, scored verifier with full Pass 1 replay, artifact guard, manifest check; no development dependencies needed |
| `npm run replay` / `npm run replay:standalone` | Re-execute the committed Pass 1 from its saved seeds — every derived quantity across 812 numeric comparisons at 1e-12 relative, including all 560 convergence points; writes nothing |
| `npm run regen` | Regenerate the committed simulation with `src/simulate.ts` from its saved seeds (`SIM_SEEDS_FROM`) and calibrate, into `outputs/run/regen/` |
| `npm run diff-simulation` | Compare that regeneration with `outputs/` field by field and the chart byte for byte → `outputs/run/diff-simulation.json` |
| `npm run test:full` | `npm test` + `replay.js` + `regen` + `diff-simulation` |
| `npm run verify` | The 21 steps under ts-node, single-threaded, with the full replay (`npm run report`, the same run with `PF_EMIT=1`, took 13 min 57 s on 2026-10-02) |
| `npm run check-outputs` | Pre-push guard on the committed canonical artifacts |
| `npm run build` / `npm run check:build` | Rebuild the three bundles and their manifest from TypeScript / rebuild in memory and require byte-identical output |
| `npm run test:toolchain` | Build reproduction, Mocha suite, replay, source verifier and artifact guard |
| `npm run mutate` | The declared mutation battery, in a temporary copy |
| `npm run gate` | `check:build` + `npm test` + `mutate` + `release-manifest --check` |
| `npm run simulate` | A **new** Pass 1 + Pass 2 experiment → `outputs/fresh/` (~20 min); `npm run calibrate` (~30 s) must use the same `SIM_OUT_DIR` |
| `npm run test:fresh-experiment` | `mocha && simulate && calibrate`, both pinned to `outputs/fresh/` |
| `npm run check-site-verifier -- <site>/src/components/VerifyBets/games/plinko/derive.js` | Compare a ProvablyFair.org site checkout with the pinned verifier bytes |

`npm ci --include=dev` installs the locked development toolchain the build, mutation and ts-node commands need. `scripts/build-standalone.mjs` compiles the TypeScript with the locked TypeScript version, and `standalone-manifest.json` records the source inventory, unit-test inventory, build inputs and compiled-file hashes; editing a TypeScript file or a bundle without rebuilding fails immediately. The hash manifest alone is not an independent proof of compilation; `check:build` is.

**Replay is not a fresh experiment (DL-11).** Pass 1 draws fresh seeds per configuration, so `npm run simulate` is a new experiment whose statistics legitimately differ; it writes to `outputs/fresh/` and never touches the artifact of record (`SIM_OUT_DIR=outputs` is the explicit, deliberate re-baseline escape and is on no test path). Reproducing the published experiment is replaying it (Step 16 or `npm run replay`) or regenerating it from its saved seeds (`npm run regen`). **Step 16 re-run rule:** for a fresh experiment, the two Bonferroni families of 28 tests, each held at family-wise 0.01, fail Step 16 by chance about 1 time in 50 (1.99%); such a failure quarantines the output and is not a defect — re-run the experiment. `npm test` has no fresh draws to trip on.

**Local-only escapes.** `PF_P1_REPLAY=off` replays only the first 50,000 rounds per row and caps Step 16 at FLAG (the mutation battery uses it); `ATTEST_SAMPLE=<n>` recomputes an evenly spaced subset of Pass 2 epochs; `EMIT_BASELINE=1` skips the emission-divergence guard. The mode is recorded in `runMode`, and `check-outputs` refuses any canonical run made with any of them.

**Pre-push guard.** `npm run check-outputs` exits non-zero unless the committed `outputs/verification-results.json` has `summary.hardFail === 0`, the verdict exactly `PROVABLY FAIR — Full Pass` — or exactly `RTP FIGURE OVERSTATED` when Step 10 is the only non-PASS scored step, its status is `OVERSTATED`, and the committed `outputs/rtp-claim-table.json` records the miss (outcome `FAIL`); a FLAG or a FAIL is still refused — and **21 distinct steps** — ids 1..21, each present exactly once under the name its module declares in `tests/steps/*.ts`, parsed from source, never from the artifact (`X13`; a count is not an identity). It requires a completed passing run, full epoch attestation and `emitBaseline: false`, and re-hashes all six committed JSON artifacts — dataset, config, simulation, calibration, `verification-stats.json` and `coverage-results.json` — against the recorded pins. `outputs/calibration-results.json` must also record the SHA-256 of the simulation artifact on disk, so a calibrated null computed for a different Pass 2 run cannot be published against this one.

| Output | Produced by | Contents |
|---|---|---|
| `outputs/verification-results.json` | `PF_EMIT=1 npm run verify` | 21 scored steps, info items, coverage block, profile coverage, summary verdict |
| `outputs/simulation-results.json` | `npm run simulate` (fresh runs go to `outputs/fresh/`; re-execute this one with `npm run replay`) | Pass 1 per-config results and Pass 2 seed-consistency results |
| `outputs/rtp-convergence.html` | `npm run simulate` (same); bound by Step 16 | Per-config convergence chart |
| `outputs/calibration-results.json` | `npm run calibrate` | Calibrated null for the Pass 2 payout-weighted count, both windows |
| `outputs/rtp-claim-table.json` | `npm run rtp-claim:write`, then re-pin `RTP_CLAIM_TABLE_SHA256` in `src/rtp-settings.ts` | Published-RTP rule per-board table |
| `outputs/coverage-results.json` | `PF_EMIT=1 npm run verify` | Payout-table cell coverage (285/365) and never-observed RTP share |
| `outputs/verification-stats.json` | `PF_EMIT=1 npm run verify` | Every figure the steps and informational items emit, as machine values |

`coverage-results.json` and `verification-stats.json` are deterministic given the dataset, the config **and** the committed simulation and calibration artifacts — not given the dataset and config alone (DL-11). `npm run verify` hard-fails if a committed copy differs from what the run produced or is missing.

**Determinism and attestation.** No committed artifact carries run metadata: none of the outputs contains a `generatedAt` or `executionTimeMs`, because a clock reading inside a hash-pinned file would make "reproduce it and compare the hash" impossible for any reader. `outputs/simulation-results.json` kept both until PLINKO-27 (2026-09-21) and since 2026-09-24 `src/simulate.ts` no longer writes them, so a regeneration is byte-identical on the machine that produced it; on another machine one p-value can differ in its last digit, which the field comparison tolerates. For Pass 2, Step 17 re-executes every epoch from the committed seeds and recomputes, per row, the early/late chi² p-values, payout-weighted z's, window RTPs `rtpEarly` / `rtpLate` and the `cherryPickFlag` predicate at 1e-9; the early/late edge-hit counts drop by drop, compared exactly; and 14 summary and header scalars at 1e-6 — `zEarlyMean`, `zEarlySd`, `countZEarlyBelow1645`, `meanZEarlyMinusLate`, `seZEarlyMinusLate`, `tZEarlyMinusLate`, `pTwoSidedZEarlyMinusLate`, the retained naive `expectedZEarlyBelow1645` and `zEarlyBelowSurvivalP`, both edge-hit totals, `cherryPickFlags`, `expectedFlagsByChance` and `cherryPickSurvivalP`. Each window RTP is bounded by the multipliers of the board the dataset assigns that epoch (`boardMultiplierRange`), not by the union over all boards, which is `[0, 1000]`. Step 17 also enforces the published scale `PASS2_NONCES_MIN = 10,000`: an under-scale run FLAGs. `outputs/calibration-results.json` depends only on the pinned tables, the window lengths and each epoch's board, so `npm run calibrate` reproduces it byte for byte with nothing excluded (two consecutive runs gave identical bytes); Step 17 rebuilds it from `src/calibration.ts` and fails at 1e-9 on any numeric field — the `method` string against `CALIBRATION_METHOD`, the top-line expectation, sd, variance, retained naive expectation, observed count and survival, the three source hashes, every `byConfig` field including `crossCheck` and its legitimate absence, and all 202 `perEpoch` rows, whose boards are re-derived from the dataset — for both windows. Only the `source[].file` paths and the descriptive strings are not re-derived. The `z = 1.645` threshold has exactly one definition, in `src/calibration.ts`.

**Regenerating after a change to a step's output — the order matters.** `verification-stats.json` records `steps.step20.domainLeavesChecked`, the number of numeric leaves in the emission artifacts, so adding or removing a numeric field changes a value counted from those artifacts and the record has to converge on itself:

```text
1.  make the code change                     (declare any NEW numeric leaf in src/domains.ts —
                                              an undeclared leaf fails Step 20 by design)
2.  EMIT_BASELINE=1 PF_EMIT=1 npm run verify  # bootstrap the derived artifacts
3.  PF_EMIT=1 npm run verify                  # settling pass — writes a clean record
4.  if step 3 reports a divergence naming `domainLeavesChecked`, repeat 2 then 3
5.  npm run check-outputs                     # must report OK and runMode.emitBaseline=false
6.  npm run verify                            # outputs/run/diff.json must be empty on all three
7.  npm run release-manifest                  # ALWAYS LAST — it lists the hashes steps 2–3 rewrote
```

A record produced with `EMIT_BASELINE=1` carries `runMode.emitBaseline: true` and the verdict `RUN NOT VALID`, and the publication guard refuses it; step 3 has to succeed on its own. Do not fix a divergence by restoring the committed record while keeping freshly written derived artifacts: the record pins their hashes, so `check-outputs` then fails. Restore all of `outputs/` or none of it. A documentation-only change that moves the profile-coverage text in `src/profile-map.ts` or a step's detail string needs `npm run build` (the bundles embed the sources), then steps 3, 5, 6 and 7; no numerical result should move.

**Mutation battery.** `npm run mutate` runs two registries: `tests/mutations.json` (**52** counterexamples, `M00`–`M51`, each of which a named scored step must reject, except `M01`, `M02` and `M35`, which the unit tests or the config pin reject, and `M46`, which shows the informational Step 21 reacting) and `tests/mutations-extra.json` (**27** entries — `X00`–`X19`, rejected by the publication guard or by a step under a reviewer's exact configuration, the declared survivor `S00`, and six added on 14 October 2026: `C3i` and `C3ii`, which must end RTP FIGURE OVERSTATED, exit 5, after their `regen`, and `X20`–`X23`, the publication guard's refusals around that verdict) — **79** in total (73 until 14 October 2026). For example, `M14` changes the dataset hash printed in `README.md` and Step 20 must reject it; `M04` injects a non-numeric reported payout and Step 8 must reject it. The battery is outside `npm test` because it re-runs the verifier once per mutation: the run of 2026-10-02 took 2 h 30 min, and 73/73 behaved as declared, every touched file restored byte-identical in the working copy. Verify-runner mutations use `PF_P1_REPLAY=off`; `X17` and `X18` need the full replay and use the `standalone` runner, which rebuilds the bundle from the mutated sources and runs it on worker threads. The battery never edits the working tree: it copies the package (without `node_modules` and `outputs/run/`) to a temporary directory, restores every touched file after each entry and prints a restoration hash manifest. An entry that cannot be applied is a setup failure, not a rejection. For the declared survivor the runner requires proof that the steps ran, read from the run's own scored record (it empties `outputs/run/` first): the process must have started, not been signalled and reached the runner's end-of-run marker; every step in `expectPass` must report an explicit `PASS`; the non-`PASS` steps must equal `expectFail` exactly; and the console's last marker for each step must agree with the record — a rule added on 2026-10-02, when Step 10 printed `[PASS]` and was then re-scored FAIL by the published-RTP rule, and a console-reading runner reported `S00` as surviving one step more (18) than the record showed (17).

`S00` edits both never-paid WTF 1000× cells to 990, regenerates the config pin and propagates it to the documents, and **17 of the 21 scored steps still pass**. The registry declares `expectFail: [5, 10, 16, 17]`, of two kinds:

- **Artifact staleness, not detection — Steps 5, 16, 17, and Step 10 in part.** The committed simulation was produced with the original table, so its stored theory column (Step 16) and Pass 2 z values (Step 17) no longer re-derive; Step 16's own "simRTP within 6·SE of the RECOMPUTED theory" still reports 28/28. Step 5's site-verifier `paytables.js` is a hash-pinned copy generated from the original `plinkoConfig.json` (since 2026-09-24), and Step 10's committed `outputs/rtp-claim-table.json` likewise. Had the cell been wrong from the first commit, every copy would carry the same error and agree.
- **Detection — Step 10, through the published-RTP rule.** With both tails at 990× the WTF board returns 8090/8192, more than 0.1 pp below 99%, so Step 10 fails whether or not the table was regenerated. Measured 2026-10-02 on a scratch copy with the edited table regenerated by `npm run rtp-claim:write` and re-pinned: Step 10 still FAILed ("outcome FAIL; committed table matches this run").

**Cross-repo note.** The "absent emission artifact ⇒ clean run" shape closed here (round-3 K6, registered as `X07`) also exists in the sibling `mines` and `blackjack` audits and has not been fixed there. That is a statement about those repositories, not about this one's conclusions. The dataset-population class (DL-3's guard) was originally found by a ProvablyFair.org framework check that does not ship with this package, so the premise table is what a reader checks it against.

## Verify a bet

Any past LIQD Plinko drop reproduces from published inputs alone — the revealed server seed, client seed, nonce and row count, all exposed by the LIQD API — with a standard crypto library. No LIQD code, no API call, no secret state.

1. **Commitment.** `SHA-256(utf8(serverSeed))` must equal the bet's `hashedServerSeed`, published before the round. This proves the revealed seed is the one that was committed. Hash the 32-character hex string, not its decoded bytes.
2. **Per-row bits.** For `cursor` in `1 … rows`, take `digest = HMAC_SHA256(key = hex_decode(serverSeed), msg = "{clientSeed}:{nonce}:{cursor}")`, then `bit = big_endian_uint32(digest[0:4]) % 2` (0 = left, 1 = right).
3. **Winning slot.** `winningSlot` = the count of 1-bits across the rows, a value in `[0, rows]`.
4. **Payout.** Look `winningSlot` up in the pinned table for `(rows, riskLevel)` — `plinkoConfig.json`, `payout_tables[String(rows)][riskLevel − 1][slot]`, or `wtf_mode.odds[slot]` for risk 4 — and check `winningAmount = betAmount × table[winningSlot]`.

**Worked example — bet `SLOjmT9dyuUEi1que576R`** (Phase A, epoch 0, nonce 0): `serverSeed` `fc9a1d6fad00e0832fddfdea45435c85`, `clientSeed` `auditb1141320acde`, `nonce` 0, `rows` 8, `riskLevel` 1.

Commitment: `SHA-256(utf8("fc9a1d6fad00e0832fddfdea45435c85")) = 3b34a0fce5732f2d9c89b16fca9c2b6a231c2b7f2de29bbc41e141861dc39d36`, which equals the bet's recorded `hashedServerSeed`.

The HMAC key is the 16 decoded bytes of the seed and the message is `auditb1141320acde:0:<cursor>`:

| Cursor | First four bytes | Unsigned integer | Bit |
|---:|---|---:|---:|
| 1 | `1bc5cc26` | 465,947,686 | 0 |
| 2 | `0f9d6173` | 261,972,339 | 1 |
| 3 | `dbdb6f8d` | 3,688,591,245 | 1 |
| 4 | `f460931e` | 4,099,969,822 | 0 |
| 5 | `ce51a3ed` | 3,461,456,877 | 1 |
| 6 | `056cc631` | 91,014,705 | 1 |
| 7 | `0cf8aab5` | 217,623,221 | 1 |
| 8 | `136bb6c5` | 325,826,245 | 1 |

The path is `01101111`, six right decisions, so slot 6, equal to the captured `dropDetails` and `winningSlot`. `PLINKO_FIXED_ODDS[8][1][6] = 1.1`, matching the captured multiplier, and `0.10 × 1.1 = 0.11` matches the reported payout. The same seed's last bet, `Fj4Kfh41bSVPiGZgcHPWn` (nonce 49), draws `00010110`, slot 3: the nonce is the middle field of the message, so nonces 0 and 49 draw entirely different bit streams under one seed pair.

**Worked example — WTF bet `2tGmOv7FZHfyCwhX7yCS3`** (Phase E, epoch 175, nonce 32): `serverSeed` `0d249f81e03a903d6b17c71ebc82817a`, `clientSeed` `auditc680c9435be0`, `rows` 13 (forced by WTF), `riskLevel` 4.

Commitment: `SHA-256(utf8("0d249f81e03a903d6b17c71ebc82817a")) = 1e74e08a9dd50f50ef689e15b52a37ca15c83fbcb1b166202a85f7ea78cec70b`, which equals the bet's recorded `hashedServerSeed`.

The 13 bits come out `1,1,1,1,1,0,1,1,1,1,1,1,1`: path `1111101111111`, slot 12, identical to the capture, and `PLINKO_WTF_ODDS[12] = 235` matches the captured multiplier. The derivation is byte-for-byte the standard one; WTF changes only the row count and the table.

The reference verifier `src/rng.ts` (`revealPlinko`) was rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md), which these steps follow, by an implementer who never opened LIQD's code, and reproduces all 10,100 captured drops with zero mismatches. A matching drop verifies that round against its inputs; it does not by itself establish when its commitment was published or that every other round is fair.

**The ProvablyFair.org verifier for this game is checked too.** The LIQD Plinko verifier in ProvablyFair.org's documentation site (`VerifyBets` → `games/plinko/derive.js`, with the HMAC library and paytable it imports and the source card the page displays) is vendored byte for byte in `verifier-parity/`, its four SHA-256 digests are pinned in `src/site-verifier.ts`, and Step 5 runs that code, unmodified, on all 10,100 captured bets: same L/R path, same slot and the same multiplier LIQD served on every one, a paytable equal to `plinkoConfig.json` on all 365 cells, and a source card whose text is `derive.js` exactly. Scope: this is the docs-site component. The live `https://www.provablyfair.org/verify-bets` page is a different build and is not covered: its HTML and the 18 script chunks the HTML references contain no `liqd` string (GET, 2026-09-24; chunks loaded later at runtime were not fetched), so this audit does not claim that page verifies LIQD bets.

## Evidence

The primary evidence is the dataset (E06) and the reproducible verification outputs (E08), not the screenshots. Every listed path exists in the repository. There is no E03.

| ID | File | Format and date | Evidence and limits |
|---|---|---|---|
| E01 | [Plinko game UI](evidence/E01-plinko-game-ui.png) | PNG 2545×1768 · SHA-256 `d9c270b14413c8366406ecd8ddb046566a96bef3cd4955d624cc373fd94f1204` · 2026-07-08 | Authenticated view of `qa.liqd.com/originals/plinko`: rows/risk controls and per-slot bucket multipliers. Shows the Low/Medium/High tabs; the WTF tab is not visible in this view. |
| E02 | [Provably-fair panel](evidence/E02-provably-fair-panel.png) | PNG 2560×1768 · SHA-256 `0585356390f02493356e4f811aaf6b6ee73afaba274c03328261140c08f55603` · 2026-07-08 | Authenticated in-game panel: active and next server-seed hashes, client seed, nonce. Its identifiers do not identify an epoch in this dataset. |
| E04 | [Multiplier table](evidence/E04-multiplier-tables.jpg) | JPEG 1440×723 · SHA-256 `d16a39c54a290b6939717cffe8322939d795d60170b646d1b98a1ce3655f06a5` · 2026-08-04 | Public, logged-out view. The table shown (HIGH risk, 8 rows: `29× / 4 / 1.5 / 0.3 / 0.2 / 0.3 / 1.5 / 4 / 29×`) matches the pinned `PLINKO_FIXED_ODDS`; all nine of its cells were also paid live, so it witnesses no never-paid cell. |
| E05 | [WTF mode](evidence/E05-wtf-mode.jpg) | JPEG 1440×723 · SHA-256 `e631cf0da2e17c422e2f506dc9d6ef0fbaaaf9086ac071b0dff9ab2ba3465c27` · 2026-08-04 | Public, logged-out view: the WTF fourth risk tab forcing 13 rows and the `1000×` (`1k`) / `235×` edge buckets; the 1000× tails appear only at the rounded label "1k". |
| E06 | [Master dataset](data/plinko-master-10100bets.json) | JSON · SHA-256 `871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95` | 10,100 drops (A 5,400 · B 2,000 · C 200 · D 500 · E 2,000), 202 revealed seed epochs. `loadDataset()` aborts on a hash mismatch. |
| E07 | [Payout tables](plinkoConfig.json) | JSON · SHA-256 `f8eaf67e1ffc63ee0dc21123447581c55f443c167dcb451b45ab7cd108fe712f` | `PLINKO_FIXED_ODDS` (27 standard configs) and `PLINKO_WTF_ODDS`, extracted from the client bundle (`0pm_um5zrrwwn.js`, 2026-07-06). `loadPlinkoConfig()` aborts on a mismatch. |
| E19 | [RTP page labels](evidence/rtp-page-labels-2026-10-01.json) | JSON · SHA-256 `e159a3c173a1887c6c5dd2728caf9378ade2c6b2fbd6ce8f410a3bca3e13b0e2` · read 2026-10-01 | The RTP and house-edge figures LIQD's live `liqd.com/originals` pages show players, read in a headless browser, logged out, without clicking or typing (the record's `method` field says how). For Plinko: "Released: June 2026 \| Edge: 1.00%", "99% on every board" and the page statements quoted under [the published-RTP rule](#the-published-rtp-rule). The source of the claim Step 10 holds the game to (`src/rtp-settings.ts`). Panels opened by a click were not read. |

E01–E02 are authenticated, unretouched PNG screenshots; E04–E05 are later public views saved as JPEG by the capture tool, UI-parity evidence for the pinned tables rather than authenticated session state. The standard tables are also visible in the in-game bucket display (E01, E04). Seed rotation and the next-seed pre-commitment are proven in the dataset itself across all 202 pre-commitments (Step 2), which is stronger than a panel screenshot. Dates are on-disk file dates. No screenshot carries a visible URL bar, and neither screenshots nor the illustrative capture scripts authenticate the recorded session.

| ID | File | Role |
|---|---|---|
| E08 | [Verification results](outputs/verification-results.json) | 21 scored steps, all PASS. Records `artifactHashes` for all six committed JSON artifacts (dataset, config, simulation, calibration, and since revision 3 the derived emissions E17 and E18), the `runMode` (`attest`, `emitBaseline`; the guard refuses anything but `full` / `false`), per-step details and machine `data`, the coverage block, informational items and the verdict. |
| E09 | [Simulation results](outputs/simulation-results.json) | Pass 1: 28 × 1,000,000 rounds, fresh seeds stored per row; chi² 0/28 and serial 0/28 at Bonferroni. Pass 2: 202 casino seeds × 10,000 nonces, the synthetic fixed-board probe. Hash-pinned (`SIMULATION_RESULTS_SHA256` = `3d94a510…`, `src/artifact-pins.ts`): `tests/verify.ts` throws on a mismatch, Step 16 replays it and Step 17 recomputes Pass 2. |
| E10 | [Convergence chart](outputs/rtp-convergence.html) | Self-contained per-config running-RTP chart; re-rendered by Step 16 from the committed traces with `src/convergence-chart.ts` and required byte for byte. No chapter figure is taken from it. |
| E16 | [Calibrated null](outputs/calibration-results.json) | Added in revision 2. Per-configuration exact left-tail probabilities, the per-epoch assignment over the 202 seeds and the Poisson-binomial summary: top level the primary 50-nonce window (1.4099 ± 1.1721; observed 1, recomputed from the revealed seeds; P(X ≥ 1) = 0.7603), `extendedWindow` the 5,000-nonce window (5.8556 ± 2.3708; observed 6; P(X ≥ 6) = 0.5337). Pinned (`CALIBRATION_RESULTS_SHA256` = `53dabd47…`): `tests/verify.ts` throws on a mismatch; deterministic and rebuilt in full by Step 17, which is the guard that matters. |
| E17 | [Coverage](outputs/coverage-results.json) | Added in revision 2, hash-pinned since revision 3: 285/365 cells exercised, 80 never paid, the 7.41% never-observed RTP share. |
| E18 | [Verification statistics](outputs/verification-stats.json) | Added in revision 2, hash-pinned since revision 3: every figure the steps and informational items compute, as machine values — Step 6's local counts and exact-null figures, Step 10's RTP band and edge span, Step 14's Phase D exposure, Step 15's WTF zero-payout probability, Step 16's population binding and serial-equivalence figures, Step 17's attestation scope, Step 21's p-values, and the informational live RTP, lag-1 and win-rate figures. The figures quoted in this overview come from here; the record's `detail` strings are prose and are not the source. |
| E20 | [RTP claim table](outputs/rtp-claim-table.json) | Per-board exact RTP as a rational, gap to the 99% in E19, side of the band and outcome — 0 of 28 fail, worst −0.09375 pp. Written by `npm run rtp-claim:write`, pinned as `RTP_CLAIM_TABLE_SHA256` (`84f48588…`) in `src/rtp-settings.ts`. |
| E11 | [src/rng.ts](src/rng.ts) | Dependency-free reference RNG: `commitHash`, `generateProvablyFairNumber` (HMAC, first four bytes mod range), `revealPlinko`. Rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md) by an implementer who never opened LIQD's code. Reproduces all 10,100 drops. |
| E12 | [tests/verify.ts](tests/verify.ts) | The 21-step suite, run against E06 using E07; re-hashes both at startup. |
| E13 | [src/simulate.ts](src/simulate.ts) | Two-pass simulation writing E09 and E10; a fresh run writes to `outputs/fresh/`. The companion `src/replay.ts` re-executes the committed Pass 1 and writes nothing. |
| E14 | [src/config.ts](src/config.ts) | Config loader, `binomP`, `payoutTable`, `theoreticalRTP`, `allConfigs`; enforces the config pin. |
| E15 | [capture/capture-plinko.reference.mjs](capture/capture-plinko.reference.mjs) | Illustrative capture reference, with `capture/lib.reference.mjs` and the `capture/capture-plinko.reference.user.js` userscript variant: the phase plan, endpoint sequence and rotation discipline against `qa.liqd.com/api/v1`. Not the exact tool that produced this dataset (config ordering, Phase D seed naming and field schema differ; see the dataset's own field names in E06). |

**Integrity.** The dataset SHA-256 is recorded in the verification record and recomputable with `shasum -a 256 data/plinko-master-10100bets.json`; the config SHA-256 likewise (`artifactHashes.config`, expected/actual/match) with `shasum -a 256 plinkoConfig.json`. The outputs (E08–E10, E16–E18, E20) were generated by E12, E13, `src/calibrate.ts` and `src/rtp-settings.ts` against this exact dataset and config; a single-byte change to either input aborts the suite before any result is written. The per-config RTP proof is conditional on `plinkoConfig.json`: Step 7 verifies only cells actually hit, so the rare tail multipliers rest on the pinned file. `RELEASE-MANIFEST.json` lists the SHA-256 of all eight artifacts of record. The re-pins of E09 and E16 are recorded in the [release history](#release-history).

## Limitations and trust

The cryptographic checks prove that every captured drop was consistent with a pre-committed server-seed hash and a player-controlled client seed, and paid against the pinned table. Commit-reveal proves, against the full dataset: no post-bet tampering (each outcome is bound to a server seed committed beforehand); truthful reveal (202/202); client-seed consumption (Phase D, 500/500; the 1,008/1,010 wrong-seed figure is local, and the recorded-outcome comparison is Step 5); faithful execution (10,100/10,100); and payout conformance (10,100/10,100, standard and WTF). This section records what those checks do not prove.

| Entropy component | Source | Player-observable? | Player-controllable? |
|---|---|---|---|
| Server seed (secret) | LIQD | No (until reveal) | No |
| Server-seed hash (commitment) | `SHA-256(utf8(serverSeed hex string))` | Yes (before any drop) | No |
| Client seed | Player | Yes | Yes (editable) |
| Nonce | LIQD state | Yes | Only via ordering |

**R-CHERRY — server-seed cherry-picking. Containment: three tiers; no claim here says the capture as a whole rules out cherry-picking.** Commit-reveal binds outcomes to a seed after commitment; it does not constrain which seed the operator commits to.

- **192 epochs — seed substitution is blocked.** Each server-seed hash was published before the auditor chose that epoch's client seed (Step 2, 201/201 epoch links plus the pre-capture link, 202/202), and those client seeds were `audit` + 12 lowercase hex strings (48 bits, all 192 distinct). This is structural, with two conditions: it is conditional on authentic commitment timing (DL-3 / P1), since commitment equality and chronology inside one self-published file do not establish that the commitment was public before the client seed was chosen; and the claim that those seeds were unpredictable to the operator at commitment rests on a generator that does not ship with this package (DL-5). Substitution-blocking itself does not depend on the generator.
- **Epoch 152 — UNRESOLVED (DL-5a).** It was previously counted inside the by-construction set because its run-id had not been disclosed at commitment. That does not follow: a prior hash blocks later substitution, not grinding a server seed against a predictable future client seed. The run-id is a millisecond Unix timestamp (`pfaudit-1783390325646-152`), guessable in distribution, and the earlier position that ~10⁴ plausible candidates leave cherry-picking with negligible power has no quantitative demonstration anywhere in this package. It is not relabelled compromised: there is no evidence of any attack.
- **Nine epochs 153–161 — statistical containment only (DL-5).** Their `pfaudit-<run-id>-<epoch>` client seeds were already held by the operator at commitment (rotation N returns the N+1 commitment), so containment rests on Step 17 (scored) and Step 21 (informational, cannot fail). 450 bets, $45.00 wagered, $49.74 paid describe what happened; they are not a demonstration of containment.

The two consistency checks agree and find no early-window anomaly at their own power: Step 21's Fisher p = 0.3615 and Pass 2's 11 flags vs 9.6 expected on the nominal size-0.05 null (not verified in-repo), P = 0.3652, with the payout-weighted statistic as tabled above. **Residual risk: contained for substitution, unresolved for epoch 152, statistical for epochs 153–161.** No external-entropy pinning is in use, which is peer-standard for commit-reveal Plinko; an external-entropy beacon would collapse R-CHERRY to LOW by construction (recommendation P2).

**R-PAYOUT — payout-table integrity. Containment: partial — 285/365 cells live-verified, 80 transcription-only.** A wrong value in any paid cell fails Step 7. The 80 never-paid cells are guarded only by our transcription of the operator's published table, so the suite cannot distinguish a correct transcription from a wrong one unless the error takes a board more than 0.1 pp below 99% (Step 10). Committing the operator's client-bundle chunk or a hashed `get-game-settings` response would close it.

**R-CONFIG — payout-table update after capture. Disclosed.** `plinkoConfig.json` is pinned and delivery reads the pinned table, not a live endpoint. Nothing in the captured records carries a table version or content hash, so a later rebalance could leave the snapshot disagreeing with live tables; players re-verify against the tables shown on their PF panel at bet time (recommendation P3).

**R-MULTI — multi-account seed correlation. Out of scope, disclosed:** a single-account dataset cannot detect cross-account seed reuse, and differential treatment across accounts cannot be ruled out (A2). **R-BRACKET — parameter boundaries. Disclosed:** rows 8 and 16 and risks LOW, HIGH and WTF are covered uniformly across Phases A, B and E, and per-config chi² would surface a boundary anomaly; the WTF deep tail is A1. **R-RACE** is S5-5 (A3).

Further boundaries: the audit verifies game-logic correctness, not the quality of the server's entropy source, which the commitment bounds; outcomes were collected in a single window and platform behaviour could change after it; LIQD is centralized, with no on-chain record — verifiability rests on commit-reveal, not a blockchain.

### Declared limitations register

Everything this audit knows it cannot prove, with its measured magnitude where one exists. DL-10 is closed, DL-6 no longer applies and DL-11 is fixed with a declared residual; the other ten are open. A reviewer who finds one of these can map the finding onto this declaration instead of writing it up as new; a limitation missing from this list is a defect in this list.

| # | Limitation | Registered as | Magnitude (measured) | Why it cannot be closed offline |
|---|---|---|---|---|
| **DL-1** | **The 80 never-paid payout cells.** Step 7 can only check cells the capture landed on; the remaining cells rest on our hand-transcription of the operator's client bundle. | `S00`, declared survivor in `tests/mutations-extra.json`; premise **P3**; Step 7's detail string; `outputs/coverage-results.json` | 80 of 365 cells never paid (285 exercised, 78.1%). **7.4086%** of summed theoretical RTP; **28.9685%** (15r/3), **24.9497%** (14r/3), **24.6609%** (WTF) of those boards' RTP. Both 1000× WTF tails (slots 0 and 13) are among them. | Settled data has zero power over a cell that never paid. `S00` reproduces the tree a mis-transcription present from the first commit would produce — both tails at 990, config pin re-pinned and propagated — and 17 of 21 steps still pass (battery 2026-10-02: 73/73 as declared). Steps 5, 16 and 17 reject it through committed copies of the original table (staleness, not detection); Step 10 for that reason and because the published-RTP rule detects it (8090/8192, under 98.8%). A mis-transcription that keeps every board within 0.1 pp of 99%, or moves it in the player's favour, is still not detectable offline. Closing it requires the client-bundle chunk, or a hashed `get-game-settings` response, committed as evidence. |
| **DL-2** | **The Pass 2 slot-flag null is nominal, not calibrated.** `expectedFlagsByChance = 9.595` is `202 × 0.05 × 0.95`, which assumes the tail-merged chi² has size exactly 0.05. Independence holds (disjoint nonce ranges); the size does not follow. Step 21 uses the same rule and inherits the caveat. | `A4b`; round-3 finding **K8**; Step 17's and Step 21's detail strings | **Not measured in this repository.** The 11 flags vs 9.595 (survival P = 0.3652) and Step 21's Fisher p = 0.3615 are nominal. An external reviewer's independent Monte Carlo reported a different expectation; we did not reproduce it and do not publish their number as ours. | **Measurable offline** — previously mis-filed as inherently external, which the round-4 client QA rightly rejected. It needs no live access and no fresh Pass 1: the size is a property of the statistic under the binomial null (exact-null multinomial Monte Carlo per board size at n = 5,000), and re-deriving the expectation uses the Pass 2 flag count, deterministic given the committed seeds and re-executed by Step 17. (`audit-rules` §9.4 forbids re-running the frozen **Pass 1**, a different experiment.) Deferred because it is immaterial at these counts and the exactly calibrated payout-weighted statistic agrees — not because it cannot be done. |
| **DL-3** | **Dataset provenance.** Nothing offline proves the 10,100 rounds came from LIQD. The pin proves the file has not changed since we pinned it; the population constants prove it is the population audited. Neither speaks to origin. | Premise **P1** (added in revision 4; before that, provenance had no premise row); the population guard in Steps 11/12 (`G-BIND`) | The whole dataset — 10,100 drops, 202 epochs, $2,990.00 wagered. | Provenance rests on capture discipline: an authenticated browser session against `qa.liqd.com`, the reference capture scripts in `capture/`, and `meta.preCapture` anchoring the commitment chain before epoch 0. A third party re-running this repository verifies internal consistency and cryptographic correctness, not that LIQD served these rounds. Only an independent capture by a second party closes it. |
| **DL-4** | **Production parity.** All evidence is from `qa.liqd.com`, pre-launch. | Premise **P5**; the *provisional* qualifier on the verdict in README.md and this file | The entire audit. The verdict is **PROVABLY FAIR — Full Pass, provisional**. | Whether `liqd.com` serves the same build is not observable from a pre-production capture. Closed only by an anonymous post-launch capture against production. |
| **DL-5** | **The client seeds were generated by a tool this package does not ship, and ten of them are predictable.** (a) Phase D epochs 152–161 used `pfaudit-<run-id>-<epoch>` with a millisecond-timestamp run-id; for 153–161 the operator already held those seeds when it committed (epoch 152 is DL-5a). (b) The other 192 epochs used `audit` + 12 lowercase hex characters; **the generator is not in this repository and its randomness source is not documented anywhere in this package**, so their unpredictability is an assumption. The shipped `capture/` scripts are illustrative (E15) and do not produce this form. | `F14` / Step 14, whose detail carries the figures; premise **P4**; R-CHERRY above; E15 | 9 of 202 epochs for the predictable-seed exposure — **450 bets, $45.00 wagered, $49.74 paid** (derived by Step 14, not hand-computed); those totals describe what happened, not containment. The undocumented-generator exposure covers 192 of 202 epochs: 48 bits each, all 192 distinct, consistent with — but not demonstrating — a cryptographic source. Substitution-blocking for them does not depend on the generator; unpredictability at commitment does. | For the nine, containment rests on consistency checks — Step 17 (scored) and Step 21 (informational, cannot fail) — which agree and find no early-window anomaly, but consistency is weaker than construction. For the 192, nothing in this package raises or lowers the assumption. Closed by a capture that ships the exact generating tool, records its randomness source, and uses independently generated unpredictable client seeds chosen after the relevant commitment (`A4`). |
| **DL-5a** | **Epoch 152's client-seed predictability is UNRESOLVED, not cleared.** It is the first `pfaudit-` epoch, previously counted in the by-construction set because its run-id had not been disclosed at commitment. Prior publication blocks later **substitution**; it does not rule out **grinding** a server seed against a predictable future client seed before committing. | This row; premise **P4**; R-CHERRY; S5-4; `A4` | 1 of 202 epochs. The run-id is a millisecond timestamp (`pfaudit-1783390325646-152`), guessable in distribution. The earlier position that ~10⁴ candidates leave negligible power **has no quantitative demonstration anywhere in this package**. | Reported as an explicit unresolved premise, not relabelled compromised: no evidence of any attack exists. Closing it needs a quantitative argument under an explicit adversary model, or a capture using independently generated unpredictable client seeds chosen after the relevant commitment, with protocol records retained (`A4`). |
| **DL-6** | **No longer applies: the stale sentence is gone, and the shipped `outputs/simulation-results.json` is not the byte-identical file the round-3 reviewers reproduced.** Its `pass2_casino_seeds.description` used to say R-CHERRY is "closed by construction for this capture" — the revision-1 universal claim, wrong for the nine epochs in DL-5. | Round-3 ledger §D.1; `SIMULATION_RESULTS_SHA256` in `src/artifact-pins.ts` | The phrase occurs 0 times in the shipped file. The reviewers reproduced `b14c0939…`; the shipped file is `3d94a510…`. Compared leaf by leaf on 2026-10-02: no numeric value differs; three run-metadata fields are absent (`generatedAt` and two `executionTimeMs`, removed 2026-09-21, PLINKO-27); one string differs, that `description`, rewritten when `src/simulate.ts` regenerated the file from its saved seeds (the 2026-09-24 re-pin). | Nothing is left to close for the sentence. The link to the reviewed file rests on the leaf comparison; the reviewed file itself does not ship. |
| **DL-7** | **Live-bet RTP is not RTP evidence.** | This overview's Simulation section; the verifier's informational item, labelled *informational, not authoritative* (not a scored step) | Observed **80.6843%** across the 10,100 drops; 26 of 28 configs ≈ 218 bets; 16r/3 2,418; WTF 2,000. | A sample this size cannot resolve a 1% edge against tails that pay 1000×. The authoritative evidence is the analytical calculation plus the 28,000,000-round simulation. |
| **DL-8** | **The credited payout is not cross-confirmed against a balance delta.** The bet response carries no running wallet-balance field. | `A6` | All 10,100 payouts. The claim rests on the seed-recomputed multiplier and the exact `betAmount × multiplier` identity, not on `Δbalance`. | The field does not exist in the API this capture recorded. Closed only by a capture that records balance before and after each bet. |
| **DL-9** | **Untested adversarial surfaces, disclosed rather than cleared:** seed-rotation race (TOCTOU), multi-account seed correlation and WTF deep-tail sampling — plus three declared here for the first time in revision 4: **selective bet rejection**, **server-seed entropy and custody**, and **bet/profit caps**. | Rotation race: `S5-5`, `A3`. Multi-account: `R-MULTI`, `A2`. Deep tail: `R-BRACKET`, `A1`. The other three: **this row only** | Not quantified — no capture addresses any of them. | Each needs a capture design this engagement did not run: concurrent rotation/bet ordering; multiple accounts; a deep WTF tail sample; a rejected-bet corpus; server-side custody evidence; a stake/exposure sweep against the caps. None is implied to have passed, and no scored step touches them. |
| **DL-10** | **`outputs/rtp-convergence.html` was not bound to anything. CLOSED 2026-09-24.** | Round-3 ledger §D.3; profile PLINKO-32 | One rendering artifact; no figure in this overview is taken from it. | Closed by binding rather than pinning: the renderer moved unchanged from `src/simulate.ts` to `src/convergence-chart.ts`, and Step 16 re-renders the chart from the committed traces and requires the file byte for byte (measured byte-identical); each trace is bound to the replayed histogram (terminal point = histogram-derived RTP within the float bound, every point feasible). |
| **DL-11** | **Historical replay and fresh experiment were conflated, and are now separated.** `npm test` used to be `mocha && simulate && calibrate && verify`: it drew fresh Pass 1 seeds and compared the new experiment's serial statistics against the old experiment's exact stored values, which is invalid by construction. | Round-4 finding; [Reproduce the audit](#reproduce-the-audit); the `replay` / `simulate` / `test:fresh-experiment` scripts | In a completed reviewer run `serialUncorrectedFails` moved from 1 to 2 and `corr(r1Z, runsZ)` from −0.9999999643182262 to −0.9999999675536809; every scored check passed and the command still exited 1. | Fixed with a declared residual: `npm test` no longer draws seeds — Step 16 replays the committed Pass 1 from its saved seeds (since 2026-09-24); `npm run simulate` writes a new experiment to `outputs/fresh/`. Pass 1 is still fresh-seeded by design, so the published Pass 1 numbers can only be re-derived by replaying their saved seeds, never re-drawn, and `verification-stats.json` and `coverage-results.json` are deterministic given the dataset, the config **and** the committed simulation and calibration artifacts. |
| **DL-12** | **Pass 2 is a synthetic fixed-board probe, not the observed payout schedule.** Each epoch is evaluated on one board chosen by an explicit nonce rule — the board of its lowest-nonce bet (`boardOfEpoch`) — extended to 10,000 synthetic nonces. | Round-4 finding; `A4c`; the Pass 2 section above | **192 of 202 epochs carry exactly one board**, so for them the rule is vacuous; the ten Phase D epochs **152–161 each spread 50 bets across all 27 standard boards**, so the probe evaluates one board out of 27. The extended window's nonces 50–9,999 are a hypothetical continuation, which is why the payout-weighted statistic is scored on the 50 nonces played; the fixed-board scope is unchanged by window length. The previous file-order rule agreed with the nonce rule on all 202 committed epochs, so no published figure changes. | The calculation is internally consistent and reproduces exactly; it does not measure the mixed-board schedule a claim about economically targeted selection in the predictable-seed epochs would need. Boards evaluated on the same (seed, nonce) share row prefixes and are not independent. Closed only by the statistic in `A4c`. |

### Premises and remaining scope

The claims this audit rests on that settled data has limited or no power to falsify. A row whose data-power is "no" or "partial" is witnessed by something outside the verification pipeline — the captured dataset, or an external or ASSUMED source — never by an `outputs/` file, which would only prove the pipeline agrees with itself.

| # | Premise | Witness | Could the captured data contradict it? |
|---|---|---|---|
| **P1** | The 10,100 records are rounds LIQD actually served — a capture, not a construction | ASSUMED — capture discipline: the authenticated session, `capture/` references and `meta.preCapture`. `EXPECTED_DATASET_SHA256` proves the bytes have not changed since pinning; `EXPECTED_BETS` / `EXPECTED_SEEDS` / `EXPECTED_EPOCH_SIZE` prove the population. Neither speaks to origin; the screenshots do not authenticate the session | No — a self-consistent forged capture would satisfy every scored step. This is DL-3; only an independent capture by a second party closes it |
| **P2** | Every multiplier a player was paid matches the pinned `PLINKO_FIXED_ODDS` / `PLINKO_WTF_ODDS` | `data/plinko-master-10100bets.json` (Steps 7 and 8 over all 10,100 bets) | Yes — a wrong value in any of the 285/365 observed cells fails Step 7 |
| **P3** | The 80 never-observed cells (incl. both WTF 1000× tails) equal the operator's live tables | ASSUMED — operator client bundle `0pm_um5zrrwwn.js` (not committed). `E04` shows one board whose nine cells were all paid live, so it adds no never-paid cell; `E05` shows the WTF tails only at the rounded label "1k". The other 78 never-paid cells have no witness | No — settled data has zero power over a cell that never paid (7.41% of summed theoretical RTP, up to 29.0% on 15r/3). The published-RTP rule bounds how far an error can move a board below 99%; it cannot confirm the cells. This is DL-1 |
| **P4** | Each epoch's client seed was outside the operator's control when its server-seed hash was committed | `data/plinko-master-10100bets.json` (`meta.preCapture` and the 202/202 chain; 192 epochs use auditor-generated `audit…` seeds) | **Partial, in three tiers:** substitution blocked for 192, conditional on authentic commitment timing (DL-3 / P1) — a digest carries no time, so ordering is attested by the capture procedure, not computed; unresolved for epoch 152 (DL-5a); fails outright for 153–161, where containment is statistical only (DL-5). Randomise Phase D client seeds next capture (`A4`) |
| **P5** | The audited `qa.liqd.com` build is the build served at `liqd.com` | ASSUMED — pre-launch capture; PROVISIONAL until the post-launch capture | No — a capture against one environment cannot witness another. This is DL-4 |
| **P6** | The capture tool's `epoch` and `phase` labels group the records correctly | ASSUMED as an input — written by the capture tool, not reconstructed. Scoring reads them: `tests/verify.ts` partitions phases on `phase`, Step 11 checks cohort sizes, Step 12 groups on `epoch`, Step 14 selects Phase D, Step 17 and `src/calibration.ts` key the calibrated null on `epoch` | **Partly.** The grouping must yield exactly 202 epochs × 50 nonces {0…49} matching the pinned plan, and `epoch` is redundant with the `hashedServerSeed` join, so an inconsistent relabelling fails Steps 4/11/12; a globally consistent one would not be detected. "Independently reconstructed" is not claimed. Distinct from the self-check flags, which no scored step reads |

Four premises are ASSUMED and disclosed rather than claimed as verified: P1, P3, P5 and P6 (as an input). Every mention of P3 or P5 must carry the same qualification.

**Scope and coverage.** Payout-table coverage is 285 of 365 cells. Capture provenance relies on the recorded collection process; independent capture or external attestation is not supplied. Seed-selection protection is the three-tier position above; no universal guarantee is made. Statistical sensitivity is limited by the nominal slot-test reference and the synthetic Pass 2 probe, which does not measure every attack or the mixed-board schedule played. Checks cover reported game payouts; wallet balances, withdrawals, payments and custody are excluded. Seed-rotation races, selective rejection, cross-account behaviour, server-seed generation and custody, and maximum-profit / maximum-odds enforcement are not established by this capture.

### Recommendations and production plan

**Operator recommendation P1 — publish the algorithm and payout tables.** A byte-level description of the HMAC-SHA256 bit draw (`cursor = row + 1`, `range = 2`, one bit per row, slot = count of 1-bits); the hex-decoded key and the `SHA-256(utf8(serverSeed hex string))` commitment, explicitly distinguished; the bit rule (the first four digest bytes, big-endian, mod 2) and any rejection rule the general helper applies to other ranges; public per-`(rows, riskLevel)` tables including WTF, linked from the PF panel (this audit transcribed them from the client bundle; no response from `/api/v1/fast-games/system/get-game-settings` is in this package); and a validation vector, e.g. `serverSeed=fc9a1d6fad00e0832fddfdea45435c85`, `clientSeed=auditb1141320acde`, `nonce=0`, `rows=8` → path `01101111`, slot 6.

**Operator recommendation P2 — adopt an external-entropy beacon.** Pinning one entropy component to drand or an L1 randomness beacon would collapse R-CHERRY from structural containment to LOW by construction. An architecture upgrade, not a fix for a current defect.

**Operator recommendation P3 — payout-table version stamp.** Add a per-config `version` or `contentHash` field so the client can display "config vX at bet time" beside each disclosure. Addresses R-CONFIG.

**A1 — WTF deep-tail sampling (R-BRACKET).** A targeted large-sample capture would report empirical WTF frequencies directly, and committing the operator's bundle chunk or a hashed `get-game-settings` response would let the 80 never-paid cells be verified against the live table.

**A2 — multi-account correlation study (R-MULTI).** A multi-account capture would close R-MULTI.

**A3 — seed-rotation race capture (R-RACE).** A dedicated concurrency capture of rotate/bet interleaving (S5-5), paired with the post-launch production verification.

**A4 — persistent- and predictable-client-seed capture (R-CHERRY live test).** A future capture should deliberately add a phase that keeps a predictable or persistent client seed across many rotations (e.g. 40, using unguessable but fixed seeds), and should use independently generated unpredictable client seeds chosen after the relevant commitment, with protocol records retained, so the structural tier holds for the whole capture. That converts Pass 2 into a live test for the predictable-seed population and is the concrete route to closing DL-5a; the alternative is a quantitative argument under an explicit adversary model.

**A4b — measure the true size of the tail-merged slot chi².** Measure the exact-null size per board size (multinomial Monte Carlo under the binomial null at n = 5,000), epoch-weight it and re-derive the expectation and survival from the measured α, with a producing artifact and a verifier-side recompute. Offline, no live access, no Pass 1 re-run. The published experiment must report seeds, trial counts, code version and uncertainty intervals; where discrete or asymptotic p-values are used, the Fisher statistic's reference distribution must be calibrated too. Power against explicit seed-selection strategies and observed-window alternatives, including the `A4c` scope, belongs in the same study. Until it is published, the figures stay explicitly nominal, and a statistical non-rejection is never reported as proof that bias is absent.

**A4c — a Phase D statistic on the board and stake actually played.** Build a statistic on the observed configuration and stake at each nonce, with a matching null and a power study for the hypothesised attack — or keep the claim limited to the synthetic probe, which is what this report does. Boards evaluated on the same (seed, nonce) must not be pooled as independent observations.

**A5 — independent verifier tool.** Ship a browser-ready single-file wrapper of the dependency-free `src/rng.ts` so players without Node.js can recompute their drops.

**A6 — balance-delta capture.** Record the wallet balance before and after each bet so the credit can be cross-confirmed against `winningAmount` (DL-8).

**Production certification plan.** The QA assessment is complete within the stated scope. Final production certification is conditional on an independent capture through the ordinary public production journey, without audit whitelisting or a privileged route (normal account requirements still apply), followed by verification and review. These are planned deliverables, not completed findings.

| Production work | Evidence required | What it can resolve |
|---|---|---|
| Public production capture | Exact capture program and run plan; production endpoints; full bet records; deployment identifiers; an independent witness or corroborating capture | Extends the assessment to the tested accounts, release and period, and strengthens provenance; it does not certify every future deployment |
| Complete table evidence | Archive the production bundle or configuration response holding all tables; compare every cell; tie observations to the applicable table version | Resolves the transcription gap; settlement of unobserved cells still needs observed payouts or controlled tests |
| Commitment-first seed selection | Record the next commitment, then generate a fresh cryptographically random client seed; rotate and verify the returned active commitment matches; retain every transition and reveal | Addresses predictable client-seed selection and strengthens evidence of commitment ordering |
| Complete attempt journal | Retain requests, responses, errors, timeouts, retries and nonce transitions; reconcile ambiguous attempts before retrying | Tests capture completeness; supports investigation of selective acceptance or missing bets |
| Wallet reconciliation | Account-ledger or settled-balance evidence matched to bet IDs | Extends payout arithmetic to account settlement; otherwise wallet settlement stays excluded |
| Calibrated capture design | Hypotheses, board/stake schedule, sample size, thresholds and stopping rules fixed in advance; false-positive rates and power measured offline with intervals | Quantifies test sensitivity and supports analysis of the actual production schedule |
| Targeted operational tests | Agreed scenarios for concurrent rotation/betting, account variation and payout limits, with expected outcomes and retained results | Extends coverage only to the cases executed; server security and seed custody need a separate access-based review |

Certification can be extended once the production evidence passes the applicable integrity, outcome, payout and statistical checks and any material discrepancy is resolved or reflected in the assessed scope. Unavailable evidence remains a named exclusion; the final statement will identify the production release, period, sample and coverage assessed.

## Terms

**Provably fair:** an outcome the player can verify after the fact from seeds committed before the bet. **Commit-reveal:** the server publishes `hashedServerSeed` before any bet and reveals the plaintext `serverSeed` on rotation; no external beacon is used. **Server seed:** a 32-character hex string (16 bytes), secret during betting, used as the HMAC key hex-decoded. **Commitment:** `SHA-256(utf8(serverSeed hex string))`, the Stake convention, deliberately distinct from the key. **Next server seed hash:** the following epoch's commitment, pre-committed before rotation. **Client seed:** the first HMAC message field, fixed within an epoch; a different client seed reproduces an identical path only by coincidence, at rate 2^−rows (1 in 256 on 8 rows, 1 in 65,536 on 16), so such coincidences are expected in a sample of a few hundred and are not a defect. **Nonce:** the bet's position in its epoch, 0–49 here. **Cursor:** the per-row HMAC index, `row + 1`. **Epoch:** the bets under one `(serverSeed, clientSeed)` pair, 50 in this capture. **Path / `dropDetails`:** the per-row bit string. **Winning slot:** the count of `1` bits, binomial B(rows, 0.5) on a fair board. **Risk level:** `{ LOW: 1, MEDIUM: 2, HIGH: 3, WTF: 4 }`, controls the multiplier spread, not the physics. **WTF mode:** the fourth risk level, 13 rows, only slots 0, 1, 12 and 13 pay. **Rapid Fire:** an auto-bet speed control, not a payout mode. **RTP:** return divided by stake; here the authoritative figure is theoretical, `Σ_k C(rows,k)·0.5^rows · multiplier(k)`; observed RTP is labelled as such. **House edge:** 1 − RTP. **Published-RTP rule (RTP-CLAIM):** holds every board to the RTP shown to players within 0.1 pp on the house side. **Modulo-bias rejection:** discarding chunks at or above `maxFair` before `mod range`; inert for `range = 2`. **Anti-circularity:** deriving probabilities from combinatorics, never from operator tables. **Chi-squared test:** observed against expected slot counts, `df = rows`. **Bonferroni correction:** family-wise control across 28 tests, α/28 = 3.5714×10⁻⁴ (z-critical 3.570), the scored threshold. **Serial independence:** lag-1 autocorrelation and the Wald-Wolfowitz runs *z* (slots binarised by board side, `slot > rows/2`, with the centre slot grouped with the left half on even boards) — one statistic, not two. **Cherry-picking:** choosing a server seed after seeing or predicting its client seed; **substitution** swaps a seed after commitment, **grinding** searches candidate seeds before committing. **Pass 1 / Pass 2:** the fresh-seed simulation and the casino-seed fixed-board probe. **EC-n:** scored Step n. **Hard fail:** a result that invalidates the claim outright. **Hash-pinning:** recording an artifact's SHA-256 and aborting on any change.

**Guard codes** used in the source comments and here: **G-BIND** — every population assertion binds to source records and `src/loader.ts` constants, never to a count the artifact supplies about itself; a row count is not an identity (a reviewer once obtained a clean Full Pass on a sibling package by shrinking a dataset 40% and doctoring its header). **G-VALID** — nothing is rejected for being merely surprising; exactness, a zero deviation or a round number is not evidence of fabrication. **G-RECOMPUTE** — a reference value is derived from the pinned config on every run, never read out of the artifact being checked, since a comparison of an artifact against itself certifies whatever it contains.

## Release history

**v1.0.0 — the audit of record, released 21 October 2026.** The first public release, published as one commit (release manifest `supersedes: null`, `signature` the fingerprint of the key that signs the release): verdict **PROVABLY FAIR — Full Pass**, 21 of 21 scored steps, over 10,100 bets in 202 seed epochs (`data/plinko-master-10100bets.json`, SHA-256 `871c485e…`), audit ID `PF-2026-LQ03` (confirmed by ProvablyFair.org), Framework 1.1 (1.0 until 14 October 2026). Its last change rebuilt `src/rng.ts` from a written specification, with the ProvablyFair.org site verifier kept as a second check (20 October 2026, under *Later corrections*); the recorded result is unchanged. A release is a signed, squashed commit with a matching tag and a `RELEASE-MANIFEST.json`; nothing reaches the published record any other way, and no tag is ever moved or deleted. Every artifact of record and its SHA-256 is listed in the release manifest. The narrative of how the package was built, including the review ledgers, is an internal record and does not ship.

**v1.0.1** (errata): adds `.gitattributes` (`* -text`) so a Windows git clone keeps every file byte-identical; no audit content changed.

**Review history.** Three external adversarial review rounds ran before publication; round 3 used two independent reviewers who re-executed rather than read. No published figure was refuted in any round.

**Round 4 — client QA, 10 September 2026.** Counterexamples were executed against the tooling. It refuted no published number: all 10,100 paths, slots and paid multipliers, all 202 commitments and 202 pre-commitment links, every RTP table against `Σ C(n,k)·payout[k]/2^n`, and both saved simulation passes replayed with no differences in the compared results. It found two ways the validator could bless bad input, both fixed:

- **The verifier accepted a fabricated 200% RTP row.** Step 16 compared `simRTP` with the artifact's own `theoreticalRTP`; setting both fields of the first Pass 1 row to `2`, and refreshing only the calibration file's simulation hash, gave 21 PASS with `verify` and `check-outputs` exiting 0. Fixed: Step 16 recomputes theory from the pinned config (`M26`, and `X08` in the reviewer's configuration).
- **The mutation runner reported 20 passing steps after a crash, before any step ran.** The declared-survivor branch tested for the absence of a FAIL marker. Fixed: positive proof of execution, an explicit `PASS` from every step in `expectPass` and exactly the failures in `expectFail`; the genuine `S00` still survived with its then-declared 19 PASS (17 today).
- **Replay and fresh experiment were conflated** (DL-11). **The derived-emission guard compared floating-point leaves byte-exactly** and could reject a run Step 17's 1e-9 tolerance accepts; fixed with field-specific comparison. **A failed run's JSON still read `passed: 21, hardFail: 0, verdict: "PROVABLY FAIR — Full Pass"` while the command exited 1**; fixed by finalising the verdict after every required validation (`outcome.*`).
- Also from this round: DL-12 and the nonce-based board rule (`boardOfEpoch`); DL-5a and the 192 / 1 / 9 cherry-pick tiers; C4/C5 rescoped onto Steps 5 and 6, `M23` renamed to the condition it injects, `M27` added; the evidence-status split and premise P6; value domains for every numeric leaf of every committed artifact (`src/domains.ts`), after `totalConfigs = -1` was accepted.

**Round 5 — client QA, 11 September 2026.** Two more counterexamples against the tooling, same shape — the artifact trusted to describe itself. It refuted no published number.

- **Pass 2 accepted fabricated results.** Three one-field edits, each with the calibration hash refreshed, returned 21/21, `verify` exit 0 and `check-outputs` exit 0: `edgeHitsEarly = 1,000,000,000` against an experiment containing 1,010,000 drops; a window `rtpEarly` of 0 on the 8-row low-risk board, whose smallest multiplier is 0.5; and `pTwoSidedZEarlyMinusLate = 0` in place of the calculated 0.551787. Fixed: Step 17 recomputes every reported Pass 2 figure and bounds each window RTP by the board the dataset assigns (`boardMultiplierRange`); `src/domains.ts` bounds the edge-hit counts at `EXPECTED_SEEDS × floor(PASS2_NONCES_PUBLISHED / 2)`. Registered as `M31`–`M33` and `X10`–`X12`.
- **The publication guard accepted a missing step.** Replacing Step 5 with a second copy of Step 4 still produced "21/21 Full Pass". Fixed: ids 1..21 each once under their declared names (`X13`).

**Later corrections recorded in the package.**

- **2026-09-11 (client QA D1):** verification stopped writing the evidence it scores. **2026-09-21:** run metadata (`generatedAt` and two `executionTimeMs`) removed from the simulation artifact (PLINKO-27, under which the simulation and calibration artifacts are pinned in source).
- **2026-09-24:** Step 16 began replaying the committed Pass 1 in full on every `npm test`. The first regeneration of the simulation with its own generator from the saved seeds (`npm run regen`, PLINKO-28) reproduced every numeric leaf (3,207 in all) and the chart byte for byte but differed in one descriptive string — the Pass 2 `description` still carrying the retracted "R-CHERRY is closed by construction for this capture" — and the calibration likewise in its `note` and its recorded simulation hash. Both were rewritten by their generators with 0 numeric differences, and the pins moved: simulation `f9fa37a8…` → `3d94a510…`, calibration `cf39fe98…` → `d4faed0b…`. The generator stopped writing five calibrated-null fields the artifact of record never carried. The same day DL-10 was closed, the ProvablyFair.org site verifier was vendored into Step 5, and `npm run test:full` measured exit 0 in 19 min 34 s on Node 22.23.1.
- **2026-09-29:** Step 21's profile policy set to informational; RTP-CLAIM rule 1.0.0 agreed. **2026-10-01:** RTP-CLAIM 1.1.0 agreed and enforced in Step 10; LIQD's live page read for E19.
- **2026-10-02:** the calibration was re-pinned `d4faed0b…` → `53dabd47…` after three descriptive strings (`note`, `windowScope`, `extendedWindow.scope`) stopped calling the 50-nonce window "the epoch the operator actually serves"; of its 2,323 leaves only those strings changed, and two consecutive runs gave identical bytes. The two rejection-sampling unit vectors were added (60 unit tests); `M51` was added and `M35` re-pointed to `src/rng.ts`; the battery moved to a temporary copy and began reading statuses from the scored record; the leaf comparison behind DL-6 was made.
- **2026-10-14 (Methodology v1.1):** RTP-CLAIM 1.1.0 → 1.2.0 (Mike, 14 October 2026; `src/rtp-claim.ts` re-vendored byte for byte, SHA-256 `c9a9c1c4…`; switch still on): an enforced miss would now mark Step 10 RTP FIGURE OVERSTATED and make the verdict RTP FIGURE OVERSTATED, exit 5, instead of a hard fail; the claim's source restated to name the game page (no figure changed). Framework 1.0 → 1.1 (D1), the S5 line added (D5); the profile was already cited as `1.0.2` (D6). `outputs/rtp-claim-table.json` re-written and re-pinned (`84f48588…`); `PF_EMIT=1 npm run verify` rewrote `outputs/verification-results.json`, `verification-stats.json` and `coverage-results.json` with the same bytes; bundles rebuilt; `RELEASE-MANIFEST.json` regenerated (framework and the table hash). Verdict unchanged, PROVABLY FAIR — Full Pass. `scripts/mutate.mjs` reads the new `[RTP FIGURE OVERSTATED] Step N` console marker; M51's guard text says what kills it under 1.2.0 (the committed table no longer matching, a reproduction failure).
- **2026-10-14, later (FIXPASS2 C3, the RTP FIGURE OVERSTATED route):** `npm test` became `node scripts/run-stages.mjs test` (every stage runs whatever the verdict; exit 1 if a stage other than `verify.js` fails, otherwise the verdict code), so `check-outputs` and `release-manifest --check` still run on an exit-5 verdict. `check-outputs` accepts a committed RTP FIGURE OVERSTATED record in one shape only (Step 10 the one OVERSTATED step, every other step PASS or INFO on an informational step, the committed RTP table recording the miss) and still refuses a FAIL or a FLAG. Six entries added to `tests/mutations-extra.json`: `C3i` (the rows-12 medium board priced 2 % lower where the RTP table reads it) and `C3ii` (the published figure raised to 99.25 % in `src/rtp-settings.ts`), each run first as edited (exit 1, Step 10 FAIL: a stale RTP table is a reproduction failure even under a miss) and then with `regen` on the `standalone` runner (table re-written and re-pinned, bundle rebuilt, records re-emitted with the full Pass 1 replay; the emission guard refuses records from a `PF_P1_REPLAY=off` run, which is why the first attempt on the `verify` runner ended exit 1, RUN NOT VALID): `node scripts/mutate.mjs --only=C3i,C3ii` → both KILLED, with regen exit 5, verdict RTP FIGURE OVERSTATED, 6 files restored byte-identical (partial run, exit 3). `X20`–`X23` hand-shape the committed record as an OVERSTATED release and add a hard fail (X20), a FLAG (X21), a table that holds (X22) or the OVERSTATED status on Step 9 (X23): `--only=X20,X21,X22,X23` → 4/4 refused by `check-outputs` with the named message (partial run, exit 3). End to end in a scratch copy, `C3ii`'s edit with the table re-pinned, the bundle rebuilt, `PF_EMIT=1 node verify.js` (exit 5) and `RELEASE-MANIFEST.json` regenerated: `node scripts/run-stages.mjs test` exit 5, `[check-outputs] OK: 21/21 steps, hardFail 0, verdict "RTP FIGURE OVERSTATED"`, release manifest OK. The committed verdict and every figure of this package are unchanged.
- **20 October 2026.** `src/rng.ts` rebuilt from a written specification instead of reconstructed from LIQD's client bundle: the specification, [docs/ALGORITHM.md](docs/ALGORITHM.md) (SHA-256 `3376ef22…d1ad70bb`), was written from LIQD's public pages, the standard provably-fair construction and the captured drops without opening LIQD's code, its bundle or any port of it, and the module was written from that specification and a module-interface file alone. The ProvablyFair.org site verifier is kept as a second check; no LIQD verifier output is captured in this package, so there is no comparison against LIQD's own verifier. Measured on integration over all 10,100 drops, seeds paired to drops by hashing: path 10,100/10,100 and `winningSlot` 10,100/10,100 against the capture, commitments 202/202 plus the pre-capture seed, and the site verifier's path, slot and row count 10,100/10,100. Off the captured data the rebuilt module differs from the earlier port only on inputs no drop reaches: it takes the first four digest bytes mod range for every range, with no rejection step (the specification defines range 2 only, where the two agree; on 200,000 random range-2 draws they agreed on all), and it throws on a non-hex or odd-length server seed, a negative nonce or rows outside 8–16. The Step 5 bias bound moved to `src/bias.ts`, now with a census on the module itself (131,970 row draws: path bit = range-2 draw = full 32-bit draw mod 2 on all). The four `generateProvablyFairNumber` vectors at ranges 25, 52 and 3,000,000,000 were removed from `tests/plinko/rngTests.ts` and the specification's 55 checks added as `tests/plinko/rngSpecTests.ts` (57 unit tests). Mutations `M01` (digest bytes read little-endian) and `M35` (biased bit draw; until now: rejection removed) retargeted to the rebuilt module. No simulation artifact was regenerated: the RNG's outputs are unchanged and Step 16 replays the committed Pass 1 from its saved seeds. `outputs/verification-results.json` re-emitted with `PF_EMIT=1 npm run verify` (Step 5 detail and the profile notes changed; `verification-stats.json` and `coverage-results.json` came out byte-identical); bundles rebuilt; `RELEASE-MANIFEST.json` regenerated. Verdict unchanged: `npm test` on Node 22.23.1 exits 0, 57 passing, 21/21, PROVABLY FAIR — Full Pass, REPRODUCED, release manifest OK. `npm run mutate` on the committed tree (Node 22.23.1): 79/79 behaved as declared, 0 did not; the declared survivor `S00` survived as declared with 17 in-scope steps PASS; 26 touched files restored byte-identical in the working copy.
- **21 October 2026 (release `v1.0.0`).** Release wording only; no step, figure, scored artifact or verdict changed. The release lines name `v1.0.0`, the first public release; a comment in `src/rng.ts` dates the rebuild instead of naming a version; bundles rebuilt; `RELEASE-MANIFEST.json` regenerated (`release` `v1.0.0`, `supersedes` null, `signature` the release key's fingerprint).

### 4 October 2026 — consolidated documentation

The 23 Markdown documents were reduced to **README.md and this MANIFEST.md**. Repeated explanations were removed; every finding, step result, flag, declared limitation, premise, recommendation, evidence exhibit and dated correction was carried into the sections above, and the dataset, payout tables, outputs of record and verification logic were not changed. No claim's scope, verdict or RTP wording changed. Code and artifact references to the removed files now point to sections of this overview: the profile-coverage map (`src/profile-map.ts`), the Step 17 detail string, source comments, the release-manifest generator (which now checks the audit ID in README.md and MANIFEST.md only) and Step 20's guide reader (MANIFEST.md only). The verification record was regenerated with `PF_EMIT=1 npm run verify` and the release manifest with `npm run release-manifest`; no numerical result moved. No new casino capture, simulation regeneration or mutation-battery run is asserted for this update.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| `executive-summary.md`, `conclusion.md` | Conclusion and scope; README |
| `scope-and-methodology.md` | Conclusion and scope; Dataset and capture |
| `AUDIT_CONTEXT.md` | Dataset and capture; Payouts and RTP; Verification results; Limitations and trust (scope, premises, production plan) |
| `game-rules.md`, `system-architecture.md`, `rng-algorithm-analysis.md` | Game and algorithm |
| `game-logic-verifiability.md` | Game and algorithm; Payouts and RTP; Verify a bet |
| `payout-verification.md`, `rtp-analysis.md` | Payouts and RTP |
| `live-parity-testing.md`, `edge-case-analysis.md` | Dataset and capture; Payouts and RTP; Verification results |
| `exploit-testing.md`, `findings.md` | Verification results |
| `operator-trust-analysis.md`, `recommendations.md` | Limitations and trust |
| `reproducibility.md` | Reproduce the audit |
| `evidence.md` | Evidence |
| `glossary.md` | Terms |
| `CHANGELOG.md`, the former manifest's review history | Release history |
| The former `MANIFEST.md` (algorithm, dataset, artifacts, model anchors, declared limitations, premises) | Game and algorithm; Payouts and RTP; Evidence; Limitations and trust |
| `SUMMARY.md` and the README table of contents | Contents; README |
