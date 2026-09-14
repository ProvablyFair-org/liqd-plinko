/**
 * LIQD Plinko — Capture Reference (ILLUSTRATIVE, documentation only)
 *
 * This is an ILLUSTRATIVE REFERENCE of the general capture approach — the phase plan, the
 * endpoint sequence, and the seed-rotation discipline. It is NOT a byte-exact log of the tool
 * that produced the shipped dataset: the executed run used contiguous rows-major config blocks
 * (not the risk-major interleave here), per-epoch Phase-D client seeds named
 * `pfaudit-<runId>-<epoch>`, non-D client seeds of the form `audit`+12 hex (17 chars), and the
 * per-bet/seed field schema in `src/types.ts` (`id`, `hashedServerSeed`, `epoch`, `nonceStart`,
 * `commitVerified`, `chainLinkOk`, `localPath`, `localSlot`, `verified`, plus `meta.preCapture`).
 * The dataset in `data/plinko-master-10100bets.json` is the record of what was captured; this file
 * documents the method. It is not wired to an npm script and is not meant to be run against the
 * live platform as shipped. No credentials or tokens are committed: authentication was performed at capture time
 * by reading the operator session cookie from the local Chrome cookie store (`chrome-cookies-secure`),
 * which requires an interactive, already-authenticated Chrome session and stores nothing in-repo.
 *
 * Phases (10,100 drops total):
 *   A: 5,400 — per-config sample (27 standard configs, all risks × rows 8–16)
 *   B: 2,000 — high/16 deep dive
 *   C:   200 — high/16, bet-size invariance (USDC 10)
 *   D:   500 — cycling configs, fresh auditor client seed
 *   E: 2,000 — WTF mode (riskLevel 4, rows fixed 13)
 *
 * Output: data/dataset.json
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadCookies, makeApi, sleep, randHex, saveCheckpoint, loadCheckpoint, writeOutput } from './lib.reference.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_PATH = join(__dirname, '../data/checkpoint-plinko.json');
const DATASET_PATH    = join(__dirname, '../data/dataset.json');

const CURRENCY          = 'USDC';
const SEED_ROTATE_EVERY = 50;
const DELAY_BET         = 600;
const DELAY_ROTATE      = 1500;
const MAX_ERRORS        = 8;
const SAVE_EVERY        = 50;

const RISK = { low: 1, medium: 2, high: 3, WTF: 4 };

const ALL_CONFIGS = [];
for (const r of ['low', 'medium', 'high']) {
  for (const rows of [8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    ALL_CONFIGS.push({ risk: r, rows });
  }
}

function seqN(n) {
  const s = [];
  for (let i = 0; i < n; i++) ALL_CONFIGS.forEach(c => s.push(c));
  return s;
}

const PHASES = [
  { key: 'A', rounds: 5400, amount: 0.10, configSeq: seqN(200) },
  { key: 'B', rounds: 2000, amount: 0.10, fixedConfig: { risk: 'high', rows: 16 } },
  { key: 'C', rounds: 200,  amount: 10,   fixedConfig: { risk: 'high', rows: 16 } },
  { key: 'D', rounds: 500,  amount: 0.10, configSeq: seqN(19), freshClientSeed: true },
  { key: 'E', rounds: 2000, amount: 0.10, fixedConfig: { risk: 'WTF', rows: 13 } },
];

let api;
let paused = false;
let errors = 0;
let activeClientSeed = null;

const dataset = {
  meta: {
    audit: 'LIQD Plinko',
    capturedAt: new Date().toISOString(),
    schema: 'liqd-plinko-capture-v1',
    gameId: 'fast-games-5',
    houseEdge: 1.00,
    progress: {},
  },
  seeds: [],
  bets: [],
};

function log(m) { process.stdout.write('[PLINKO] ' + m + '\n'); }

async function getActiveSeeds() {
  return api('GET', '/fast-games/provably-fair/active');
}

async function rotateSeed(clientSeed) {
  return api('POST', '/fast-games/provably-fair/rotate', { clientSeed });
}

async function placeBet(amount, risk, rows, clientSeed) {
  return api('POST', '/fast-games/plinko-game/place-bet', {
    betAmount: amount,
    currencyCode: CURRENCY,
    clientSeed,
    riskLevel: RISK[risk],
    numberOfRows: rows,
  });
}

async function recordSeed(ctx, ph) {
  const r = await getActiveSeeds();
  activeClientSeed = r.clientSeed;
  dataset.seeds.push({
    at: new Date().toISOString(),
    context: ctx,
    phase: ph,
    activeServerSeedHash: r.activeServerSeedHash,
    activeClientSeed: r.clientSeed,
    activeNonce: r.nonce,
    nextServerSeedHash: r.nextServerSeedHash,
    serverSeed: null,
  });
  log('Seed: ' + ctx + ' hash=' + (r.activeServerSeedHash || '').slice(0, 16) + '... nonce=' + r.nonce);
}

async function rotateAndRecord(ctx, ph, specificClientSeed) {
  // Snapshot pre-rotation state first — verifier needs this to check:
  //   SHA256(revealedServerSeed) === pre.activeServerSeedHash  (hash integrity)
  //   post.activeServerSeedHash === pre.nextServerSeedHash     (chain continuity)
  const pre = await getActiveSeeds();
  const nc = specificClientSeed || randHex(16);
  const r = await rotateSeed(nc);
  activeClientSeed = r.clientSeed;
  dataset.seeds.push({
    at: new Date().toISOString(),
    context: ctx + '-revealed',
    phase: ph,
    preRotation: {
      activeServerSeedHash: pre.activeServerSeedHash,
      nextServerSeedHash: pre.nextServerSeedHash,
      activeClientSeed: pre.clientSeed,
      activeNonce: pre.nonce,
    },
    activeServerSeedHash: r.activeServerSeedHash,
    activeClientSeed: r.clientSeed,
    activeNonce: r.nonce,
    nextServerSeedHash: r.nextServerSeedHash,
    serverSeed: r.revealedServerSeed,
  });
  log('Rotated: revealed=' + (r.revealedServerSeed || '').slice(0, 16) + '... chain: ' +
    (pre.nextServerSeedHash || '').slice(0, 16) + '→' + (r.activeServerSeedHash || '').slice(0, 16));
  return nc;
}

async function playOne(amt, risk, rows, ph) {
  if (!activeClientSeed) {
    const s = await getActiveSeeds();
    activeClientSeed = s.clientSeed;
  }
  const resp = await placeBet(amt, risk, rows, activeClientSeed);
  const r = resp.data || resp;
  dataset.bets.push({
    phase: ph,
    betId: r.id,
    gameId: r.gameId,
    nonce: r.nonce,
    clientSeed: r.clientSeed,
    serverSeedId: r.serverSeedId,
    betAmount: r.betAmount,
    currencyId: r.currencyId,
    fiatCurrency: r.fiatCurrency,
    fiatBetAmount: r.fiatBetAmount,
    exchangeRate: r.exchangeRate,
    risk,
    riskLevel: r.riskLevel,
    numberOfRows: r.numberOfRows,
    dropDetails: r.dropDetails,
    winningSlot: r.winningSlot,
    multiplier: r.multiplier,
    coefficient: r.coefficient,
    winningAmount: r.winningAmount,
    result: r.result,
    currentGameSettings: r.currentGameSettings,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    raw: dataset.bets.length < 5 ? r : undefined,
  });
  errors = 0;
  return dataset.bets[dataset.bets.length - 1];
}

function save() {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const b of dataset.bets) { if (counts[b.phase] !== undefined) counts[b.phase]++; }
  dataset.meta.totals = { bets: dataset.bets.length, phases: counts, seeds: dataset.seeds.length, savedAt: new Date().toISOString() };
  saveCheckpoint(CHECKPOINT_PATH, dataset);
}

async function runPhase(phase) {
  const pk = phase.key;
  let done = dataset.bets.filter(b => b.phase === pk).length;

  if (done >= phase.rounds) { log('Phase ' + pk + ' already complete (' + done + ' bets). Skipping.'); return 'done'; }
  if (done > 0) log('Phase ' + pk + ': resuming from ' + done + '/' + phase.rounds);
  log('== PHASE ' + pk + ' (' + (phase.rounds - done) + ' bets remaining) ==');

  if (done === 0) {
    if (phase.freshClientSeed) {
      const seed = 'audit-liqd-plinko-' + pk.toLowerCase() + '-' + randHex(8);
      log('Phase ' + pk + ': rotating to auditor client seed "' + seed + '"...');
      await rotateAndRecord(pk + '-start', pk, seed);
    } else {
      await recordSeed('pre-' + pk, pk);
    }
  }

  let sinceRotate = done % SEED_ROTATE_EVERY;
  const t0 = Date.now();

  for (let i = done; i < phase.rounds; i++) {
    if (paused) { log('PAUSED at ' + (i + 1) + '/' + phase.rounds); save(); return 'paused'; }

    const cfg = phase.fixedConfig || phase.configSeq[i % phase.configSeq.length];

    try {
      await playOne(phase.amount, cfg.risk, cfg.rows, pk);
      sinceRotate++;
      dataset.meta.progress = { phase: pk, bet: i + 1, total: dataset.bets.length };

      if ((i + 1) % 10 === 0) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        const rt = ((i + 1 - done) / Math.max(1, (Date.now() - t0) / 1000)).toFixed(1);
        log(pk + ': ' + (i + 1) + '/' + phase.rounds + ' | ' + rt + '/s | ' + el + 's');
      }

      if (sinceRotate >= SEED_ROTATE_EVERY && i < phase.rounds - 1) {
        await sleep(DELAY_ROTATE);
        await rotateAndRecord(pk + '-after-' + (i + 1), pk);
        sinceRotate = 0;
      }

      if ((i + 1) % SAVE_EVERY === 0) save();
      await sleep(DELAY_BET);

    } catch (err) {
      errors++;
      log('ERROR ' + (i + 1) + ': ' + err.message + ' (' + errors + '/' + MAX_ERRORS + ')');
      if (errors >= MAX_ERRORS) { log('Too many errors — saving and exiting.'); paused = true; save(); return 'error-paused'; }
      await sleep(Math.min(2000 * errors, 30000));
      i--;
    }
  }

  await sleep(DELAY_ROTATE);
  await rotateAndRecord(pk + '-end', pk);
  save();
  log('Phase ' + pk + ' COMPLETE: ' + phase.rounds + ' bets');
  return 'done';
}

async function main() {
  const resume = process.argv.includes('--resume');

  log('Loading cookies from Chrome...');
  const profile = process.env.CHROME_PROFILE || 'Default';
  const cookieHeader = await loadCookies(profile);
  api = makeApi(cookieHeader);
  log('Cookies loaded. Testing auth...');

  const seeds = await getActiveSeeds();
  log('Auth OK: client=' + seeds.clientSeed + ' nonce=' + seeds.nonce);

  if (resume) {
    const cp = loadCheckpoint(CHECKPOINT_PATH);
    if (cp) {
      dataset.bets = cp.bets || [];
      dataset.seeds = cp.seeds || [];
      dataset.meta = cp.meta || dataset.meta;
      log('Loaded checkpoint: ' + dataset.bets.length + ' bets, ' + dataset.seeds.length + ' seeds');
    } else {
      log('No checkpoint found — starting fresh.');
    }
  }

  process.on('SIGINT', () => {
    log('\nCtrl+C — saving checkpoint...');
    save();
    log('Checkpoint saved to ' + CHECKPOINT_PATH);
    process.exit(0);
  });

  if (dataset.bets.length === 0) {
    log('Fresh start — rotating seed...');
    await rotateAndRecord('fresh-start', 'pre');
    await sleep(500);
  }

  dataset.meta.progress.status = 'running';

  for (const phase of PHASES) {
    const res = await runPhase(phase);
    if (res === 'paused' || res === 'error-paused') break;
  }

  if (!paused) {
    dataset.meta.progress.status = 'completed';
    save();
    writeOutput(DATASET_PATH, dataset);
    log('DONE: ' + dataset.bets.length + ' bets, ' + dataset.seeds.length + ' seeds');
    log('Dataset: ' + DATASET_PATH);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
