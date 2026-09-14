# LIQD Plinko Audit Methodology and Evidence

**Audit ID:** PF-2026-LQ03

**Assessment: PASS for the audited QA dataset. Certification: provisional pending production validation.**

This document explains the completed initial assessment: the records examined, the outcome and payout calculations, the verification results, the scope of those conclusions, and the evidence required to extend certification to production. The README provides the summary and primary run command.

## Assessed dataset

The dataset records one authenticated session against `qa.liqd.com`, LIQD's pre-release environment, on **7 July 2026, 02:12–04:16 UTC**, in USDC. It contains **10,100 bets**, **202 revealed seed epochs** and **50 bets per epoch**, with nonces 0–49. Recorded stakes total **$2,990.00** and reported payouts total **$2,412.46**.

| Phase | Recorded bets | Purpose and stakes |
|---|---:|---|
| A | 5,400 | Coverage of the 27 standard configurations at $0.10. |
| B | 2,000 | Additional 16-row, high-risk observations at $0.10. |
| C | 200 | Outcome recomputation at a $10 stake on the 16-row, high-risk board. |
| D | 500 | Ten custom-client-seed epochs across standard configurations at $0.10. |
| E | 2,000 | WTF mode at $0.10. |

The expected population and phase counts are constants in `src/loader.ts`. Verification checks the records and dataset header against those constants, rather than accepting a smaller population declared by the input file.

The supplied implementation is the auditor's reconstruction of the algorithm in the operator's public client bundle. `plinkoConfig.json` contains the reconstructed payout tables. It is not operator-supplied server source. The source bundle identified by the capture documentation, `0pm_um5zrrwwn.js`, is not included in this package.

## Evidence and data integrity

| Artifact | Role |
|---|---|
| `data/plinko-master-10100bets.json` | Recorded bet inputs, results, seed reveals and capture metadata. |
| `plinkoConfig.json` | All audited payout tables, including WTF. |
| `src/rng.ts`, `src/config.ts` | Outcome reconstruction, table lookup and theoretical RTP. |
| `tests/verify.ts`, `tests/steps/` | The 21 scored verification checks. |
| `test.js`, `verify.js`, `replay.js` | Bundled JavaScript entry points used by `npm test`. |
| `standalone-manifest.json`, `scripts/build-standalone.mjs` | Source/bundle hashes and the reproducible local build. |
| `outputs/verification-results.json` | Published scored result and artifact hashes. |
| `outputs/verification-stats.json` | Structured values supporting the reported figures. |
| `outputs/coverage-results.json` | Observed payout-cell coverage by configuration. |
| `outputs/simulation-results.json` | Saved Pass 1 and Pass 2 experiments. |
| `outputs/calibration-results.json` | Calibrated reference distribution for the payout-weighted seed test. |
| `tests/mutations.json`, `tests/mutations-extra.json` | Defined counterexamples and their expected outcomes. |
| `capture/` | Illustrative capture references; the exact program that produced the dataset is not supplied. |
| `evidence/` | UI illustrations supporting the description of the game and fairness panel. |

The dataset and table pins are:

```text
data/plinko-master-10100bets.json
SHA-256  871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95

plinkoConfig.json
SHA-256  f8eaf67e1ffc63ee0dc21123447581c55f443c167dcb451b45ab7cd108fe712f
```

These pins establish byte integrity relative to the values in the source. They do not independently authenticate the origin of the records. The published verification artifact identifies its own run with `generatedAt` and records the hashes of the evidence it assessed. `npm run check-outputs` compares those hashes with the files present in the package.

### Reading a bet

The dataset has the structure `{ meta, seeds, bets }`. Join a bet's `hashedServerSeed` to the matching entry in `seeds` to obtain the revealed `serverSeed`.

