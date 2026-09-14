// ==UserScript==
// @name         LIQD Plinko Capture v1
// @namespace    https://provablyfair.org
// @version      1.0
// @description  ILLUSTRATIVE capture reference for the LIQD Plinko audit — documents the capture method, NOT the exact tool that produced the shipped dataset (see evidence.md E15 for the differences).
// @match        https://qa.liqd.com/originals/plinko*
// @match        https://qa.liqd.com/originals/plinko
// @grant        none
// @run-at       document-start
// ==/UserScript==

/**
 * LIQD Plinko — Tampermonkey Capture Script v1
 *
 * Auth: cookie session (Cloudflare Access JWT + app session cookie).
 * No bearer token needed. Browser must be logged in via standard flow first.
 *
 * Usage:
 *   1. Install in Tampermonkey, navigate to https://qa.liqd.com/originals/plinko
 *   2. Open browser console
 *   3. testApi()        — sanity-check endpoints
 *   4. startCapture()   — fresh start, rotates seed, begins Phase A
 *      OR
 *      resumeCapture()  — load checkpoint, then startCapture()
 *
 * Controls:
 *   pause()            — stop after current bet
 *   getStatus()        — progress table
 *   downloadData()     — save JSON to disk
 *   inspectBets(0,10)  — show bet details
 *   checkDupes()       — verify no duplicate gameIds
 *   clearData()        — wipe localStorage (fresh start)
 *   startCapture('B')  — run only Phase B (or A, C, D)
 *
 * Phases (10,100 bets total):
 *   A: 5,400 × USDC 0.10  (27 configs × 200 bets; all 3 risks × 9 row counts 8–16)
 *   B: 2,000 × USDC 0.10  (High/16 deep dive)
 *   C:   200 × USDC 10    (High/16 — bet-size invariance)
 *   D:   500 × USDC 0.10  (cycling configs, fresh auditor-controlled client seed)
 *   E: 2,000 × USDC 0.10  (WTF mode — riskLevel 4, rows fixed 13)
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────

  var API_BASE = '/api/v1';
  var CURRENCY = 'USDC';
  var SEED_ROTATE_EVERY = 50;
  var DELAY_BET = 600;
  var DELAY_ROTATE = 1500;
  var MAX_ERRORS = 8;
  var AUTO_SAVE_EVERY = 200;
  var STORAGE_KEY = 'liqd-plinko-capture-v1';

  var RISK = { low: 1, medium: 2, high: 3, WTF: 4 };

  var ALL_CONFIGS = [];
  ['low', 'medium', 'high'].forEach(function (r) {
    [8, 9, 10, 11, 12, 13, 14, 15, 16].forEach(function (rows) {
      ALL_CONFIGS.push({ risk: r, rows: rows });
    });
  });

  function seqN(n) {
    var s = [];
    for (var i = 0; i < n; i++) ALL_CONFIGS.forEach(function (c) { s.push(c); });
    return s;
  }

  var PHASES = [
    { key: 'A', rounds: 5400, amount: 0.10, configSeq: seqN(200) },
    { key: 'B', rounds: 2000, amount: 0.10, fixedConfig: { risk: 'high', rows: 16 } },
    { key: 'C', rounds: 200,  amount: 10,   fixedConfig: { risk: 'high', rows: 16 } },
    { key: 'D', rounds: 500,  amount: 0.10, configSeq: seqN(19), freshClientSeed: true },
    { key: 'E', rounds: 2000, amount: 0.10, fixedConfig: { risk: 'WTF', rows: 13 } },
  ];

  // ── State ───────────────────────────────────────────────────────────────────

  var paused = false;
  var errors = 0;
  var isResuming = false;

  var dataset = {
    meta: {
      audit: 'LIQD Plinko',
      capturedAt: new Date().toISOString(),
      schema: 'liqd-plinko-capture-v1',
      gameId: 'fast-games-5',
      houseEdge: 1.00,
      page: location.href,
      progress: {},
    },
    seeds: [],
    bets: [],
  };

  // ── HTTP ────────────────────────────────────────────────────────────────────

  function api(method, path, body) {
    return fetch(API_BASE + path, {
      method: method,
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': body ? 'application/json' : undefined,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error(r.status + ' — auth lost, re-login at qa.liqd.com');
      return r.text().then(function (t) {
        try { return JSON.parse(t); }
        catch (e) { throw new Error(r.status + ': ' + t.slice(0, 200)); }
      });
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function randHex(bytes) {
    var arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function log(m) { console.log('[LIQD-PLINKO] ' + m); }

  // ── Core API calls ──────────────────────────────────────────────────────────

  function getActiveSeeds() {
    return api('GET', '/fast-games/provably-fair/active');
  }

  function rotateSeed(clientSeed) {
    // Body must be { clientSeed } — confirmed 2026-06-29. nextClientSeed is rejected.
    return api('POST', '/fast-games/provably-fair/rotate', { clientSeed: clientSeed });
  }

  function placeBet(amount, risk, rows, clientSeed) {
    // Confirmed body shape (2026-06-30): betAmount, currencyCode, clientSeed (must echo active),
    // riskLevel (1=Low, 2=Medium, 3=High), numberOfRows (8..16).
    return api('POST', '/fast-games/plinko-game/place-bet', {
      betAmount: amount,
      currencyCode: CURRENCY,
      clientSeed: clientSeed,
      riskLevel: RISK[risk],
      numberOfRows: rows,
    });
  }

  // ── Seed management ─────────────────────────────────────────────────────────

  async function recordSeed(ctx, ph) {
    var r = await getActiveSeeds();
    activeClientSeed = r.clientSeed; // cache for placeBet
    dataset.seeds.push({
      at: new Date().toISOString(),
      context: ctx,
      phase: ph,
      activeServerSeedHash: r.activeServerSeedHash,
      activeClientSeed: r.clientSeed,
      activeNonce: r.nonce,
      nextServerSeedHash: r.nextServerSeedHash,
      serverSeed: null, // revealed only on rotation
    });
    log('Seed: ' + ctx + ' hash=' + (r.activeServerSeedHash || '').slice(0, 16) + '... nonce=' + r.nonce);
  }

  async function rotateAndRecord(ctx, ph, specificClientSeed) {
    var nc = specificClientSeed || randHex(16); // 32-hex matches liqd's clientSeed format
    var r = await rotateSeed(nc);
    // Confirmed shape (2026-06-29): { revealedServerSeed, activeServerSeedHash, nextServerSeedHash, clientSeed, nonce }
    activeClientSeed = r.clientSeed; // cache for placeBet
    dataset.seeds.push({
      at: new Date().toISOString(),
      context: ctx + '-revealed',
      phase: ph,
      activeServerSeedHash: r.activeServerSeedHash,
      activeClientSeed: r.clientSeed,
      activeNonce: r.nonce,
      nextServerSeedHash: r.nextServerSeedHash,
      serverSeed: r.revealedServerSeed,
    });
    log('Rotated: revealed=' + (r.revealedServerSeed || '').slice(0, 16) + '...');
    return nc;
  }

  // ── Single bet ──────────────────────────────────────────────────────────────

  // Need the active client seed for each bet (server demands it echoed in the body).
  // Cached after each rotation; recordSeed() also refreshes it.
  var activeClientSeed = null;

  async function playOne(amt, risk, rows, ph) {
    if (!activeClientSeed) {
      var s = await getActiveSeeds();
      activeClientSeed = s.clientSeed;
    }
    var resp = await placeBet(amt, risk, rows, activeClientSeed);
    // Confirmed response shape (2026-06-30): the body lives in resp.data.
    var r = resp.data || resp;
    dataset.bets.push({
      phase: ph,
      betId: r.id,
      gameId: r.gameId,                       // e.g. "fast-games-5"
      nonce: r.nonce,
      clientSeed: r.clientSeed,
      serverSeedId: r.serverSeedId,           // server-internal seed UUID
      betAmount: r.betAmount,                 // string e.g. "0.10000000"
      currencyId: r.currencyId,               // "2" = USDC
      fiatCurrency: r.fiatCurrency,
      fiatBetAmount: r.fiatBetAmount,
      exchangeRate: r.exchangeRate,
      risk: risk,
      riskLevel: r.riskLevel,
      numberOfRows: r.numberOfRows,
      dropDetails: r.dropDetails,             // bit string '0'=left '1'=right (THE plinko path)
      winningSlot: r.winningSlot,             // sum of dropDetails bits
      multiplier: r.multiplier,
      coefficient: r.coefficient,
      winningAmount: r.winningAmount,         // string
      result: r.result,                       // "won"|"lost"
      currentGameSettings: r.currentGameSettings, // serialized JSON snapshot
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      raw: dataset.bets.length < 5 ? r : undefined, // first 5 bets keep full payload for shape audit
    });
    errors = 0;
    return dataset.bets[dataset.bets.length - 1];
  }

  // ── Checkpoint ──────────────────────────────────────────────────────────────

  function save() {
    try {
      var counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
      for (var i = 0; i < dataset.bets.length; i++) {
        var ph = dataset.bets[i].phase;
        if (counts[ph] !== undefined) counts[ph]++;
      }
      dataset.meta.totals = {
        bets: dataset.bets.length,
        phases: counts,
        seeds: dataset.seeds.length,
        savedAt: new Date().toISOString(),
      };
      // Trim raw payloads except first/last of each phase to keep localStorage manageable
      var trimmed = JSON.parse(JSON.stringify(dataset));
      var keepRaw = new Set();
      ['A','B','C','D'].forEach(function (p) {
        var phaseBets = trimmed.bets.filter(function (b) { return b.phase === p; });
        if (phaseBets.length) {
          keepRaw.add(phaseBets[0].betId);
          keepRaw.add(phaseBets[phaseBets.length - 1].betId);
        }
      });
      trimmed.bets.forEach(function (b) { if (!keepRaw.has(b.betId)) delete b.raw; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      log('localStorage full — downloading instead');
      dlFile();
    }
  }

  function dlFile() {
    var j = JSON.stringify(dataset, null, 2);
    var b = new Blob([j], { type: 'application/json' });
    var u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u;
    a.download = 'liqd-plinko-' + dataset.bets.length + 'bets-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(u);
    log('Downloaded ' + dataset.bets.length + ' bets');
  }

  // ── Phase runner ────────────────────────────────────────────────────────────

  async function runPhase(phase) {
    var pk = phase.key;

    var done = 0;
    for (var b = 0; b < dataset.bets.length; b++) {
      if (dataset.bets[b].phase === pk) done++;
    }

    if (done >= phase.rounds) {
      log('Phase ' + pk + ' already complete (' + done + ' bets). Skipping.');
      return 'done';
    }

    if (done > 0) log('Phase ' + pk + ': resuming from ' + done + '/' + phase.rounds);

    log('== PHASE ' + pk + ' (' + (phase.rounds - done) + ' bets remaining) ==');

    if (done === 0) {
      if (phase.freshClientSeed) {
        var phaseD_seed = 'audit-liqd-plinko-' + pk.toLowerCase() + '-' + randHex(8);
        log('Phase ' + pk + ': rotating to auditor client seed "' + phaseD_seed + '"...');
        await rotateAndRecord(pk + '-start', pk, phaseD_seed);
      } else {
        await recordSeed('pre-' + pk, pk);
      }
    }

    var sinceRotate = done % SEED_ROTATE_EVERY;
    var t0 = Date.now();

    for (var i = done; i < phase.rounds; i++) {
      if (paused) {
        log('PAUSED at ' + (i + 1) + '/' + phase.rounds);
        save();
        return 'paused';
      }

      var cfg = phase.fixedConfig || phase.configSeq[i % phase.configSeq.length];

      try {
        var result = await playOne(phase.amount, cfg.risk, cfg.rows, pk);
        sinceRotate++;
        dataset.meta.progress = { phase: pk, bet: i + 1, total: dataset.bets.length };

        if ((i + 1) % 10 === 0) {
          var el = ((Date.now() - t0) / 1000).toFixed(0);
          var rt = ((i + 1 - done) / Math.max(1, (Date.now() - t0) / 1000)).toFixed(1);
          var bl = result.balance != null ? ' bal=' + Number(result.balance).toFixed(4) : '';
          log(pk + ': ' + (i + 1) + '/' + phase.rounds + ' | ' + rt + '/s | ' + el + 's' + bl);
        }

        if (sinceRotate >= SEED_ROTATE_EVERY && i < phase.rounds - 1) {
          await sleep(DELAY_ROTATE);
          await rotateAndRecord(pk + '-after-' + (i + 1), pk);
          sinceRotate = 0;
        }

        if ((i + 1) % 50 === 0) save();
        if ((i + 1) % AUTO_SAVE_EVERY === 0) dlFile();
        await sleep(DELAY_BET);

      } catch (err) {
        errors++;
        log('ERROR ' + (i + 1) + ': ' + err.message + ' (' + errors + '/' + MAX_ERRORS + ')');
        dataset.meta.progress.lastError = err.message;
        if (errors >= MAX_ERRORS) {
          log('Too many errors — pausing. Fix, then startCapture().');
          paused = true; save();
          return 'error-paused';
        }
        await sleep(Math.min(2000 * errors, 30000));
        i--; // retry
      }
    }

    // End of phase — rotate to reveal final epoch's server seed
    await sleep(DELAY_ROTATE);
    await rotateAndRecord(pk + '-end', pk);
    save();
    log('Phase ' + pk + ' COMPLETE: ' + phase.rounds + ' bets');
    return 'done';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.testApi = async function () {
    log('Testing endpoints...');
    try {
      var s = await getActiveSeeds();
      log('PF Active OK: client=' + s.clientSeed + ' nonce=' + s.nonce + ' hash=' + (s.activeServerSeedHash || '').slice(0, 16) + '...');
    } catch (e) {
      log('PF Active FAILED: ' + e.message);
      return false;
    }
    try {
      var h = await api('GET', '/fast-games/plinko-game/my-bets');
      log('My-Bets OK: ' + ((h.data && h.data.rows && h.data.rows.length) || 0) + ' historical bets');
    } catch (e) { log('My-Bets FAILED (non-blocking): ' + e.message); }
    log('PASSED. Run startCapture() when ready.');
    return true;
  };

  window.startCapture = async function (phaseKey) {
    paused = false; errors = 0;

    if (dataset.bets.length === 0 && !isResuming) {
      log('Fresh start — rotating seed for clean nonce=0...');
      await rotateAndRecord('fresh-start', 'pre');
      await sleep(500);
    }
    isResuming = false;
    dataset.meta.progress.status = 'running';

    if (phaseKey) {
      var ph = PHASES.find(function (p) { return p.key === phaseKey; });
      if (!ph) { log('Unknown phase: ' + phaseKey); return; }
      await runPhase(ph);
    } else {
      for (var i = 0; i < PHASES.length; i++) {
        var res = await runPhase(PHASES[i]);
        if (res === 'paused' || res === 'error-paused') break;
      }
    }

    if (!paused) dataset.meta.progress.status = 'completed';
    save();
    log('Total: ' + dataset.bets.length + ' bets, ' + dataset.seeds.length + ' seeds');
  };

  window.pause = function () { paused = true; log('Pausing after current bet...'); };

  window.downloadData = function () {
    dataset.meta.exportedAt = new Date().toISOString();
    dlFile();
  };

  window.getStatus = function () {
    var counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (var i = 0; i < dataset.bets.length; i++) {
      var ph = dataset.bets[i].phase;
      if (counts[ph] !== undefined) counts[ph]++;
    }
    var s = {
      total: dataset.bets.length,
      seeds: dataset.seeds.length,
      phaseA: counts.A + '/5400',
      phaseB: counts.B + '/2000',
      phaseC: counts.C + '/200',
      phaseD: counts.D + '/500',
      phaseE: counts.E + '/2000',
      status: dataset.meta.progress.status || 'idle',
      paused: paused,
    };
    console.table(s);
    return s;
  };

  window.resumeCapture = function () {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { log('No checkpoint found.'); return; }
    var d = JSON.parse(raw);
    dataset.bets = d.bets || [];
    dataset.seeds = d.seeds || [];
    dataset.meta = d.meta || dataset.meta;
    isResuming = true;
    log('Loaded: ' + dataset.bets.length + ' bets, ' + dataset.seeds.length + ' seeds');
    log('Now run startCapture() — it will skip completed phases automatically.');
  };

  window.clearData = function () {
    localStorage.removeItem(STORAGE_KEY);
    dataset.bets = []; dataset.seeds = [];
    dataset.meta.progress = {};
    log('All data cleared. Ready for fresh start.');
  };

  window.inspectBets = function (from, to) {
    var sl = dataset.bets.slice(from || 0, to || 10);
    sl.forEach(function (b, i) {
      console.log((from || 0) + i, 'nonce=' + b.nonce, b.risk + '/' + b.rows, 'slot=' + b.winningSlot, 'x=' + b.multiplier, b.phase);
    });
  };

  window.checkDupes = function () {
    var ids = dataset.bets.map(function (b) { return b.betId; });
    var d = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
    log('Bets: ' + ids.length + ' | Dupes: ' + d.length);
    if (d.length) console.log(d);
  };

  // ── Banner ──────────────────────────────────────────────────────────────────

  console.log('\n' +
    '==========================================================\n' +
    '  LIQD Plinko Capture v1\n' +
    '==========================================================\n' +
    '  Fresh:  testApi() -> startCapture()\n' +
    '  Resume: resumeCapture() -> startCapture()\n' +
    '  Reset:  clearData() -> startCapture()\n' +
    '  Stop:   pause()\n' +
    '  Save:   downloadData()\n' +
    '  Check:  getStatus() / inspectBets(0,10) / checkDupes()\n' +
    '==========================================================\n' +
    '  A: 5400 x USDC 0.10 (27 configs x 200)\n' +
    '  B: 2000 x USDC 0.10 (high/16)\n' +
    '  C:  200 x USDC 10   (high/16 — bet-size invariance)\n' +
    '  D:  500 x USDC 0.10 (cycling configs, fresh client seed)\n' +
    '  E: 2000 x USDC 0.10 (WTF mode — riskLevel 4, rows 13)\n' +
    '  Total: 10,100 bets\n' +
    '==========================================================\n'
  );

  log('Ready. Cookie auth assumed (Cloudflare Access + app session). Run testApi() to verify.');

})();
