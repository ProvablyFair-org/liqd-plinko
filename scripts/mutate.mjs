#!/usr/bin/env node
/**
 * mutate — falsifiability gate (release gate 9).
 *
 * Applies each declared mutation, runs its runner, and requires the suite to REJECT it.
 * When a mutation declares an `expect` marker the runner output must ALSO contain it, so
 * the intended guard fired rather than merely some other failure. Sources are restored
 * afterwards and the canonical artifacts a `verify`-runner mutation overwrites are put
 * back, so the battery leaves the tree byte-clean.
 *
 * TWO REGISTRIES (revision 2, external-review N3):
 *
 *   tests/mutations.json         Every counterexample that must be KILLED by a numbered
 *                                scored step. This is the file the framework's
 *                                `check-mutations.sh` reads; each entry names the step
 *                                that must fail and the battery asserts that exact step
 *                                fails, not merely that the run went red.
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
 *   name, runner ("verify" | "mocha" | "check-outputs"), guard, expect?, env?,
 *   either { file, find, replace } or { edits: [{file, find, replace}, ...] },
 *   delete?: ["path", ...]                remove these files for the run, restore after —
 *                                         the only way to express an ABSENT artifact, which
 *                                         is its own defect class ("absent ⇒ pass"),
 *   repin?: [{ file, pattern, hashOf }]   recompute a SHA-256 pin after the edits,
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
 * PROOF OF EXECUTION (QA-02). A declared-survivor result is only accepted when the run
 * demonstrably HAPPENED: the process started, was not signalled, reached its runner's
 * end-of-run marker, and reported an explicit status for every step in `expectPass`.
 * Before this, an injected startup `throw` produced "all 20 in-scope steps still PASS"
 * and exit 0 with zero steps executed — the absence of a FAIL marker was read as success.
 *
 * Exits 0 only if every mutation behaved as declared AND every file the battery touched
 * is restored byte-identical (the restoration hash manifest printed at the end).
 *
 * Usage: npm run mutate
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

function load(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8'));
}

const registries = [
  { path: 'tests/mutations.json', label: 'scored-step battery' },
  { path: 'tests/mutations-extra.json', label: 'guard-script battery + declared survivors' },
];

// Artifacts a run could rewrite. Backed up now, restored after.
//
// Since D1 (2026-09-11) `npm run verify` writes NOTHING into these paths — this run's results go
// to `outputs/run/` — so for the `verify` runner the backup below is belt-and-braces rather than
// the thing that keeps the tree clean. It still matters for any runner invoked with PF_EMIT=1,
// and it is the measurement behind the restoration manifest either way.
const CANONICAL = [
  'outputs/verification-results.json',
  'outputs/coverage-results.json',
  'outputs/verification-stats.json',
  'outputs/simulation-results.json',
  'outputs/calibration-results.json',
];
const backups = new Map();

// ── Restoration hash manifest (QA-02) ─────────────────────────────────────────
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

// Everything a verification run emits now lands in `outputs/run/` (D1), including the
// quarantined document a failing run drops, which used to sit at
// `outputs/verification-results.failed.json` — beside the evidence. If the battery created that
// directory, the battery removes it.
const RUN_DIR = 'outputs/run';
const runDirPresentBefore = existsSync(RUN_DIR);

/**
 * Turn a raw spawn result into a STRUCTURED execution record (QA-02).
 *
 * The previous code reasoned over the presence or absence of substrings, which cannot
 * distinguish "no step failed" from "no step ran". This returns explicit statuses per
 * step id, the process outcome, and whether the runner reached its own end-of-run
 * marker — so a caller can require positive evidence of execution.
 *
 * `completed` is runner-specific because the three runners end differently, and a
 * deliberate startup abort (e.g. M02's config SHA-256 mismatch) is a legitimate KILL
 * for the non-survivor branch. Only the survivor branch, which claims steps PASSED,
 * requires completion.
 */