| Fields | Interpretation |
|---|---|
| `id`, `nonce`, `clientSeed`, `hashedServerSeed` | Recorded bet identifier and RNG inputs. |
| `numberOfRows`, `riskLevel` | Recorded board selection. Risks 1–3 are low, medium and high; risk 4 is WTF. |
| `dropDetails`, `winningSlot` | Recorded path and destination slot. |
| `multiplier`, `coefficient`, `betAmount`, `winningAmount` | Recorded payout values; amounts are decimal strings. |
| `epoch`, `phase` | Capture grouping labels consumed by verification and constrained by population, nonce and seed-join checks. |
| `localPath`, `localSlot`, `verified`, `seeds[].commitVerified`, `seeds[].chainLinkOk` | Capture self-check fields. The scored checks independently recompute these properties rather than using these flags. |
| `currentGameSettings` | Recorded settings metadata. It contains limits and a house-edge label, not the full payout tables. |

The dataset's `won` label includes a 1× return of stake; it is not a count of strictly profitable bets. Payout verification uses the amount fields directly.

## Outcome and commitment calculation

For a revealed server seed, the commitment hashes the UTF-8 bytes of its hexadecimal **string**:

```text
commitment = SHA-256(UTF8(serverSeed))
```

The outcome calculation uses the decoded hexadecimal bytes as the HMAC key:

```text
key = HEX_DECODE(serverSeed)
for cursor = 1 to rows:
    message = clientSeed + ":" + nonce + ":" + cursor
    digest = HMAC-SHA256(key, UTF8(message))
    read digest in unsigned 32-bit, big-endian chunks
    take the first chunk below floor(2^32 / range) * range
    direction = chunk mod range
path = concatenated directions
slot = number of 1s in path
```

Plinko uses `range = 2`. Every unsigned 32-bit value is below `2^32`, so the first chunk is always accepted. The general helper's rejection and digest-exhaustion branches are not exercised by Plinko; its generic fallback increases the cursor by 1,000,000 and retries.

Row count controls the number of decisions. Risk selects the payout table. Stake is not an input to this reconstructed RNG. WTF uses the same calculation with 13 rows.

All **202** revealed server seeds match their recorded commitments. The chain compares each epoch's `nextHashedServerSeed` with the following epoch's commitment. The **201** transitions plus the `meta.preCapture` link provide **202** recorded pre-commitment links. Their equality is computationally verifiable; the real-world ordering of capture events relies on the collection records.

## Payouts and theoretical return

For standard boards, the lookup is `payout_tables[String(rows)][riskLevel - 1][slot]`. WTF uses `wtf_mode.odds[slot]`:

```text
[1000, 235, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 235, 1000]
```

All **10,100** recorded multipliers match their table entries at the verifier's `1e-9` tolerance. All reported payouts satisfy `winningAmount = betAmount × multiplier` at `1e-6`, with finite operands required. These checks establish conformance for observed results. Wallet balance changes are outside the current evidence.

Under the fair-row model, the probability of slot `k` on an `n`-row board is:

```text
P(slot = k) = C(n, k) / 2^n
RTP(n, risk) = sum over k of [C(n, k) * payout[k]] / 2^n
house edge = 1 - RTP
```

For example, the 8-row low-risk table is `[5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6]`. Its binomial weights are `[1, 8, 28, 56, 70, 56, 28, 8, 1]`. The weighted payout sum is **253.4**, giving **253.4 / 256 = 0.98984375**, or **98.984375% RTP**.

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

WTF RTP is **98.9990234375%**: `(2 × 1000 + 2 × 13 × 235) / 8192`. Across all **28** configurations, the RTP range is **98.90625%–99.16015625%**, with an equal-weighted mean of **99.0152413504464%**. The corresponding house-edge range is **0.83984375%–1.09375%**, with a mean of **0.9847586495536%**. These are configuration averages, not a forecast for an unspecified player betting mix.

Step 10 checks the binomial calculation against exhaustive enumeration of every possible left/right path. Both calculations use the audited tables, so agreement validates the arithmetic. Table-source and observed-cell coverage are described below.

