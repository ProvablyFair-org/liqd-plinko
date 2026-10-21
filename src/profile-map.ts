/**
 * Which ProvablyFair.org Plinko profile check each scored step implements.
 *
 * WHY THIS FILE EXISTS. The framework's game profile declares checks PLINKO-01 … PLINKO-39.
 * This suite scores 21 steps under its own numbering, which every chapter cites by number and
 * which therefore cannot be renumbered to match. Without a written mapping the only way to
 * relate the two was to read all 21 steps by hand and type the answer into the profile — where
 * it went stale the moment a step changed, silently, because nothing re-derived it. The mapping
 * is declared here, emitted into `outputs/verification-results.json` beside the step results,
 * and read back by `pf-audit matrix`, which prints the conformance matrix and exits 1 when a
 * HARD_FAIL check has nothing implementing it.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. An id claimed
 * for a step the step does not implement is a false statement in a published artifact, so the
 * rule is the profile's own `asserts` text: claim the check only if the step's assertion
 * actually decides it.
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across two steps both say `full` and each note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package, and the
 *             note says what. `partial` is a disclosure, never a softer word for `full`.
 * A check no step claims is absent from the matrix by construction: that is the point.
 */

export type Coverage = 'full' | 'partial';

export interface CheckClaim {
  id: string;
  coverage: Coverage;
  /** For `partial`: what the profile requires that this package does not do. */
  note?: string;
}

export interface StepClaims {
  claims: CheckClaim[];
  /** Required when `claims` is empty: why the step answers no profile check. */
  reason?: string;
}

export const PROFILE_GAME = 'plinko';
export const PROFILE_VERSION = '1.0.2';

