#!/usr/bin/env node
/**
 * mutate — falsifiability gate (release gate 9).
 *
 * Applies each declared mutation, runs its runner, and requires the suite to REJECT it.
 * When a mutation declares an `expect` marker the runner output must ALSO contain it, so
 * the intended guard fired rather than merely some other failure.
 *
 * THE BATTERY NEVER EDITS THE WORKING TREE (2026-10-02). It copies the package (without
 * node_modules and outputs/run) into a fresh temporary directory, links node_modules into the
 * copy, and applies, runs and restores every mutation THERE. Until this revision it edited
 * the working tree in place and restored it in a `finally`; a battery interrupted between the
 * edit and the restore (a signal, a crash, a closed terminal) left a mutated byte in the tree
 * the next command — or the next commit — would read. That happened once in this package's
 * history: mutation residue in outputs/simulation-results.json reached a commit and had to be
 * restored by the next one. The copy is removed at the end; an interrupted run leaves only a
 * temporary directory behind.
 *
 * TWO REGISTRIES (revision 2, external-review N3):
 *
 *   tests/mutations.json         Every counterexample that must be KILLED, each by a
 *                                numbered scored step except `M01`, `M02` and `M35`,
 *                                which the unit tests or the config pin reject, and
 *                                `M46`, which shows the informational Step 21 reacting.
 *                                This is the file the framework's `check-mutations.sh`
 *                                reads; each step entry names the step that must fail
 *                                and the battery asserts that the marker of that exact
 *                                step appears, not merely that the run went red.
 *
 *   tests/mutations-extra.json   Counterexamples the "a scored step must fail" model does
 *                                not fit:
 *                                  - publication-guard mutations, killed by
 *                                    `npm run check-outputs` rather than by a step;
 *                                  - DECLARED SURVIVORS (`expectSurvive: true`) — known
 *                                    residuals the suite genuinely cannot detect. A
 *                                    declared survivor that starts being KILLED is also an
 *                                    error here: it means the registry's documented
 *                                    residual is stale.
 *
 * Entry shape (both files):
 *   name, runner ("verify" | "standalone" | "mocha" | "check-outputs"), guard, expect?, env?,
 *   either { file, find, replace } or { edits: [{file, find, replace}, ...] },
 *   delete?: ["path", ...]                remove these files for the run, restore after —
 *                                         the only way to express an ABSENT artifact, which
 *                                         is its own defect class ("absent ⇒ pass"),
 *   repin?: [{ file, pattern, hashOf }]   recompute a SHA-256 pin after the edits,
 *   regen?: true, expectExit?: n, expectVerdict?: "…"
 *                                         RTP FIGURE OVERSTATED route (FIXPASS2 C3, 2026-10-14). After the
 *                                         edits, re-write outputs/rtp-claim-table.json (`ts-node
 *                                         src/rtp-settings.ts`), re-pin RTP_CLAIM_TABLE_SHA256 and re-emit the
 *                                         canonical records (PF_EMIT=1 npm run verify, same replay mode), as an
 *                                         auditor would after a paytable or published-figure change, so the
 *                                         judged run reproduces its own records and only the rule decides it.
 *                                         The kill then also requires that exact exit code and that
 *                                         summary.verdict in the run record; the canonical records are
 *                                         restored after the entry. Before regenerating, a STALE run
 *                                         of the edited copy must exit 1 with the named step FAIL (a
 *                                         committed table that no longer matches is a reproduction
 *                                         failure even under a miss).
 *   expectSurvive?: true                  (mutations-extra.json only)
 *   expectPass?: [n, ...]                 (declared survivors) the scored steps that must
 *                                         each REPORT `PASS`. Absence is a failure.
 *   expectFail?: [n, ...]                 (declared survivors) the ONLY scored steps
 *                                         allowed to be non-PASS, each of which must
 *                                         actually occur. Anything else failing is an
 *                                         unrelated failure, not a survival.
 *
 * An entry may declare `delete` with no edits. tests/mutations.json entries may NOT: the
 * framework's check-mutations.sh applies those itself as a single find/replace.
 *
 * PROOF OF EXECUTION. A declared-survivor result is only accepted when the run
 * demonstrably HAPPENED: the process started, was not signalled, reached its runner's
 * end-of-run marker, and reported an explicit status for every step in `expectPass`.
 * Before this, an injected startup `throw` produced "all 20 in-scope steps still PASS"
 * and exit 0 with zero steps executed — the absence of a FAIL marker was read as success.
 *
 * STEP STATUSES COME FROM THE SCORED RECORD (2026-10-02). For the `verify` and `standalone`
 * runners the per-step statuses are read from the run record the verifier writes,
 * outputs/run/verification-results.json (or .failed.json), and outputs/run/ is emptied before
 * every run so a record left by an earlier run can never be read. They used to be parsed from
 * the console, where a step's marker is printed when the step runs: Step 10 printed `[PASS]` and
 * was then re-scored FAIL by the enforced RTP-CLAIM rule, so the runner certified a pass the
 * record contradicted. The console is still parsed, and a step whose LAST printed marker
 * disagrees with the record is reported as a problem.
 *
 * Exits 0 only if every mutation behaved as declared AND every file the battery touched
 * is restored byte-identical inside the copy (the restoration hash manifest printed at the
 * end), so no mutation can leak into the next.
 *
 * Usage: npm run mutate
 *        node scripts/mutate.mjs --only=S00,M35   (named entries only — a PARTIAL run, labelled
 *                                                  as such; it never stands in for the battery)
 */