The sample's reported return is **80.6843%**, calculated from `$2,412.46 / $2,990.00`. This describes the captured wagers. The analytical RTP, rather than this short and unevenly weighted sample, supports the stated theoretical return.

## Worked examples

These six records cover standard and WTF boards, the first and last nonce of an epoch, both captured stake sizes, a return of stake, a zero payout and an edge payout. Each result below can be recomputed from its seed join without reading the capture's self-check flags.

| Bet ID | Epoch / nonce | Rows / risk | Path | Slot | Multiplier | Stake | Reported payout |
|---|---|---|---|---:|---:|---:|---:|
| `SLOjmT9dyuUEi1que576R` | 0 / 0 | 8 / 1 | `01101111` | 6 | 1.1 | 0.10 | 0.11 |
| `Fj4Kfh41bSVPiGZgcHPWn` | 0 / 49 | 8 / 1 | `00010110` | 3 | 1 | 0.10 | 0.10 |
| `GPo6VRX5ozyp8mZABG3ag` | 148 / 0 | 16 / 3 | `1111010101001110` | 10 | 0.2 | 10.00 | 2.00 |
| `b1Ot4NpfMzpQe4ku9cZ7O` | 161 / 47 | 11 / 3 | `11111111111` | 11 | 120 | 0.10 | 12.00 |
| `tTrs85fv3NF028ROZv0WQ` | 162 / 0 | 13 / 4 | `1000100111001` | 6 | 0 | 0.10 | 0.00 |
| `2tGmOv7FZHfyCwhX7yCS3` | 175 / 32 | 13 / 4 | `1111101111111` | 12 | 235 | 0.10 | 23.50 |

For the first bet, `serverSeed = fc9a1d6fad00e0832fddfdea45435c85`, `clientSeed = auditb1141320acde`, `nonce = 0`, and `rows = 8`.

Commitment: SHA-256(utf8("fc9a1d6fad00e0832fddfdea45435c85")) = 3b34a0fce5732f2d9c89b16fca9c2b6a231c2b7f2de29bbc41e141861dc39d36, matching the recorded hashedServerSeed.

The HMAC message is `auditb1141320acde:0:<cursor>`. Its first four digest bytes give:

| Cursor | First four bytes | Unsigned integer | Direction |
|---:|---|---:|---:|
| 1 | `1bc5cc26` | 465947686 | 0 |
| 2 | `0f9d6173` | 261972339 | 1 |
| 3 | `dbdb6f8d` | 3688591245 | 1 |
| 4 | `f460931e` | 4099969822 | 0 |
| 5 | `ce51a3ed` | 3461456877 | 1 |
| 6 | `056cc631` | 91014705 | 1 |
| 7 | `0cf8aab5` | 217623221 | 1 |
| 8 | `136bb6c5` | 325826245 | 1 |

The resulting path is `01101111`, with six right decisions and therefore slot 6. The table pays `1.1×`; `0.10 × 1.1 = 0.11` matches the reported payout.

## Verification results and evidence map

The published result records **21 PASS**, **0 flags** and **0 hard failures**. Each group below points to the source checks and the evidence supporting its claim.