/** Scored step number → the profile checks it implements. Every step 1..21 has an entry. */
export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [{ id: 'PLINKO-01', coverage: 'full' }] },
  2: { claims: [{ id: 'PLINKO-02', coverage: 'full' }] },
  3: { claims: [{ id: 'PLINKO-03', coverage: 'full' }] },
  4: {
    claims: [
      { id: 'PLINKO-03', coverage: 'full' },
      { id: 'PLINKO-04', coverage: 'full' },
    ],
  },
  5: {
    claims: [
      { id: 'PLINKO-07', coverage: 'full' },
      { id: 'PLINKO-08', coverage: 'full' },
    ],
  },
  6: {
    claims: [
      { id: 'PLINKO-06', coverage: 'full' },
      { id: 'PLINKO-36', coverage: 'full' },
    ],
  },
  7: { claims: [{ id: 'PLINKO-10', coverage: 'full' }] },
  8: { claims: [{ id: 'PLINKO-11', coverage: 'full' }] },
  9: {
    claims: [{
      id: 'PLINKO-15', coverage: 'full',
      note: 'every published standard config is asserted present AND carrying at least the '
        + 'Phase-A floor (MIN_PHASE_A_BETS_PER_CONFIG = 50 in src/loader.ts); the never-paid '
        + 'cells are enumerated with their share of theoretical RTP inside this scored step '
        + '(data.neverPaidCellRtpShare / neverPaidRtpShareSummed). WTF is exercised in Phase E '
        + 'and checked by Step 15',
    }],
  },
  10: {
    claims: [
      { id: 'PLINKO-18', coverage: 'full' },
      {
        id: 'PLINKO-19', coverage: 'full',
        note: 'the published-RTP rule (RTP-CLAIM 1.1.0, src/rtp-claim.ts; enforced in this package since '
          + '2026-10-01): every one of the 28 boards must return within 0.1 pp of the flat 99% LIQD\'s Plinko '
          + 'page shows (evidence/rtp-page-labels-2026-10-01.json), and a board more than 0.1 pp below it on '
          + 'the house side fails Step 10 (player-favourable never fails). The per-setting exact table is '
          + 'outputs/rtp-claim-table.json, pinned in src/rtp-settings.ts. Measured: 0 house-side failures, worst '
          + 'gap -0.09375 pp (rows 8 and 10, medium risk). FAIL probed: M51 (claim raised to 99.02%), S00 (a '
          + '990x WTF tail takes that board to 98.7549%)',
      },
    ],
  },
  11: { claims: [{ id: 'PLINKO-05', coverage: 'full' }] },
  12: { claims: [{ id: 'PLINKO-05', coverage: 'full' }] },
  13: { claims: [{ id: 'PLINKO-18', coverage: 'full' }] },
  14: { claims: [{ id: 'PLINKO-06', coverage: 'full' }] },
  15: { claims: [{ id: 'PLINKO-17', coverage: 'full' }] },
  16: {
    claims: [{
      id: 'PLINKO-31', coverage: 'full',
      note: 'the dispersion guard rejects a per-config histogram whose RE-DERIVED chi²/p is too '
        + 'good (p>0.9999 or chi²/df<0.02) as well as too bad; p is recomputed from the committed '
        + 'slotChi2/slotDf so a doctored slotPValue cannot ride a normal chi²',
    }, {
      id: 'PLINKO-20', coverage: 'full',
      note: '28 configurations × 1,000,000 rounds; chi² at the Bonferroni threshold (0.01/28) and serial '
        + 'independence (lag-1 / runs) gated. THE COMMITTED EXPERIMENT IS REPLAYED IN FULL inside this step on '
        + 'every run (since 2026-09-24; until then only under `npm run replay`, outside the scored path): all '
        + '28,000,000 rounds regenerated from the seed pairs saved in the committed rows by src/pass1.ts '
        + 'playPass1Config — the per-configuration loop moved unchanged out of src/simulate.ts, so generator and '
        + 'replay are one function — on worker threads (src/parallel.ts, one configuration per thread). chi², df, '
        + 'p, RTP, SE (exact payout sd / √n) and the serial statistics are RE-DERIVED from the replayed slot counts '
        + 'and the gates read those, not the artifact\'s scalars; the artifact\'s copies must agree — simRTP and all '
        + '560 running-RTP points exactly, the rest within 1e-14 + 1e-12·max. Measured: 28/28 configurations, 784 '
        + 'committed figures compared, 784 bit-identical, 0 beyond tolerance. CENSUS: the committed artifact '
        + 'carries no per-slot counts (generated before the profile asked for them), so the replayed census is '
        + 'bound byte for byte to PASS1_CENSUS_SHA256 in src/artifact-pins.ts (8c840243…, recorded from the first '
        + 'full in-verify replay — a regression pin, not an independent witness; the binding to the original '
        + 'experiment is the 784 bit-identical figures). check-outputs refuses a canonical run whose replay was not '
        + 'full. PF_P1_REPLAY=off (mutation battery only) replays the first 50,000 rounds per row and caps the step '
        + 'at FLAG. FAIL probed: M48 (saved seed altered), M49 (one trace point moved one ulp), X17 (census pin '
        + 'altered, full replay)',
    }, {
      id: 'PLINKO-32', coverage: 'full',
      note: 'every committed running-RTP trace is bound to the histogram it claims: the grid is CONVERGENCE_STEP '
        + '= 50,000 rounds from src/config.ts (20 points per row); the terminal point must equal the RTP derived '
        + 'from the REPLAYED histogram (Σ count × table / n) within the float-summation bound (n + rows + 5)·2^-53·RTP '
        + '(Higham γ bound for n additions in nonce order — measured gaps are printed with their share of it); '
        + 'every point lies inside the board\'s payout support, every increment between points is payable by that '
        + 'many drops (so the cumulative payout never decreases), and the histogram total stays reachable in the '
        + 'rounds that remain. The published chart outputs/rtp-convergence.html is re-rendered from the committed '
        + 'traces with src/convergence-chart.ts (the renderer moved unchanged out of src/simulate.ts) and must equal '
        + 'the committed file byte for byte. Measured: 28/28 traces bound, 560 points, chart byte-identical. FAIL '
        + 'probed: M50 (chart byte changed), X18 (terminal point moved 1e-6, full replay)',
    }],
  },
  17: { claims: [{ id: 'PLINKO-21', coverage: 'full' }] },
  18: { claims: [{ id: 'PLINKO-12', coverage: 'full' }] },
  19: { claims: [{ id: 'PLINKO-14', coverage: 'full' }] },
  20: {
    claims: [
      { id: 'PLINKO-13', coverage: 'full' },
      { id: 'PLINKO-26', coverage: 'full' },
      { id: 'PLINKO-35', coverage: 'full' },
      { id: 'PLINKO-27', coverage: 'full' },
    ],
  },
  21: { claims: [{ id: 'PLINKO-22', coverage: 'full' }] },
};