import {
  readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, rmSync,
  mkdtempSync, cpSync, symlinkSync, realpathSync,
} from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import * as path from 'path';

// ── Work on a copy, never on the working tree ─────────────────────────────────
const SOURCE_ROOT = process.cwd();
if (!existsSync(path.join(SOURCE_ROOT, 'tests', 'mutations.json'))) {
  console.error(`[mutate] run from the package root (no tests/mutations.json in ${SOURCE_ROOT})`);
  process.exit(2);
}
/** Paths (relative to the package root) that are not copied: dependencies and run records. */
const NOT_COPIED = ['node_modules', path.join('outputs', 'run'), path.join('outputs', 'fresh'), '.git'];
const WORK = mkdtempSync(path.join(tmpdir(), 'mutate-'));
cpSync(SOURCE_ROOT, WORK, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(SOURCE_ROOT, src);
    return !NOT_COPIED.some(x => rel === x || rel.startsWith(x + path.sep));
  },
});
if (existsSync(path.join(SOURCE_ROOT, 'node_modules'))) {
  symlinkSync(realpathSync(path.join(SOURCE_ROOT, 'node_modules')), path.join(WORK, 'node_modules'), 'dir');
}
process.chdir(WORK);
console.log(`[mutate] working copy: ${WORK} (the working tree at ${SOURCE_ROOT} is not written to)`);

const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice('--only='.length)
  .split(',').map(s => s.trim()).filter(Boolean);

function load(file) {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'));
}

const registries = [
  { path: 'tests/mutations.json', label: 'scored-step battery' },
  { path: 'tests/mutations-extra.json', label: 'guard-script battery + declared survivors' },
];

// Artifacts a run could rewrite. Backed up now, restored after — inside the copy, so that no
// mutation's run can leave a rewritten artifact for the next mutation to read.
//
// Since D1 (2026-09-11) `npm run verify` writes NOTHING into these paths — this run's results go
// to `outputs/run/` — so for the `verify` runner the backup below is belt-and-braces. It still
// matters for any runner invoked with PF_EMIT=1, and it is the measurement behind the
// restoration manifest either way.
const CANONICAL = [
  'outputs/verification-results.json',
  'outputs/coverage-results.json',
  'outputs/verification-stats.json',
  'outputs/simulation-results.json',
  'outputs/calibration-results.json',
];
const backups = new Map();

// ── Restoration hash manifest ─────────────────────────────────────────
// `preHashes` records the SHA-256 of every file the battery is about to touch, the first
// time it touches it; `touched` records the set. Both are re-asserted at the end, so the
// claim "the battery leaves the tree byte-clean" is measured rather than asserted.
const preHashes = new Map();
const touched = new Set();
function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
/** Record a file's pre-mutation hash exactly once, before anything writes to it. */
function rememberPre(f) {
  if (!preHashes.has(f)) preHashes.set(f, existsSync(f) ? sha256File(f) : null);
}

for (const f of CANONICAL) if (existsSync(f)) { backups.set(f, readFileSync(f)); rememberPre(f); }

