# LIQD Plinko Fairness Audit

**Audit:** PF-2026-LQ03 · **Game:** Plinko (`fast-games-5`) · **Auditor:** ProvablyFair.org · **Currency:** USDC

**Assessment: PASS for the audited QA dataset. Certification: provisional pending production validation.**

This completed initial audit examines 10,100 recorded Plinko bets from LIQD's pre-release environment, `qa.liqd.com`, captured on 7 July 2026. Every recorded path and winning slot reproduces from the revealed server seed and recorded client seed, nonce and row count. All recorded multipliers and payout calculations match the audited tables.

The repository contains the dataset, an independently implemented outcome algorithm, payout tables, verification tests and simulation results. [AUDIT_CONTEXT.md](AUDIT_CONTEXT.md) provides the methodology, worked examples, evidence map and production certification plan.

## What this audit verifies

| Check | Result for the assessed scope |
|---|---|
| Outcome reproducibility | **10,100 / 10,100** recorded paths and slots match recomputation. |
| Seed commitments | **202 / 202** revealed seeds match their recorded SHA-256 commitments. The recorded chain includes 201 epoch transitions and one pre-capture link. |
| Payout conformance | **10,100 / 10,100** recorded multipliers and reported payouts agree with the tables and stake arithmetic. The sample exercises **285 of 365** payout cells. |
| Theoretical RTP | **98.9063%–99.1602%** per configuration; **99.0152%** equal-weighted mean across 28 configurations, derived from the binomial slot model and audited tables. |
| Theoretical house edge | **0.8398%–1.0938%** per configuration; **0.9848%** equal-weighted mean. It is stake independent within each table before applying any external payout limits. |
| Client-seed sensitivity | Changing the client seed in local recomputation changes **1,008 / 1,010** tested paths (**99.8%**). The client seed is an input to the reconstructed RNG. |
| Simulation checks | The published experiment covers **28 configurations × 1,000,000 rounds**. Its slot and serial checks pass at the specified Bonferroni thresholds. The saved experiment can be replayed from its seeds. |
| Seed-consistency analysis | All **202** revealed seeds are re-evaluated by the defined synthetic window tests. The payout-weighted test does not reject its calibrated reference model. |
| Verification result | The published result records **21 / 21 PASS**, with no flags or hard failures. |

These conclusions concern the supplied capture and reconstructed game logic. The theoretical distribution assumes fair row decisions; a finite sample does not establish an exact distribution for every future bet. The seed-consistency result is scoped to its stated experiment, rather than a guarantee against every seed-selection strategy.

## Coverage and exclusions

The algorithm and full payout tables were reconstructed from the operator's public client bundle. Observed bets corroborate 285 table cells; the other 80 rely on that reconstruction. The source bundle is not included. Hash checks protect the supplied files, while capture origin and commitment chronology rely on the recorded collection process.

The capture's seed-selection assessment distinguishes 192 epochs using auditor-random client seeds, nine using predictable client seeds, and one whose predictability at commitment remains unresolved. The detailed interpretation is in [Scope and coverage](AUDIT_CONTEXT.md#scope-and-coverage).

This assessment excludes:

- Production-environment behavior and future deployments.
- Infrastructure security, server-seed custody and broader account security.
- Wallet balance reconciliation, payments, withdrawals and asset custody.
- Enforcement of maximum-profit, maximum-odds and other account-level limits.
- Promotional, bonus and loyalty rules beyond the recorded base-game payout calculations.
- Untested operational attacks, including concurrent seed rotation and betting, selective bet rejection and cross-account behavior.

## Why certification is provisional

The initial QA assessment is complete. Final production certification requires an independent capture through the ordinary public production journey, without audit whitelisting or a privileged test route. “Anonymous” refers to the auditor's treatment by the game; normal account and access requirements still apply.

The production program will retain production build and table evidence, establish commitment-before-client-seed ordering, record every attempted bet, and seek wallet-ledger reconciliation. Statistical calibration and operational tests will accompany the capture where required. The [production certification plan](AUDIT_CONTEXT.md#production-certification-plan) states which exclusions each step can address and the evidence required for closure. Until those checks are completed, production remains outside this certification.

## Run the audit

With Node.js 22 or later and npm installed, open this directory and run:

```sh
npm test
```

The command checks that the bundled code matches its source manifest, runs all 58 unit tests and 21 scored checks, replays the complete 28-million-round Pass 1 experiment, and validates the published artifact hashes. **No dependency installation or casino access is required.** The scored checks include all recorded bets and the full Pass 2 seed experiment. Results are written under `outputs/run/`; the committed evidence is preserved. Full replay is compute intensive and prints progress across the 28 configurations.

For a shorter run, `npm run test:quick` performs the unit suite, scored verification and artifact checks while omitting Pass 1 replay. Developers can rebuild and verify the bundled code using the locked toolchain:

```sh
npm ci --include=dev
npm run build
npm run check:build
```

After dependency installation, `npm run mutate` runs the 49-entry mutation battery and `npm run test:toolchain` runs the audit directly from TypeScript. See [Reproduction and testing](AUDIT_CONTEXT.md#reproduction-and-testing) for the commands and build-integrity checks.

## Dataset integrity

```text
data/plinko-master-10100bets.json
SHA-256  871c485ef0d55ca38af2cece4880abdc32fe8b62584468c5d4cfdfd01506fc95

plinkoConfig.json
SHA-256  f8eaf67e1ffc63ee0dc21123447581c55f443c167dcb451b45ab7cd108fe712f
```

The verifier checks both pins before scoring the audit and refuses changed bytes unless the corresponding source pin is deliberately changed. Recompute the dataset hash with `shasum -a 256 data/plinko-master-10100bets.json`.

Licence: [MIT](LICENSE).
