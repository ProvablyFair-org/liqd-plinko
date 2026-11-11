#!/usr/bin/env node
/**
 * spec-check — re-measures every DATA figure docs/ALGORITHM.md quotes, on the production dataset.
 *
 * Reads only: the scored dataset (src/loader.ts DATASET_FILE) and the saved production page read
 * (evidence/liqd-plinko-page-reads-2026-10-20.json, for the multiplier labels). Imports nothing from
 * src/: the derivation below is written out here from the spec text, with Node's crypto only, so the
 * spec is checked by a second, independent implementation and not by the module built from it.
 *
 * Run: node scripts/spec-check.mjs            prints the figures (docs/ALGORITHM.md §7 quotes this output)
 *      node scripts/spec-check.mjs --vectors  also prints the §5 test vectors
 * Exit 0 when the specified construction reproduces every bet and every table check holds, 1 otherwise.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const loaderTs = readFileSync(join(ROOT, 'src', 'loader.ts'), 'utf8');
const DATASET_FILE = (loaderTs.match(/export const DATASET_FILE = '([^']+)'/) ?? [])[1];
const raw = readFileSync(join(ROOT, DATASET_FILE));
const ds = JSON.parse(raw.toString('utf8'));
const page = JSON.parse(readFileSync(join(ROOT, 'evidence', 'liqd-plinko-page-reads-2026-10-20.json'), 'utf8'));
const { seeds, bets, meta } = ds;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const out = [];
const say = (s) => { out.push(s); console.log(s); };
let ok = true;
const need = (cond) => { if (!cond) ok = false; return cond; };

say(`dataset ${DATASET_FILE} sha256 ${sha(raw)}: ${bets.length} bets, ${seeds.length} seed records, ${meta.captures.length} captures`);

// ── §1.2 commitment ───────────────────────────────────────────────────────────
const ascii = new Map(seeds.map((s) => [sha(Buffer.from(s.serverSeed, 'ascii')), s]));
const decoded = new Set(seeds.map((s) => sha(Buffer.from(s.serverSeed, 'hex'))));
const betHashes = [...new Set(bets.map((b) => b.hashedServerSeed))];
const resolveAscii = betHashes.filter((h) => ascii.has(h)).length;
const resolveDecoded = betHashes.filter((h) => decoded.has(h)).length;
const betsCovered = bets.filter((b) => ascii.has(b.hashedServerSeed)).length;
say(`commitment SHA256(ascii serverSeed) resolves ${resolveAscii}/${betHashes.length} bet hashes, covering ${betsCovered}/${bets.length} bets`);
say(`  (SHA256(hex-decoded bytes): ${resolveDecoded}/${betHashes.length})`);
say(`  seed records whose own hashedServerSeed == commitment(own serverSeed): ${seeds.filter((s) => sha(Buffer.from(s.serverSeed, 'ascii')) === s.hashedServerSeed).length}/${seeds.length}`);
need(resolveAscii === betHashes.length && betsCovered === bets.length && resolveDecoded === 0);
const pre = meta.captures.map((c) => c.preCapture);
const preOk = pre.filter((p) => sha(Buffer.from(p.revealedServerSeed, 'ascii')) === p.hashedServerSeed).length;
say(`pre-capture records: SHA256(ascii revealedServerSeed) == hashedServerSeed: ${preOk}/${pre.length}`);
need(preOk === pre.length);
const seedLens = [...new Set([...seeds.map((s) => s.serverSeed), ...pre.map((p) => p.revealedServerSeed)].map((x) => `${x.length}${/^[0-9a-f]+$/.test(x) ? ' lowercase hex' : ' OTHER'}`))];
say(`server seed form (${seeds.length} revealed seeds + ${pre.length} pre-capture seeds): ${seedLens.join(', ')} chars`);

// forward chain inside each capture
let links = 0, linkN = 0, anchors = 0;
for (const c of meta.captures) {
  const own = seeds.filter((s) => s.capture === c.capture).sort((a, b) => a.epoch - b.epoch);
  if (c.preCapture.nextHashedServerSeed === own[0].hashedServerSeed) anchors++;
  for (let i = 0; i + 1 < own.length; i++) { linkN++; if (own[i].nextHashedServerSeed === own[i + 1].hashedServerSeed) links++; }
}
say(`forward chain nextHashedServerSeed[k] == hashedServerSeed[k+1] inside each capture: ${links}/${linkN}`);
say(`pre-capture nextHashedServerSeed == the capture's first epoch hash: ${anchors}/${meta.captures.length}`);
need(links === linkN && anchors === meta.captures.length);
const byEpoch = new Map();
for (const b of bets) { const a = byEpoch.get(b.epoch) ?? []; a.push(b.nonce); byEpoch.set(b.epoch, a); }
const sizes = {};
let nonceOk = 0;
for (const [, ns] of byEpoch) { const s = [...ns].sort((a, b) => a - b); if (s.every((n, i) => n === i)) nonceOk++; sizes[s.length] = (sizes[s.length] ?? 0) + 1; }
say(`epochs with nonces exactly 0..n-1: ${nonceOk} / ${byEpoch.size}  (epoch lengths: ${Object.entries(sizes).map(([n, c]) => `${c} of ${n}`).join(', ')})`);
need(nonceOk === byEpoch.size);

// client seed forms, stakes
const forms = {};
for (const b of bets) { const f = /^audit[0-9a-f]{12}$/.test(b.clientSeed) ? 'audit + 12 hex' : /^pfaudit-prod-plinko-d\d+-[0-9a-f]{12}$/.test(b.clientSeed) ? 'pfaudit-prod-plinko-d<k>- + 12 hex' : 'OTHER'; forms[f] = forms[f] ?? { bets: 0, seeds: new Set() }; forms[f].bets++; forms[f].seeds.add(b.clientSeed); }
say(`client seed forms: ${Object.entries(forms).map(([f, v]) => `${f} (${[...new Set([...v.seeds].map((x) => x.length))].join('/')} chars): ${v.bets} bets, ${v.seeds.size} seeds`).join('; ')}`);
const stakes = {}; for (const b of bets) stakes[b.betAmount] = (stakes[b.betAmount] ?? 0) + 1;
say(`stakes (betAmount): ${Object.entries(stakes).map(([s, n]) => `${s} x ${n}`).join(', ')}`);
const boards = {}; for (const b of bets) { const k = `riskLevel ${b.riskLevel}`; boards[k] = boards[k] ?? new Set(); boards[k].add(b.numberOfRows); }
say(`rows per riskLevel: ${Object.entries(boards).sort().map(([k, v]) => `${k}: ${[...v].sort((a, b) => a - b).join(',')}`).join('; ')}`);

// ── §2 derivation: the specified construction and the candidates ──────────────
const seedOf = (b) => ascii.get(b.hashedServerSeed).serverSeed;
const keyHex = (s) => Buffer.from(s, 'hex'), keyAscii = (s) => Buffer.from(s, 'ascii');
const hmac = (key, msg) => createHmac('sha256', key).update(msg, 'utf8').digest();
const RULES = {
  'u32 BE mod 2': (d, o) => d.readUInt32BE(o) % 2,
  'u32 LE mod 2': (d, o) => d.readUInt32LE(o) % 2,
  'first byte >= 128': (d, o) => (d[o] >= 128 ? 1 : 0),
};
const perRow = (key, base, rule) => (b) => { let p = ''; for (let i = 0; i < b.numberOfRows; i++) p += RULES[rule](hmac(key(seedOf(b)), `${b.clientSeed}:${b.nonce}:${i + base}`), 0); return p; };
const stream = (key, base, rule) => (b) => {
  let p = '', cursor = base, d = hmac(key(seedOf(b)), `${b.clientSeed}:${b.nonce}:${cursor}`), o = 0;
  for (let i = 0; i < b.numberOfRows; i++) { if (o + 4 > d.length) { cursor++; d = hmac(key(seedOf(b)), `${b.clientSeed}:${b.nonce}:${cursor}`); o = 0; } p += RULES[rule](d, o); o += 4; }
  return p;
};
const single = (key, fmt, msbFirst) => (b) => {
  const d = hmac(key(seedOf(b)), fmt(b)); let p = '';
  for (let i = 0; i < b.numberOfRows; i++) { const byte = d[i >> 3], bit = msbFirst ? (byte >> (7 - (i & 7))) & 1 : (byte >> (i & 7)) & 1; p += bit; }
  return p;
};
const score = (fn) => { let path = 0, slot = 0; for (const b of bets) { const p = fn(b); if (p === b.dropDetails) path++; if (p.split('').filter((c) => c === '1').length === b.winningSlot) slot++; } return { path, slot }; };
const best = (fns) => fns.map(score).reduce((m, s) => ({ path: Math.max(m.path, s.path), slot: Math.max(m.slot, s.slot) }), { path: 0, slot: 0 });
const ruleNames = Object.keys(RULES);

const spec = score(perRow(keyHex, 1, 'u32 BE mod 2'));
say(`path: bit_r = u32BE(HMAC-SHA256(key=hexdecode(serverSeed), "clientSeed:nonce:r")[0:4]) mod 2, r=1..rows; string == dropDetails: ${spec.path}/${bets.length}`);
const mirrored = bets.filter((b) => b.numberOfRows - b.dropDetails.split('').filter((c) => c === '1').length === b.winningSlot).length;
say(`slot = number of 1-bits == winningSlot: ${spec.slot}/${bets.length}  (mirrored rows-sum: ${mirrored}/${bets.length})`);
need(spec.path === bets.length && spec.slot === bets.length);
say('candidates (best path / best slot over the variants named), all on the full dataset:');
const cands = [
  ['same, r = 0..rows-1', [perRow(keyHex, 0, 'u32 BE mod 2')]],
  ['same (r from 0 or 1), bit = u32 little-endian mod 2', [perRow(keyHex, 0, 'u32 LE mod 2'), perRow(keyHex, 1, 'u32 LE mod 2')]],
  ['same (r from 0 or 1), bit = first byte >= 128', [perRow(keyHex, 0, 'first byte >= 128'), perRow(keyHex, 1, 'first byte >= 128')]],
  ['key = the 32-char ASCII seed; per-row HMAC, r from 0 or 1, each of the 3 bit rules', [0, 1].flatMap((base) => ruleNames.map((r) => perRow(keyAscii, base, r)))],
  ['one byte stream from msg c:n:cursor (cursor from 0 or 1), consecutive 4-byte chunks per row, each of the 3 bit rules, either key form', [keyHex, keyAscii].flatMap((k) => [0, 1].flatMap((base) => ruleNames.map((r) => stream(k, base, r))))],
  ['single HMAC msg c:n, c:n:0, c-n, either key form, first rows bits of the digest MSB-first or LSB-first', [keyHex, keyAscii].flatMap((k) => [(b) => `${b.clientSeed}:${b.nonce}`, (b) => `${b.clientSeed}:${b.nonce}:0`, (b) => `${b.clientSeed}-${b.nonce}`].flatMap((f) => [true, false].map((m) => single(k, f, m))))],
];
for (const [name, fns] of cands) { const r = best(fns); say(`  ${name}: path <= ${r.path}, slot <= ${r.slot}`); need(r.path < bets.length); }

// ── §3 multiplier table (the production page labels) and payout ───────────────
const RISK = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'WTF' };
const text = page.plinkoPage.text;
const has1k = text.includes('1,000x (High at 16 rows, WTF at 13 rows)');
const hasZero = text.includes('the ten middle buckets pay nothing');
const labelCell = (rows, risk, slot) => {
  const strip = page.boardLabels.labels[`${RISK[risk]}/${rows}`];
  if (risk === 4) { const last = rows; const i = [0, 1, last - 1, last].indexOf(slot); if (i < 0) return hasZero ? 0 : NaN; const l = strip[i]; return l === '1k' ? (has1k ? 1000 : NaN) : Number(l); }
  const l = strip[slot]; return l === '1k' ? (has1k ? 1000 : NaN) : Number(l);
};
const multOk = bets.filter((b) => labelCell(b.numberOfRows, b.riskLevel, b.winningSlot) === b.multiplier).length;
say(`served multiplier == page board label table[rows][risk][slot] (1k=1000, WTF middle ten=0): ${multOk}/${bets.length}`);
need(multOk === bets.length);
const cells = new Set(bets.map((b) => `${b.numberOfRows}:${b.riskLevel}:${b.winningSlot}`));
let total = 0; for (let rows = 8; rows <= 16; rows++) total += 3 * (rows + 1); total += 14;
say(`table cells exercised by the data: ${cells.size}/${total}`);
// exact decimal product in integer 1e-8 units (stake and winning amount are decimal strings; multipliers have <= 1 decimal)
const units = (s) => { const [i, f = ''] = String(s).split('.'); return BigInt(i) * 100000000n + BigInt((f + '00000000').slice(0, 8)); };
const payOk = bets.filter((b) => units(b.betAmount) * BigInt(Math.round(b.multiplier * 10)) === units(b.winningAmount) * 10n).length;
say(`winningAmount == betAmount x table multiplier (exact decimal): ${payOk}/${bets.length}`);
need(payOk === bets.length);
const wonOk = bets.filter((b) => (b.result === 'won') === (b.multiplier >= 1)).length;
say(`result == "won" iff multiplier >= 1: ${wonOk}/${bets.length}  (drops at exactly 1x labelled won: ${bets.filter((b) => b.multiplier === 1 && b.result === 'won').length}; drops paying a non-zero amount under 1x labelled lost: ${bets.filter((b) => b.multiplier > 0 && b.multiplier < 1 && b.result === 'lost').length}; drops paying 0 labelled lost: ${bets.filter((b) => b.multiplier === 0 && b.result === 'lost').length})`);
need(wonOk === bets.length);
const amountForms = {}; for (const b of bets) { const f = /^\d+\.\d{8}$/.test(b.winningAmount) ? '8-decimal string' : `"${b.winningAmount}"`; amountForms[f] = (amountForms[f] ?? 0) + 1; }
say(`winningAmount forms: ${Object.entries(amountForms).map(([f, n]) => `${f} x ${n}`).join(', ')}`);
say(`largest payout in the data: ${bets.reduce((m, b) => (Number(b.winningAmount) > Number(m.winningAmount) ? b : m)).winningAmount} (bet ${bets.reduce((m, b) => (Number(b.winningAmount) > Number(m.winningAmount) ? b : m)).id})`);
// exact RTP of the page table, 28 configs
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
let min = [9, ''], max = [0, ''], sym = 0, n = 0, wtfRtp = 0;
for (const risk of [1, 2, 3, 4]) for (let rows = 8; rows <= 16; rows++) {
  if (risk === 4 && rows !== 13) continue;
  const t = Array.from({ length: rows + 1 }, (_, k) => labelCell(rows, risk, k));
  const rtp = t.reduce((s, m, k) => s + (binom(rows, k) / 2 ** rows) * m, 0);
  n++; if (t.every((m, k) => m === t[rows - k])) sym++;
  if (risk === 4) wtfRtp = rtp;
  if (rtp < min[0]) min = [rtp, `(${rows}, ${risk})`]; if (rtp > max[0]) max = [rtp, `(${rows}, ${risk})`];
}
say(`exact RTP over ${n} configs: min ${min[0].toFixed(6)} at ${min[1]}, max ${max[0].toFixed(6)} at ${max[1]}; WTF/13 ${wtfRtp.toFixed(6)}`);
say(`symmetric tables: ${sym} / ${n}`);
need(sym === n);

// ── §5 vectors ────────────────────────────────────────────────────────────────
if (process.argv.includes('--vectors')) {
  const pick = [
    ['V1', 'Phase A, the first drop of the first capture', bets.find((b) => b.phaseId === 'A' && b.epoch === 0 && b.nonce === 0)],
    ['V2', 'Phase B, the highest multiplier in Phase B', bets.filter((b) => b.phase === 'B').reduce((m, b) => (b.multiplier > m.multiplier ? b : m))],
    ['V3', 'Phase C, stake 10, the highest multiplier in Phase C', bets.filter((b) => b.phase === 'C').reduce((m, b) => (b.multiplier > m.multiplier ? b : m))],
    ['V4', 'Phase D, player-set client seed, the highest multiplier in Phase D', bets.filter((b) => b.phase === 'D').reduce((m, b) => (b.multiplier > m.multiplier ? b : m))],
    ['V5', 'Phase E, WTF, the first drop that paid', bets.find((b) => b.phase === 'E' && b.multiplier > 0)],
  ];
  for (const [id, why, b] of pick) {
    const s = seedOf(b), key = keyHex(s);
    const ds = Array.from({ length: b.numberOfRows }, (_, i) => hmac(key, `${b.clientSeed}:${b.nonce}:${i + 1}`));
    const u = ds.map((d) => d.readUInt32BE(0));
    const path = u.map((x) => x % 2).join('');
    console.log(`\n**${id}: bet \`${b.id}\`** (${why}; epoch ${b.epoch}, ${b.numberOfRows} rows, ${RISK[b.riskLevel]}, nonce ${b.nonce})`);
    console.log('```');
    console.log(`serverSeed  ${s}`);
    console.log(`commitment  ${sha(Buffer.from(s, 'ascii'))}`);
    console.log(`clientSeed  ${b.clientSeed}   nonce ${b.nonce}   rows ${b.numberOfRows}   risk ${b.riskLevel} (${RISK[b.riskLevel]})   amount ${b.betAmount}`);
    console.log(`digest_1 (msg "${b.clientSeed}:${b.nonce}:1")`);
    console.log(`            ${ds[0].toString('hex')}`);
    console.log(`u32 r=1..${b.numberOfRows} ${u.join(' ')}`);
    console.log(`path        ${path}   → slot ${path.split('').filter((c) => c === '1').length}`);
    console.log(`multiplier  ${b.multiplier}        winningAmount ${b.winningAmount}   result ${b.result}`);
    console.log('```');
    need(path === b.dropDetails && sha(Buffer.from(s, 'ascii')) === b.hashedServerSeed);
  }
}
console.log(ok ? '\nspec-check: OK' : '\nspec-check: FAIL');
process.exit(ok ? 0 : 1);