// Everything a verification run emits lands in `outputs/run/` (D1), including the quarantined
// document a failing run drops. It is emptied before every verify/standalone run (so the record
// read afterwards can only be that run's), and removed at the end with the rest of the copy.
const RUN_DIR = 'outputs/run';
const RECORD_FILES = ['verification-results.json', 'verification-results.failed.json'];
/** Files `node scripts/build-standalone.mjs` writes; a `standalone`-runner mutation restores them. */
const STANDALONE_PRODUCTS = ['test.js', 'verify.js', 'replay.js', 'standalone-manifest.json'];

/** The run record a verify/standalone run wrote under outputs/run/, or null if it wrote none. */
function readRunRecord() {
  for (const f of RECORD_FILES) {
    const p = path.join(RUN_DIR, f);
    if (!existsSync(p)) continue;
    try { return { file: p, doc: JSON.parse(readFileSync(p, 'utf8')) }; }
    catch (e) { return { file: p, doc: null, error: String(e.message ?? e) }; }
  }
  return null;
}

/**
 * Turn a raw spawn result into a STRUCTURED execution record.
 *
 * Substring presence cannot distinguish "no step failed" from "no step ran", and a console
 * marker cannot distinguish the status a step was printed with from the status it was scored
 * with. This returns explicit statuses per step id, the process outcome, and whether the runner
 * reached its own end-of-run marker — so a caller can require positive evidence of execution.
 *
 * For `verify` / `standalone` the statuses are the SCORED RECORD's (outputs/run/, written by
 * this run — the directory is emptied before it starts); `consoleSteps` holds the last marker
 * printed per step, and `disagreements` lists every step where the two differ. For `mocha` and
 * `check-outputs`, which write no step record, the console is all there is.
 *
 * `completed` is runner-specific because the runners end differently, and a deliberate startup
 * abort (e.g. M02's config SHA-256 mismatch) is a legitimate KILL for the non-survivor branch.
 * Only the survivor branch, which claims steps PASSED, requires completion — and for a
 * verify/standalone run, completion includes a readable record carrying a steps array.
 */
function parseRun(r, out, runner) {
  const consoleSteps = new Map();
  // "[RTP FIGURE OVERSTATED] Step N" is the console marker of record status OVERSTATED (RTP-CLAIM 1.2.0).
  for (const mm of out.matchAll(/\[(PASS|FAIL|FLAG|INFO|RTP FIGURE OVERSTATED)\] Step (\d+)\b/g)) {
    consoleSteps.set(Number(mm[2]), mm[1] === 'RTP FIGURE OVERSTATED' ? 'OVERSTATED' : mm[1]);   // the LAST marker printed for the step wins
  }
  const scoredRunner = runner === 'verify' || runner === 'standalone';
  let steps = consoleSteps;
  let record = null;
  const disagreements = [];
  if (scoredRunner) {
    record = readRunRecord();
    steps = new Map();
    for (const s of (Array.isArray(record?.doc?.steps) ? record.doc.steps : [])) {
      if (Number.isInteger(s.step) && typeof s.status === 'string') steps.set(s.step, s.status);
    }
    for (const [n, st] of steps) {
      const c = consoleSteps.get(n);
      if (c !== st) disagreements.push(`Step ${n}: record ${st}, console ${c ?? 'no marker'}`);
    }
  }
  const markers =
    runner === 'mocha' ? /\d+ (passing|failing)/.test(out)
    : runner === 'check-outputs' ? /\[check-outputs\] (OK|FAIL)/.test(out)
    : /RESULTS SUMMARY/.test(out) && /VERDICT:/.test(out);
  const completed = scoredRunner ? markers && steps.size > 0 : markers;
  return {
    steps,
    consoleSteps,
    disagreements,
    recordFile: record?.file ?? null,
    completed,
    signal: r.signal ?? null,
    spawnError: r.error ? String(r.error.message ?? r.error) : null,
  };
}

function editsOf(m) {
  if (Array.isArray(m.edits)) return m.edits;
  if (m.file === undefined && Array.isArray(m.delete)) return [];   // deletion-only mutation
  return [{ file: m.file, find: m.find, replace: m.replace }];
}