| Steps | Property checked | Evidence and implementation |
|---|---|---|
| 1–3 | Revealed-seed hashes, recorded commitment chain and within-epoch consistency. | Dataset `seeds`, `meta.preCapture`, `bets`; `tests/steps/commitment.ts`. |
| 4 | Nonce population and consistency within seed epochs. | Dataset; `tests/steps/commitment.ts`. |
| 5 | All 10,100 recorded paths and slots reproduce. | Dataset and `src/rng.ts`; `tests/steps/determinism.ts`. |
| 6 | Local client-seed sensitivity: 1,008 changed paths in 1,010 comparisons. | `tests/steps/determinism.ts`; Step 6 data in the verification artifact. This measures local recomputation. |
| 7–8 | Recorded multiplier lookup and reported payout arithmetic. | Dataset and `plinkoConfig.json`; `tests/steps/payouts.ts`. |
| 9–10 | Configuration coverage and analytical RTP. | `src/config.ts`, `plinkoConfig.json`; `tests/steps/payouts.ts`. |
| 11–12 | Phase counts and epoch population. | Dataset and population constants in `src/loader.ts`; `tests/steps/dataset.ts`. |
| 13 | Binomial coefficients agree with an independently constructed integer recurrence. | `tests/steps/anti-circularity.ts`. |
| 14–15 | Custom-client-seed phase and WTF-mode conformance. | Phases D/E; `tests/steps/phase-d.ts` and `tests/steps/wtf.ts`. |
| 16 | Saved Pass 1 population, theory, summaries, convergence traces and statistical thresholds. | `outputs/simulation-results.json`; `tests/steps/simulation.ts`. Full trajectory replay is included in `npm test` and can also run separately. |
| 17 | Full Pass 2 seed recomputation and calibration reconciliation. | Dataset, simulation and calibration artifacts; `tests/steps/simulation.ts`. |
| 18–20 | Stake-independent reconstructed outcomes, table symmetry, published pins and artifact value domains. | `tests/steps/standardization.ts`. |
| 21 | Captured slot-distribution check under the specified binomial reference model. | Dataset; `tests/steps/live-fit.ts`. Its reference probabilities are nominal. |

### Simulation interpretation

**Pass 1** contains **28 configurations × 1,000,000 rounds = 28,000,000 rounds**. Its saved slot and serial results have **0 Bonferroni failures** in their respective 28-configuration families at the implemented thresholds. `npm run replay` reconstructs that saved experiment from each row's server and client seed, checking **812 numeric fields**, including **560 convergence points**. New simulations use new seeds and have their own results.

**Pass 2** extends each of the **202** revealed seeds to **10,000 nonces**, using the board of that epoch's lowest-nonce bet. It compares the first and second halves through specified slot and payout statistics. Verification re-executes every epoch, reconciles its window RTPs, p-values, z-scores and flag, and re-derives **14** summary and header values.

The payout-weighted early-window count is **6**, against a calibrated expectation of **5.8556**, with survival probability **0.5337**. The paired early-minus-late statistic is approximately **0.60**, with the implemented two-sided normal-approximation p-value **0.5518**. These results do not reject the specified reference model.

The slot-flag calculation records **11 flags**, compared with **9.595** expected under a nominal per-window 5% false-positive assumption. That assumption has not been empirically calibrated for every board and window; the same qualification applies to the captured-slot reference test. A statistical pass reports the behavior of those tests, rather than proving that all possible bias or seed selection is absent.

For the ten mixed-board epochs 152–161, Pass 2 evaluates one board per epoch over synthetic nonces; it does not reproduce the actual mixed-board payout schedule. These statistical and design limits are addressed in the production plan.

## Reproduction and testing

From the extracted repository directory, with Node.js 22 or later and npm installed:

```sh
npm test
```

`npm test` checks source/bundle integrity, executes all 58 unit tests and the 21 scored checks, replays the full 28-million-round Pass 1 experiment, and checks the published reports and hashes. The bundled entry points use Node's built-in modules and require no dependency installation. The verifier includes all recorded outcomes and the full Pass 2 experiment. Full Pass 1 replay prints progress across all 28 configurations.

Default verification writes its report, statistics, coverage and `diff.json` under `outputs/run/`. A failed verification is recorded there as `verification-results.failed.json`. The committed evidence remains unchanged. Review the process exit status, the overall result and any reported differences; a stored summary is not a substitute for executing the checks.