function parseRun(r, out, runner) {
  const steps = new Map();
  for (const mm of out.matchAll(/\[(PASS|FAIL|FLAG)\] Step (\d+)\b/g)) {
    steps.set(Number(mm[2]), mm[1]);
  }
  const completed =
    runner === 'mocha' ? /\d+ (passing|failing)/.test(out)
    : runner === 'check-outputs' ? /\[check-outputs\] (OK|FAIL)/.test(out)
    : /RESULTS SUMMARY/.test(out) && /VERDICT:/.test(out);
  return {
    steps,
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

let wrong = 0;
let total = 0;

for (const reg of registries) {
  const muts = load(reg.path);
  if (muts.length === 0) continue;
  console.log(`\n[mutate] ${reg.path} — ${reg.label} (${muts.length})`);

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
      const cmd = runner === 'mocha' ? ['npx', ['mocha']] : ['npm', ['run', runner]];
      const env = { ...process.env, ...(m.env ?? {}) };
      const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', env });
      const out = (r.stdout || '') + (r.stderr || '');
      const run = parseRun(r, out, runner);
      // A process that never started, or died on a signal, is not a result either way.
      const abnormal = run.spawnError
        ? `the runner did not start: ${run.spawnError}`
        : run.signal
          ? `the runner was killed by signal ${run.signal}`
          : null;
      const killed = !abnormal && r.status !== 0 && (!m.expect || out.includes(m.expect));

      if (m.expectSurvive) {
        // ── QA-02 (round-4 client QA, EXECUTED counterexample) ─────────────────────
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
        //   * every step named in `expectPass` APPEARS in the output and is `PASS` —
        //     absence is a failure, not a pass;
        //   * the set of non-PASS steps equals `expectFail` exactly. S00 legitimately
        //     fails Steps 16 and 17 (both artifact staleness, not detection — documented in
        //     its guard); anything else failing is an unrelated failure and must not be
        //     laundered into "survived", and a declared allowed failure that stops occurring
        //     means the declaration itself is stale. That last rule is not hypothetical: the
        //     QA-01 fix made Step 16 start rejecting S00, and it is what caught the stale
        //     declaration.
        // Exit status alone is deliberately NOT the rule: S00 exits non-zero by design.
        const scope = Array.isArray(m.expectPass) ? m.expectPass : null;
        const allowedFail = Array.isArray(m.expectFail) ? m.expectFail : [];
        const problems = [];
        if (abnormal) problems.push(abnormal);
        if (!run.completed) {
          problems.push(`the ${runner} run never reached its end-of-run marker — no scored step is attested to have executed (exit ${String(r.status)})`);
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
            ? ` — all ${scope.length} in-scope steps reported PASS (${run.steps.size} step results parsed)${allowedFail.length ? `; declared allowed failure(s) observed: Step ${allowedFail.join(', ')}` : ''}`
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
        console.log(`[mutate] "${m.name}": ${killed ? 'KILLED' : 'SURVIVED'}${m.expect ? ` [expect: ${m.expect}]` : ''} (${m.guard})`);
        if (!killed) {
          wrong++;
          // Show what DID fail — a mutation that goes red on the wrong step is a dead guard,
          // not a pass, and the raw lines are the only way to see which.
          const lines = out.split('\n').filter(l => /\[(FAIL|FLAG)\]/.test(l)).slice(0, 6);
          for (const l of lines) console.log(`           ${l.trim()}`);
        }
      }
    } finally {
      for (const [f, src] of originals) writeFileSync(f, src);
      for (const [f, buf] of deletions) writeFileSync(f, buf);
      for (const f of originals.keys()) touched.add(f);
      for (const f of deletions.keys()) touched.add(f);
    }
  }
}

// Restore every canonical artifact a run may have rewritten, and remove the run directory the
// battery's own verify runs created. Leaving a quarantine document behind is how a mutation
// battery dirties a delivery tree — it happened with the old
// `outputs/verification-results.failed.json`, and the framework's check-artifacts.sh hard-fails
// on it.
for (const [f, buf] of backups) writeFileSync(f, buf);
if (existsSync(RUN_DIR) && !runDirPresentBefore) rmSync(RUN_DIR, { recursive: true, force: true });

// ── Restoration hash manifest (QA-02 acceptance) ──────────────────────────────
// The battery edits source, config, registries and canonical artifacts IN PLACE and
// restores them in a `finally`. Until now nothing PROVED the restoration: a battery that
// silently left a mutated byte behind would hand the next command a doctored tree. Every
// file the run touched is re-hashed and compared with its pre-run hash, and a mismatch is
// a hard failure of the battery itself, printed with both hashes.
const restoreFailures = [];
for (const f of touched) {
  const before = preHashes.get(f) ?? null;
  const after = existsSync(f) ? sha256File(f) : null;
  if (before !== after) {
    restoreFailures.push(`${f}: before ${before ?? 'ABSENT'} after ${after ?? 'ABSENT'}`);
  }
}
console.log(`\n[mutate] restoration manifest: ${touched.size} file(s) touched, ${touched.size - restoreFailures.length} restored byte-identical`);
if (restoreFailures.length > 0) {
  console.log('[mutate] RESTORATION FAILED — the working tree is NOT as the battery found it:');
  for (const l of restoreFailures) console.log(`           ${l}`);
  wrong += restoreFailures.length;
}

console.log(`\n[mutate] ${total - wrong}/${total} behaved as declared, ${wrong} did not`);
process.exit(wrong ? 1 : 0);