// The copy is removed however the process ends — normal exit, process.exit(), or a signal.
const keepCopy = process.env.MUTATE_KEEP_COPY === '1';
process.on('exit', () => {
  if (!keepCopy) { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ } }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

let wrong = 0;
let total = 0;
let registered = 0;

for (const reg of registries) {
  const all = load(reg.path);
  registered += all.length;
  const muts = ONLY.length ? all.filter(m => ONLY.some(id => m.name === id || m.name.startsWith(`${id} `))) : all;
  if (muts.length === 0) continue;
  console.log(`\n[mutate] ${reg.path} — ${reg.label} (${muts.length}${ONLY.length ? ` of ${all.length}, --only` : ''})`);

  for (const m of muts) {
    total++;
    const edits = editsOf(m);
    const originals = new Map();
    let bad = null;
    for (const e of edits) {
      if (!e.file || typeof e.find !== 'string' || typeof e.replace !== 'string') {
        bad = `malformed edit in "${m.name}"`; break;
      }
      if (!existsSync(e.file)) { bad = `"${m.name}": file ${e.file} not found`; break; }
      const src = readFileSync(e.file, 'utf8');
      if (!originals.has(e.file)) { originals.set(e.file, src); rememberPre(e.file); }
      if (src.split(e.find).length !== 2) {
        bad = `"${m.name}": find string not unique in ${e.file}`; break;
      }
    }
    // Files this mutation removes are backed up here and restored in `finally` with the rest.
    const deletions = new Map();
    for (const f of (m.delete ?? [])) {
      if (!existsSync(f)) { bad = `"${m.name}": delete target ${f} not found`; break; }
      rememberPre(f);
      deletions.set(f, readFileSync(f));
    }
    // Pin files are rewritten too — back them up before touching anything.
    for (const r of (m.repin ?? [])) {
      if (!existsSync(r.file)) { bad = `"${m.name}": repin file ${r.file} not found`; break; }
      if (!originals.has(r.file)) { rememberPre(r.file); originals.set(r.file, readFileSync(r.file, "utf8")); }
    }
    if (bad) {
      console.error(`[mutate] ${bad}`);
      for (const [f, src] of originals) writeFileSync(f, src);
      process.exit(2);
    }

    try {
      for (const f of deletions.keys()) unlinkSync(f);
      for (const e of edits) {
        writeFileSync(e.file, readFileSync(e.file, 'utf8').replace(e.find, e.replace));
      }
      for (const r of (m.repin ?? [])) {
        const sha = createHash('sha256').update(readFileSync(r.hashOf)).digest('hex');
        const re = new RegExp(r.pattern);
        const src = readFileSync(r.file, 'utf8');
        const hit = src.match(re);
        if (!hit) {
          console.error(`[mutate] "${m.name}": repin pattern ${r.pattern} not found in ${r.file}`);
          process.exitCode = 2;
          continue;
        }
        const oldSha = hit[1];
        writeFileSync(r.file, src.split(oldSha).join(sha));
        // A pin is published in the chapters as well as declared in source. A mutation that
        // re-pins only the source leaves the prose carrying the old hash, which Step 20 catches
        // — correctly, but it means the mutation is testing Step 20 rather than the thing it
        // names. `propagateToMarkdown` re-pins the published copies too, so the tree is as
        // self-consistent as a wrong value present from the first commit would have been.
        if (r.propagateToMarkdown) {
          for (const f of readdirSync('.')) {
            if (!f.endsWith('.md')) continue;
            const text = readFileSync(f, 'utf8');
            if (!text.includes(oldSha)) continue;
            if (!originals.has(f)) { rememberPre(f); originals.set(f, text); }
            writeFileSync(f, text.split(oldSha).join(sha));
          }
        }
      }

      const runner = m.runner ?? 'verify';
      // STALE layer (framework rule: a committed RTP table that no longer matches is a reproduction failure,
      // exit 1, even under a miss): before regenerating, the edited copy must exit 1 with the named step
      // FAIL in its run record.
      let staleOk = true, staleNote = '';
      if (m.regen) {
        const named = Number((/Step\s+(\d+)/.exec(m.guard) ?? [])[1]);
        const stEnv = { ...process.env, ...(runner === 'verify' && !('PF_P1_REPLAY' in (m.env ?? {})) ? { PF_P1_REPLAY: 'off' } : {}), ...(m.env ?? {}) };
        rmSync(RUN_DIR, { recursive: true, force: true });
        const st = spawnSync('npm', ['run', 'verify'], { encoding: 'utf8', env: stEnv, maxBuffer: 64 * 1024 * 1024 });
        const stStatus = (readRunRecord()?.doc?.steps ?? []).find(x => x.step === named)?.status ?? '(no record)';
        staleOk = st.status === 1 && stStatus === 'FAIL';
        staleNote = ` [without regen: exit ${st.status}, expected 1; Step ${named} ${stStatus}, expected FAIL]`;
      }
      if (m.regen) {
        for (const f of ['src/rtp-settings.ts', 'outputs/rtp-claim-table.json']) {
          if (!originals.has(f)) { rememberPre(f); originals.set(f, readFileSync(f, 'utf8')); }
        }
        const w = spawnSync('npx', ['ts-node', 'src/rtp-settings.ts'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const h = /sha256 ([0-9a-f]{64})/.exec(w.stdout ?? '');
        const rs = readFileSync('src/rtp-settings.ts', 'utf8');
        if (w.status !== 0 || !h || !/export const RTP_CLAIM_TABLE_SHA256 = '[0-9a-f]{64}'/.test(rs)) {
          console.error(`[mutate] "${m.name}": regen — rtp-claim:write exited ${w.status}`); process.exitCode = 2; wrong++; continue;
        }
        writeFileSync('src/rtp-settings.ts', rs.replace(/(export const RTP_CLAIM_TABLE_SHA256 = ')[0-9a-f]{64}(')/, `$1${h[1]}$2`));
        const emitEnv = { ...process.env, ...(runner === 'verify' && !('PF_P1_REPLAY' in (m.env ?? {})) ? { PF_P1_REPLAY: 'off' } : {}), ...(m.env ?? {}), PF_EMIT: '1' };
        // The emission guard refuses to write records from a PF_P1_REPLAY=off run (Step 16's replay census
        // differs from the committed one), so a regen that has to produce a valid record uses the
        // `standalone` runner: rebuild the bundle from the edited sources and emit with the full replay.
        if (runner === 'standalone') {
          for (const f of STANDALONE_PRODUCTS) {
            if (!originals.has(f)) { rememberPre(f); originals.set(f, readFileSync(f, 'utf8')); }
          }
        }
        const e = runner === 'standalone'
          ? spawnSync('sh', ['-c', 'node scripts/build-standalone.mjs && node verify.js'], { encoding: 'utf8', env: emitEnv, maxBuffer: 64 * 1024 * 1024 })
          : spawnSync('npm', ['run', 'verify'], { encoding: 'utf8', env: emitEnv, maxBuffer: 64 * 1024 * 1024 });
        if (!/REPORT GENERATION: rewrote outputs\/verification-results\.json/.test((e.stdout ?? '') + (e.stderr ?? ''))) {
          console.error(`[mutate] "${m.name}": regen — PF_EMIT=1 run exited ${e.status} and did not rewrite outputs/verification-results.json`); wrong++; continue;
        }
        if (!/VERDICT:/.test((e.stdout ?? '') + (e.stderr ?? ''))) {
          console.error(`[mutate] "${m.name}": regen — PF_EMIT=1 verify exited ${e.status} without a VERDICT line`); wrong++; continue;
        }
      }
      // `standalone` = rebuild the zero-install bundle from the MUTATED sources and run it — the
      // only runner with worker threads, so the only one that can afford Step 16's full
      // 28,000,000-round Pass-1 replay. The bundle files it rewrites are restored below.
      const cmd = runner === 'mocha' ? ['npx', ['mocha']]
        : runner === 'standalone' ? ['sh', ['-c', 'node scripts/build-standalone.mjs && node verify.js']]
        : ['npm', ['run', runner]];
      if (runner === 'standalone') {
        for (const f of STANDALONE_PRODUCTS) {
          if (!originals.has(f)) { rememberPre(f); originals.set(f, readFileSync(f, 'utf8')); }
        }
      }
      // Under `npm run verify` (ts-node, no worker threads) the full Pass-1 replay costs ~20 min
      // per run, so verify-runner mutations run with PF_P1_REPLAY=off: Step 16 replays only the
      // first CONVERGENCE_STEP rounds of each row and is capped at FLAG — never PASS — so a
      // mutation aimed at another step is decided by its own step marker, and one aimed at
      // Step 16 must still produce a FAIL. Mutations that need the full replay use `standalone`.
      const replayEnv = runner === 'verify' && !('PF_P1_REPLAY' in (m.env ?? {})) ? { PF_P1_REPLAY: 'off' } : {};
      const env = { ...process.env, ...replayEnv, ...(m.env ?? {}) };
      // No record from an earlier run may be read as this run's.
      rmSync(RUN_DIR, { recursive: true, force: true });
      const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
      const out = (r.stdout || '') + (r.stderr || '');
      const run = parseRun(r, out, runner);
      // A process that never started, or died on a signal, is not a result either way.
      const abnormal = run.spawnError
        ? `the runner did not start: ${run.spawnError}`
        : run.signal
          ? `the runner was killed by signal ${run.signal}`
          : null;
      // C3 entries: the exact exit code and the run record's verdict are part of the declaration.
      const recVerdict = m.expectExit !== undefined ? (readRunRecord()?.doc?.summary?.verdict ?? '(no run record)') : null;
      const exitOk = m.expectExit === undefined || r.status === m.expectExit;
      const verdictOk = !m.expectVerdict || recVerdict === m.expectVerdict;
      const killed = !abnormal && r.status !== 0 && (!m.expect || out.includes(m.expect)) && exitOk && verdictOk && staleOk;

      if (m.expectSurvive) {
        // ── (round-4 client QA, EXECUTED counterexample) ─────────────────────
        // This branch used to ask ONE question — "does the output contain a [FAIL]/[FLAG]
        // line for any in-scope step?" — and treat "no" as success. Missing execution is
        // indistinguishable from successful execution under that test. With S00 isolated
        // and a runtime `throw` injected before dataset loading, the runner printed
        //   "SURVIVED as declared — all 20 in-scope steps still PASS"
        // and exited 0 with ZERO scored steps having run. A gate reporting green on a run
        // that never happened is worse than no gate: it is a green light manufactured out
        // of a crash.
        //
        // The branch now consumes a STRUCTURED execution result (see `parseRun`) and
        // requires POSITIVE evidence for every claim it makes:
        //   * the process started, was not signalled, and reached its runner's own
        //     end-of-run marker;
        //   * every step named in `expectPass` APPEARS in the scored record and is `PASS` —
        //     absence is a failure, not a pass;
        //   * the set of non-PASS steps equals `expectFail` exactly. S00 legitimately
        //     fails Steps 5, 10, 16 and 17 (documented in its guard); anything else failing
        //     is an unrelated failure and must not be laundered into "survived", and a
        //     declared allowed failure that stops occurring means the declaration itself is
        //     stale. That last rule is not hypothetical: it caught S00's declaration going
        //     stale when Step 16 (round 4) and Step 5 (2026-09-24) started rejecting it;
        //   * the console's last marker for every step agrees with the record. Step 10 used
        //     to print [PASS] and then be re-scored FAIL by the RTP-CLAIM rule; read from the
        //     console, S00 "survived" a step that had rejected it (2026-10-02 QA, code item 1).
        // Exit status alone is deliberately NOT the rule: S00 exits non-zero by design.
        const scope = Array.isArray(m.expectPass) ? m.expectPass : null;
        const allowedFail = Array.isArray(m.expectFail) ? m.expectFail : [];
        const problems = [];
        if (abnormal) problems.push(abnormal);
        if (!run.completed) {
          problems.push(`the ${runner} run never reached its end-of-run marker${run.recordFile === null && (runner === 'verify' || runner === 'standalone') ? ' and wrote no run record' : ''} — no scored step is attested to have executed (exit ${String(r.status)})`);
        }
        if (run.disagreements.length) {
          problems.push(`console and scored record disagree — ${run.disagreements.join('; ')}`);
        }
        let ok;
        let note = '';
        if (scope) {
          const missing = scope.filter(n => !run.steps.has(n));
          const notPass = scope.filter(n => run.steps.has(n) && run.steps.get(n) !== 'PASS');
          const strangerFails = [...run.steps.entries()]
            .filter(([n, s]) => s !== 'PASS' && !allowedFail.includes(n))
            .map(([n]) => n)
            .filter(n => !scope.includes(n));
          const staleAllowed = allowedFail.filter(n => run.steps.get(n) === 'PASS' || !run.steps.has(n));
          if (missing.length) problems.push(`expected-PASS Step ${missing.join(', ')} never reported a result`);
          if (notPass.length) problems.push(`in-scope Step ${notPass.join(', ')} rejected it, so the declared residual is stale`);
          if (strangerFails.length) problems.push(`Step ${[...new Set(strangerFails)].join(', ')} failed and is not a declared allowed failure`);
          if (staleAllowed.length) problems.push(`declared allowed failure Step ${staleAllowed.join(', ')} did not occur — the declaration is stale`);
          ok = problems.length === 0;
          note = ok
            ? ` — all ${scope.length} in-scope steps reported PASS (${run.steps.size} step results read from ${run.recordFile ?? 'the console'})${allowedFail.length ? `; declared allowed failure(s) observed: Step ${allowedFail.join(', ')}` : ''}`
            : ` — ${problems.join('; ')}`;
        } else {
          ok = problems.length === 0 && !killed;
          note = ok ? '' : ` — ${(problems.length ? problems : ['it was killed']).join('; ')}`;
        }
        console.log(`[mutate] "${m.name}": ${ok ? 'SURVIVED as declared' : 'NOT A VALID SURVIVAL'}${note} (${m.guard})`);
        if (!ok) wrong++;
      } else if (abnormal) {
        console.log(`[mutate] "${m.name}": NOT A VALID RESULT — ${abnormal} (${m.guard})`);
        wrong++;
      } else {
        console.log(`[mutate] "${m.name}": ${killed ? 'KILLED' : 'SURVIVED'}${m.expect ? ` [expect: ${m.expect}]` : ''}`
          + `${m.expectExit !== undefined ? `${staleNote} [with regen: exit ${r.status}, expected ${m.expectExit}; verdict ${recVerdict}]` : ''} (${m.guard})`);
        if (!killed) {
          wrong++;
          // Show what DID fail — a mutation that goes red on the wrong step is a dead guard,
          // not a pass, and the raw lines are the only way to see which.
          const lines = out.split('\n').filter(l => /\[(FAIL|FLAG)\]/.test(l)).slice(0, 6);
          for (const l of lines) console.log(`           ${l.trim()}`);
        }
      }
    } finally {
      // A regen entry rewrote the canonical records with PF_EMIT=1: put them back before the next entry.
      if (m.regen) for (const [f, buf] of backups) writeFileSync(f, buf);
      for (const [f, src] of originals) writeFileSync(f, src);
      for (const [f, buf] of deletions) writeFileSync(f, buf);
      for (const f of originals.keys()) touched.add(f);
      for (const f of deletions.keys()) touched.add(f);
    }
  }
}

// Restore every canonical artifact a run may have rewritten (inside the copy).
for (const [f, buf] of backups) writeFileSync(f, buf);

// ── Restoration hash manifest (acceptance) ──────────────────────────────
// Each mutation edits source, config, registries or canonical artifacts in the COPY and
// restores them in a `finally` before the next one runs. A restoration that silently left a
// mutated byte behind would hand every later mutation a doctored tree, so every file the battery
// touched is re-hashed and compared with its pre-run hash, and a mismatch is a hard failure of
// the battery itself, printed with both hashes. (The working tree is never written to at all —
// see the header.)
const restoreFailures = [];
for (const f of touched) {
  const before = preHashes.get(f) ?? null;
  const after = existsSync(f) ? sha256File(f) : null;
  if (before !== after) {
    restoreFailures.push(`${f}: before ${before ?? 'ABSENT'} after ${after ?? 'ABSENT'}`);
  }
}
console.log(`\n[mutate] restoration manifest: ${touched.size} file(s) touched in the working copy, ${touched.size - restoreFailures.length} restored byte-identical`);
if (restoreFailures.length > 0) {
  console.log('[mutate] RESTORATION FAILED — a mutation leaked into the copy the later ones ran on:');
  for (const l of restoreFailures) console.log(`           ${l}`);
  wrong += restoreFailures.length;
}

console.log(`\n[mutate] ${total - wrong}/${total} behaved as declared, ${wrong} did not`);
if (ONLY.length) {
  // A filtered run is a development aid. It is labelled so it cannot be quoted as the battery,
  // and it exits 3 on success so nothing automated reads it as a passing gate.
  console.log(`[mutate] PARTIAL RUN (--only=${ONLY.join(',')}): ${total} of ${registered} registered entries — this is not the battery result`);
  if (total === 0) { console.error('[mutate] --only matched no entry'); process.exit(2); }
  process.exit(wrong ? 1 : 3);
}
process.exit(wrong ? 1 : 0);
