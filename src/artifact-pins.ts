/**
 * Source-of-truth SHA-256 pins for the two SCORED output artifacts (PLINKO-27).
 *
 * The dataset and plinkoConfig.json are already pinned in source — EXPECTED_DATASET_SHA256
 * in src/loader.ts and PLINKO_CONFIG_SHA256 in src/config.ts — and enforced at load time.
 * The simulation and calibration artifacts were previously only self-recorded inside
 * verification-results.json's `artifactHashes`, so the only anchor was the value the run
 * itself wrote. Pinning them here anchors them to a checked-in constant: tests/verify.ts
 * hard-fails if either file on disk does not hash to the pin below, so a substituted
 * simulation or calibration artifact is caught against source, not against itself.
 *
 * These pins move only by a deliberate re-pin: after a sanctioned change to either artifact,
 * recompute its sha256 and update the constant here in the same commit.
 *
 * Re-pinned 2026-09-24: both artifacts rewritten by their own generators from the saved Pass-1
 * seeds (npm run regen, then npm run calibrate) — 0 numeric leaves moved; one descriptive string
 * each (and the calibration's record of the simulation hash). See MANIFEST.md.
 *
 * Calibration re-pinned 2026-10-02 (d4faed0b… → 53dabd47…): rewritten by `npm run calibrate` after
 * three descriptive strings in src/calibrate.ts (`note`, `windowScope`, `extendedWindow.scope`)
 * stopped calling the 50-nonce window "the epoch the operator actually serves" — 50 bets per seed
 * is the capture's rotation setting (QA code item 9). Of the file's 2,323 leaves only those three
 * strings changed and no numeric value moved; two consecutive runs gave identical bytes.
 */
export const SIMULATION_RESULTS_SHA256 =
  '3d94a510b760abfe2356d96d821f09dfe2bff40866da4bd47669fe8e3df6e0c6';

export const CALIBRATION_RESULTS_SHA256 =
  '53dabd4778e1d2562cb2ad136f6121253502eaac9fcf0cb70a064551bdaf3ca6';

/**
 * SHA-256 of the Pass-1 CENSUS (PLINKO-20): the 28 per-configuration slot-count arrays, in
 * allConfigs(plinkoConfig.json) order, serialised with JSON.stringify. The committed
 * simulation-results.json carries no per-slot counts (it was generated before the profile asked
 * for them); Step 16 regenerates them on every run by replaying all 28,000,000 rounds from the
 * seed pairs saved in that artifact, and requires the result to hash to this pin. Recorded
 * 2026-09-24 from the first full in-verify replay, which also reproduced every committed Pass-1
 * figure (simRTP and all 560 trace points bit for bit).
 */
export const PASS1_CENSUS_SHA256 =
  '8c840243629258e29aeeb9c3356ee637c232889bc1b5b3b2ea5b8b8a1285d1a5';