/**
 * Checks this casino's design makes inapplicable. The reason is the declaration: a check that
 * simply never appears is a gap, and one that says why it cannot apply is an answer.
 */
export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  {
    id: 'PLINKO-38',
    reason: "Pass 2 is gated on an exact Poisson-binomial survival over the whole population, not "
      + 'on a count of flagged seed-config combinations, so there is no flag count for a '
      + 'multi-window shape analysis to reinterpret',
  },
  {
    id: 'PLINKO-39',
    reason: 'plinkoConfig.json publishes one house edge and no stake brackets, so there is no '
      + 'per-bracket edge to audit',
  },
  {
    id: 'PLINKO-16',
    reason: 'the captured bet record carries no balance field, so there is no consecutive-bet '
      + 'delta to reconcile (MANIFEST.md DL-8)',
  },
];

/**
 * Checks a package artifact answers rather than a scored step. `none` means the artifact does
 * not exist — recorded so the gap is machine-readable instead of merely absent.
 */
export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  {
    id: 'PLINKO-09', artifact: 'tests/plinko/rngSpecTests.ts + tests/plinko/rngTests.ts', coverage: 'full',
    note: 'the docs/ALGORITHM.md spec self-test (55 checks: the page commitment example, vectors V1–V5 '
      + 'with digest, every row u32, bits, path and slot, the message format, path/slot properties, the '
      + 'range-2 bias report and input rejection), one captured bet reproduced from its revealed seed and '
      + 'the commitment-hash vector; mutations M01 (digest bytes read little-endian) and M35 (biased bit '
      + 'draw) kill it. Since 20 Oct 2026 src/rng.ts is rebuilt from the spec; the four earlier vectors at '
      + 'ranges 25, 52 and 3,000,000,000, two of which exercised the earlier port\'s rejection branch, were '
      + 'removed with it (the spec defines range 2 only, with no rejection step)',
  },
  {
    id: 'PLINKO-23', artifact: 'MANIFEST.md#verification-results', coverage: 'full',
    note: 'rows S5-1 … S5-8, each tied to a step or a capture; S5-5 is "Not tested — disclosed"',
  },
  {
    id: 'PLINKO-24',
    artifact: 'verifier-parity/ + src/site-verifier.ts + Step 5 + scripts/check-site-verifier.mjs',
    coverage: 'full',
    note: 'the site verifier the profile names — the ProvablyFair.org site repository VerifyBets games/plinko/derive.js, '
      + 'the two files it imports (lib/hmac-sha256.js, games/plinko/paytables.js) and the page\'s source card '
      + '(games/plinko/source.js) — is HASH-MATCHED and EXECUTED: the four SHA-256 are recorded in '
      + 'src/site-verifier.ts SITE_VERIFIER_PINS (derive.js c4887e7b…) over byte-exact copies in verifier-parity/; '
      + 'Step 5 FAILs unless the copies hash to the pins, loads them with only the ES-module keywords removed '
      + '(the loader of this audit\'s LIQD Mines package), runs the site\'s own derivePlinko on every captured bet (bound to '
      + 'EXPECTED_BETS) and FAILs on any path, slot, row-count or multiplier that differs from src/rng.ts '
      + 'revealPlinko or from the capture, on any paytable cell that differs from plinkoConfig.json, and on a '
      + 'source card whose text is not derive.js. Measured 2026-09-24: 4/4 pins, 10,100/10,100 bets — 0 path, 0 '
      + 'slot, 0 multiplier, 0 row mismatches; paytable 365/365 cells; source card = derive.js. '
      + 'scripts/check-site-verifier.mjs against the ProvablyFair.org site repository (branch main, HEAD 0625438, the four '
      + 'files clean): 4/4 MATCH, exit 0. What this parity is: hash-pinned behavioural equality on every captured '
      + 'bet, not a derive.js generated from the adapter. LIVE SITE: https://www.provablyfair.org/verify-bets is '
      + 'not covered — its HTML and the 18 script chunks it references contain no "liqd" string (GET 2026-09-24; '
      + 'runtime-loaded chunks not fetched). FAIL probed: M47 (byte changed, no re-pin), X14 (derive.js logic '
      + 'changed AND re-pinned), X15 (source card changed, re-pinned), X16 (site paytable cell changed, '
      + 're-pinned). Not exercised by any captured bet: derive.js\'s all-chunks-rejected retry (unreachable for '
      + 'range 2; src/rng.ts, rebuilt from docs/ALGORITHM.md on 20 Oct 2026, has no rejection step) and '
      + 'non-hex server seeds (derive.js keys the HMAC with their UTF-8 bytes, src/rng.ts throws)',
  },
  {
    id: 'PLINKO-25', artifact: 'README.md + MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'the ordered player-verification path (commitment → per-row HMAC bits → winning slot → '
      + 'payout) with the bet SLOjmT9dyuUEi1que576R worked example and its full byte-by-byte '
      + 'derivation is in MANIFEST.md#verify-a-bet; README.md points to it',
  },
  {
    id: 'PLINKO-28',
    artifact: 'tests/verify.ts + src/diff.ts + src/diff-simulation.ts + npm test / npm run test:full',
    coverage: 'full',
    note: 'npm test = standalone check → node test.js (57 unit tests) → node verify.js (zero-install bundle, 21 '
      + 'scored steps, PROVABLY FAIR — Full Pass, exit 0) → check-outputs → release-manifest --check; it writes only to outputs/run/ (never '
      + 'a pinned artifact) and diffs the committed artifacts field by field at 1e-14 + 1e-12·max (integers and '
      + 'strings exact), recording the Node runtime in outputs/run/diff.json and exiting 1 beyond tolerance. '
      + 'REGENERATION DIFFED (added 2026-09-24): `npm run test:full` = npm test + node replay.js + `npm run regen` '
      + '(src/simulate.ts itself, SIM_SEEDS_FROM = the seed pairs saved in the committed rows, then '
      + 'src/calibrate.ts, into outputs/run/regen/) + `npm run diff-simulation` (field by field, the chart byte '
      + 'for byte → outputs/run/diff-simulation.json, verdict and runtime also added to outputs/run/diff.json). '
      + 'Measured 2026-09-24 on Node 22.23.1: test:full exit 0 in 19 min 34 s — simulation-results.json '
      + 'byte-identical, calibration-results.json 0 fields differ (its simulation-path leaf excluded, the '
      + 'simulation hash twin equal), rtp-convergence.html byte-identical, REPRODUCED. The first regeneration '
      + '(same day) was NOT reproduced — the committed simulation artifact predated later generator revisions '
      + '(one descriptive string still carrying a retracted R-CHERRY sentence; five calibrated-null fields the '
      + 'generator had started writing), the calibration artifact likewise (one string); the generator stopped '
      + 'writing the five undeclared fields and both artifacts were rewritten by their own generators with 0 '
      + 'numeric leaves moved and re-pinned (MANIFEST.md). Step count 21 in README.md, MANIFEST.md and the suite; '
      + 'audit ID PF-2026-LQ03; engines 22.x. FRESH-CLONE CHECK (emulated, 2026-09-24): the file set a commit of '
      + 'this working tree would carry (git ls-files + untracked-not-ignored: 109 files, no node_modules, no '
      + 'outputs/run) copied to a scratch directory; npm ci --offline exit 0; npm test exit 0 in 3 min 11 s — 58/58 '
      + 'unit tests (the count on that date; 60 from 2026-10-02, 57 since 20 Oct 2026), 21/21, PROVABLY FAIR — Full Pass, REPRODUCED; the committed outputs/ byte-unchanged '
      + 'afterwards. NOT an actual git clone of a pushed commit (nothing is committed), and not a second machine',
  },
  {
    id: 'PLINKO-29', artifact: 'tests/mutations.json + tests/mutations-extra.json + scripts/mutate.mjs', coverage: 'full',
    note: '73 registry entries driven by scripts/mutate.mjs (52 scored-step + 21 guard-script / full-replay / '
      + 'declared-survivor); every step that can FAIL or FLAG — steps 1..20 — has at least one mutation it must '
      + 'reject. Step 21 is informational (PLINKO-22) and cannot fail: M46 shows it reporting INFO while Steps 5 '
      + 'and 7 reject the same edit. Added 2026-09-24: M47 + X14..X16 (site verifier: unpinned byte, logic '
      + 're-pinned, source card re-pinned, paytable re-pinned), M48/M49 (saved seed, one-ulp trace point), M50 '
      + '(chart), X17/X18 (census pin, terminal point — `standalone` runner, full replay on worker threads), X19 '
      + '(check-outputs refuses a canonical run whose Pass-1 replay was not full). Added 2026-10-02: M51 (published-'
      + 'RTP claim raised to 99.02%, Step 10 fails); M35 re-pointed from the bias-bound arithmetic in '
      + 'tests/steps/determinism.ts, which never calls src/rng.ts, to src/rng.ts itself (mocha; the two rejection '
      + 'vectors fail). Retargeted 20 Oct 2026 with the rebuild of src/rng.ts from docs/ALGORITHM.md: M01 (digest '
      + 'bytes read little-endian) and M35 (biased bit draw, u mod 3 then mod range), both killed by the spec '
      + 'self-test and the captured-bet unit test. Since 2026-10-02 the runner works in a temporary copy of the package, never in the working '
      + 'tree, and reads each verify/standalone run\'s step statuses from that run\'s scored record in outputs/run/ '
      + '(emptied first), cross-checked against the last console marker per step — the console had shown Step 10 '
      + 'as PASS after the RTP-CLAIM rule re-scored it FAIL. Verify-runner mutations run with PF_P1_REPLAY=off '
      + '(Step 16 capped at FLAG; each kill decided by its own step marker). Run 2026-10-02: 73/73 behaved as '
      + 'declared in 2 h 30 min, 32 touched files restored byte-identical in the working copy; declared survivor '
      + 'S00 SURVIVED as declared — 17 in-scope steps PASS, read from the run record, and Steps 5, 10, 16 and 17 '
      + 'reject it (Step 10 is detection by the published-RTP rule; 5, 16 and 17 are committed copies of the '
      + 'original table). Earlier run 2026-09-24: 71/72 in 1 h 50 min, the miss being S00\'s then-stale declaration',
  },
  {
    id: 'PLINKO-33', artifact: 'scripts/check-outputs.mjs', coverage: 'full',
    note: 'the declared step set is parsed from tests/steps/ source and the canonical run must carry '
      + 'ids 1..21 once each under the declared name; mutation X13 kills it',
  },
  {
    id: 'PLINKO-34', artifact: 'tests/verify.ts + scripts/check-outputs.mjs', coverage: 'full',
    note: 'runMode.attest and runMode.emitBaseline are machine values in the emitted artifact and '
      + "the publication guard refuses anything but a full run, re-checking Step 17's own data; "
      + 'mutations X03 and X04 kill it',
  },
  {
    id: 'PLINKO-37', artifact: 'scripts/build-standalone.mjs + scripts/check-standalone.mjs', coverage: 'full',
    note: 'verify.js, test.js and replay.js are compiled from the checked-in sources and '
      + 'standalone-manifest.json pins the SHA-256 of every input and output; the guard runs first '
      + 'in npm test and refuses a bundle built from anything else',
  },
  {
    id: 'PLINKO-30', artifact: 'MANIFEST.md#limitations-and-trust + MANIFEST.md#evidence', coverage: 'full',
    note: 'the DL register, the load-bearing premises table with "Could the captured data contradict '
      + 'it?" and the exhibits E01, E02 and E04–E20 (there is no E03) are all present; the image exhibits now carry SHA-256 hashes beside their '
      + 'dimensions, and no internal working notes ship inside the package',
  },
];

/** The block emitted alongside the step results. */
export function profileCoverageBlock(): Record<string, unknown> {
  return {
    game: PROFILE_GAME,
    profileVersion: PROFILE_VERSION,
    notApplicable: NOT_APPLICABLE,
    packageChecks: PACKAGE_CHECKS,
  };
}

/** The label fields for one scored step, to be merged into its emitted record. */
export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