| Command | Purpose |
|---|---|
| `npm test` | Source/bundle integrity, unit suite, scored verifier, full Pass 1 replay and artifact guard; no dependency installation needed. |
| `npm run test:quick` | The same checks except Pass 1 replay; a shorter diagnostic run. |
| `npm run replay:standalone` | Full saved Pass 1 replay alone, without development dependencies. |
| `npm run check-outputs` | Validate the published 21-step result, step identities, run status and artifact hashes. |
| `npm ci --include=dev` | Install the locked development toolchain for the commands below. Requires package access or a populated cache. |
| `npm run build` | Rebuild all three JavaScript entry points and their manifest from TypeScript. |
| `npm run check:build` | Rebuild in memory and require byte-identical JavaScript and manifest output. |
| `npm run test:toolchain` | Build reproduction, Mocha unit suite, full Pass 1 replay, source verifier and artifact guard. |
| `npm run replay` | Full saved Pass 1 replay only; writes no evidence files. |
| `npm run mutate` | Execute the declared counterexamples and check their specified outcomes. |
| `npm run gate` | Build reproduction, complete `npm test` and mutation battery; requires the development dependencies. |
| `npm run simulate` | Generate a new experiment under `outputs/fresh/`. |
| `npm run test:fresh-experiment` | Unit suite, new simulation and calibration under `outputs/fresh/`. |
| `npm run report` | Explicitly regenerate the committed verification reports, after reviewing and validating the intended changes. |

`scripts/build-standalone.mjs` compiles the repository's TypeScript with the locked TypeScript version. `standalone-manifest.json` records the source inventory, unit-test inventory, build inputs and compiled-file hashes. The default test command checks these without installing dependencies. Editing a TypeScript fixture or a bundled file without rebuilding therefore fails immediately instead of silently running stale code. `npm run check:build` additionally verifies that compilation reproduces the committed bundles; the hash manifest alone is not an independent proof of compilation.

The source verifier compares newly derived statistics and coverage with committed evidence. Integers, hashes and non-numeric values are compared exactly; numerical statistics use declared tolerances. The publication guard requires 21 distinct passing step IDs, matching names, a completed passing run, full epoch attestation and matching evidence hashes. Reduced-attestation and baseline-development modes do not satisfy the publication guard.

### Tests that can reject incorrect inputs

The registry contains **49 entries**: **34** scored-step mutations and **15** additional entries covering publication guards and one declared residual. The runner applies each edit in turn, invokes its specified check, requires the intended result and restores the touched files. An entry that cannot be applied is a setup failure, not a successful rejection.

For example, **M14** changes the dataset hash printed in `README.md`; Step 20 must reject the mismatch. **M04** injects a non-numeric reported payout after dataset loading; Step 8 must reject it. These test both published evidence consistency and payout validation.

The **S00** case changes an unobserved WTF payout cell and updates its pin. It documents the remaining table-source dependency: observed bets cannot authenticate a cell they never exercised. Its expected Step 16/17 failures reflect disagreement with the saved experiment's table, rather than independent confirmation of the operator's unobserved payout. The registry explicitly distinguishes this case from mutations that demonstrate semantic detection.

## Scope and coverage

The audit establishes reproducibility and internal game-logic conformance for the recorded QA sample. Its principal dependencies and exclusions are:

| Area | Current scope |
|---|---|
| Payout-table coverage | **285 of 365** cells were observed. The other **80** rely on the reconstructed tables, including both WTF 1000× edge cells. They contribute **7.4086%** of the sum of theoretical returns across configurations. |
| Capture provenance | The audit relies on the recorded collection process for origin and chronology. Hashes establish file integrity; independent capture or external attestation is not supplied. |
| Seed-selection protection | The 192 auditor-random-client-seed epochs support the commitment-ordering argument conditional on authentic timing and unpredictability. Nine epochs, 153–161, used predictable client seeds; epoch 152's predictability at commitment remains unresolved. No universal seed-selection guarantee is made. |
| Statistical sensitivity | The slot-test reference probabilities are nominal, and the synthetic Pass 2 probe does not measure every attack or the mixed-board schedule actually played. |
| Wallet and payments | Checks cover reported game payouts. Wallet balances, withdrawals, payments and custody are excluded. |
| Operational controls | Seed-rotation races, selective rejection, cross-account behavior, server-seed generation/custody and maximum-profit/maximum-odds enforcement are not established by this capture. |
| Production and surrounding products | Production deployments and promotional, bonus, loyalty, infrastructure and account-system behavior outside the captured base-game calculations are excluded. |

## Load-Bearing Premises

| Premise | Basis and effect on the conclusion |
|---|---|
| P1 Capture authenticity | The records are assumed to reflect the stated QA session. Independent origin attestation is outside the supplied evidence. |
| P2 Observed payout agreement | Directly checked against all recorded bets; 285 table cells are exercised. |
| P3 Unobserved table values | The remaining cells depend on the operator-bundle reconstruction. Complete source-table evidence is a production deliverable. |
| P4 Commitment timing and client-seed unpredictability | The recorded chain is verified. The structural seed-selection interpretation remains conditional on authentic ordering, with the 192/9/1 coverage distinction above. |
| P5 Production equivalence | Production parity is not verified or assumed for the current verdict. Certification remains provisional until the production assessment passes. |
| P6 Capture grouping | Epoch and phase labels are capture inputs constrained by the seed joins, nonce structure and fixed population checks; they are not independently reconstructed provenance. |

The screenshots illustrate the game interface and fairness panel. In particular, the identifiers in `E02-provably-fair-panel.png` do not identify an epoch in this dataset. Neither screenshots nor illustrative capture scripts independently authenticate the recorded session. `outputs/rtp-convergence.html` is a presentation aid; the numerical simulation claims above use the JSON artifact and replay implementation.

## Production certification plan

The initial QA assessment is complete within the stated scope. Final production certification is conditional on a successful independent capture through the ordinary public production journey, without audit whitelisting or a privileged route, followed by verification and review of the evidence below. Normal account/access requirements still apply. These are planned deliverables, not completed findings.

| Production work | Evidence required | What it can resolve |
|---|---|---|
| Public production capture | Exact capture program and run plan; actual production endpoints; full bet records; available deployment identifiers; an independent witness or corroborating capture. | Extends the assessment to the tested production accounts, release and period, and strengthens capture provenance. It does not certify every future deployment. |
| Complete table evidence | Archive the production bundle or configuration response containing all payout tables; extract and compare every cell; associate observations with the applicable table version. | Resolves the table-transcription evidence gap. Actual settlement of unobserved cells remains separate and needs observed payouts or controlled tests tied to the deployed implementation. |
| Commitment-first seed selection | Record the next-server-seed commitment, then generate a fresh cryptographically random client seed; rotate and verify the returned active commitment matches the one already recorded. Retain every transition and final reveal. | Addresses predictable client-seed selection in the new sample and strengthens evidence for commitment ordering. |
| Complete attempt journal | Retain requests, responses, errors, timeouts, retries and nonce transitions; reconcile ambiguous attempts against bet history before retrying. | Tests capture completeness and supports investigation of selective acceptance or missing bets. |
| Wallet reconciliation | Obtain account-ledger or settled balance evidence matched to bet IDs; reconcile stake debits, game credits and other adjustments. | Extends payout arithmetic to observed account settlement. If that evidence is unavailable, wallet settlement remains excluded. |
| Calibrated capture design | Specify hypotheses, board/stake schedule, sample size, thresholds and stopping rules in advance; measure false-positive rates and detection power with reproducible offline experiments and intervals. | Quantifies the statistical tests' sensitivity and supports analysis of the actual production betting schedule. |
| Targeted operational tests | Agreed scenarios for concurrent rotation/betting, account variation and payout limits, with explicit expected outcomes and retained results. | Extends coverage only to the operational cases executed. Server security and seed custody require a separate access-based review. |

Certification can be extended once the production evidence passes the applicable integrity, outcome, payout and statistical checks and any material discrepancies are resolved or reflected in the assessed scope. Any unavailable evidence remains a named exclusion. The final statement will identify the production release, period, sample and coverage actually assessed.
