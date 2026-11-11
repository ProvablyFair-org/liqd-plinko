/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { commitHash } from '../../src/rng';
// G-BIND: the epoch length Step 4 enforces is a CODE constant (the epochSize of the epoch's plan entry in
// src/loader.ts EXPECTED_PLAN), not a figure from the dataset header. Reading it from the header would make the
// nonce-range check self-referential: a capture truncated to 30 nonces per epoch with a header that says 30
// satisfies it, so the population could be shrunk and the check would still pass. The plan id itself is read from
// the bets; Step 12 holds the NUMBER of epochs carrying each id to the plan, so relabelling cannot shrink it.
import { EXPECTED_SEEDS, EXPECTED_CAPTURE_EPOCHS, EXPECTED_EPOCH_SIZE, planEntry } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, byHash, bets, captures } = ctx;

  // ── Step 1: Seed hash integrity ─────────────────────────────────────────────
  // liqd commitment = SHA-256( utf8_bytes( serverSeed_hex_string ) ), via commitHash.
  let checked = 0, fails = 0;
  for (const s of seeds) {
    if (!s.serverSeed) continue;
    if (commitHash(s.serverSeed) !== s.hashedServerSeed) fails++;
    checked++;
  }
  const s1 = step(1, 'Seed Hash Integrity',
    checked === seeds.length && checked === EXPECTED_SEEDS && fails === 0 ? 'PASS' : 'FAIL',
    `${checked}/${seeds.length} seeds revealed and checked (expected ${EXPECTED_SEEDS}, from src/loader.ts EXPECTED_SEEDS — not from the dataset's own seed-record count, which would make "all of them" true of any subset); SHA-256(utf8(serverSeed)) == hashedServerSeed; ${fails} mismatches`,
  );

  // ── Step 2: Next-seed pre-commitment chain ──────────────────────────────────
  // The dataset is three captures: three separate runs on one account, with other play on the account between
  // them. The seed chain is therefore asserted INSIDE each capture, and each capture is anchored by its own
  // pre-capture record (meta.captures[i].preCapture):
  //   (a) the pair active before the capture's first round was revealed by the capture's first rotation and
  //       SHA-256(utf8(revealedServerSeed)) == its hashedServerSeed;
  //   (b) its nextHashedServerSeed == the hashedServerSeed of the capture's first epoch — the evidence that the
  //       first epoch's seed was committed BEFORE the capture's first bet;
  //   (c) inside the capture, each epoch's nextHashedServerSeed == the following epoch's hashedServerSeed.
  // The anchors are MANDATORY: a capture without one cannot pass. The number of captures and the epochs each
  // holds are code constants (EXPECTED_CAPTURE_EPOCHS), so merging or splitting captures to hide a broken link
  // fails. No link is asserted ACROSS two captures: the seed pairs used between them are not in this dataset.
  const byEpoch = [...seeds].sort((a, b) => a.epoch - b.epoch);
  let promoChecked = 0, promoFails = 0, anchorsOk = 0, epochTransitions = 0;
  const preFails: string[] = [];
  const captureShapeOk = captures.length === EXPECTED_CAPTURE_EPOCHS.length
    && EXPECTED_CAPTURE_EPOCHS.every((n, i) => byEpoch.filter(s => s.capture === i + 1).length === n);
  if (!captureShapeOk) {
    promoFails++;
    preFails.push(`capture layout: ${captures.length} capture record(s) holding ${captures.map((_, i) => byEpoch.filter(s => s.capture === i + 1).length).join(' / ')} epoch(s), expected ${EXPECTED_CAPTURE_EPOCHS.join(' / ')} (src/loader.ts EXPECTED_CAPTURE_EPOCHS)`);
  }
  for (let c = 1; c <= EXPECTED_CAPTURE_EPOCHS.length; c++) {
    const rec = captures.find(x => x.capture === c);
    const own = byEpoch.filter(s => s.capture === c);
    const pre = rec?.preCapture;
    promoChecked++;
    if (!pre) {
      promoFails++; preFails.push(`capture ${c}: pre-capture record missing (required — it anchors the chain before the capture's first epoch)`);
    } else {
      let ok = true;
      if (!pre.revealedServerSeed || commitHash(pre.revealedServerSeed) !== pre.hashedServerSeed) { ok = false; preFails.push(`capture ${c}: pre-capture commit mismatch`); }
      if (own.length === 0 || pre.nextHashedServerSeed !== own[0].hashedServerSeed) { ok = false; preFails.push(`capture ${c}: pre-capture → first epoch chain link mismatch`); }
      if (ok) anchorsOk++; else promoFails++;
    }
    for (let i = 0; i + 1 < own.length; i++) {
      promoChecked++; epochTransitions++;
      if (own[i].nextHashedServerSeed !== own[i + 1].hashedServerSeed) { promoFails++; if (preFails.length < 4) preFails.push(`capture ${c}: epoch ${own[i].epoch} → ${own[i + 1].epoch} link mismatch`); }
    }
  }
  const s2 = step(2, 'Next-Seed Pre-Commitment Chain',
    promoFails === 0 ? 'PASS' : 'FAIL',
    promoFails === 0
      ? `${promoChecked}/${promoChecked} pre-commitments verified: ${epochTransitions} epoch transitions inside the ${captures.length} captures (each nextHashedServerSeed == the next epoch's hashedServerSeed) plus ${anchorsOk} pre-capture links, one per capture (the pair active before the capture's first round hashes to its commitment and its next hash is the capture's first epoch). No link is asserted across two captures`
      : `${promoChecked - promoFails}/${promoChecked} match; ${promoFails} mismatch${preFails.length ? ` (${preFails.join('; ')})` : ''}`,
    { preCommitmentsChecked: promoChecked, preCommitmentFails: promoFails, epochTransitions, preCaptureAnchors: anchorsOk, captures: captures.length },
  );

  // ── Step 3: Hash consistency within epoch ────────────────────────────────────
  // Group by epoch (NOT by hash) so this can genuinely FAIL if any epoch mixed
  // hashedServerSeed values. Grouping by hash would be tautological.
  const betsByEpoch = new Map<number, typeof bets>();
  for (const b of bets) {
    const arr = betsByEpoch.get(b.epoch) ?? [];
    arr.push(b);
    betsByEpoch.set(b.epoch, arr);
  }
  let epochsMultipleHashes = 0;
  for (const [, epochBets] of betsByEpoch) {
    const hashes = new Set(epochBets.map(b => b.hashedServerSeed));
    if (hashes.size !== 1) epochsMultipleHashes++;
  }
  const s3 = step(3, 'Hash Consistency Within Epoch',
    epochsMultipleHashes === 0 ? 'PASS' : 'FAIL',
    `${betsByEpoch.size} epochs: all bets within each epoch share the same hashedServerSeed; ${epochsMultipleHashes} violations`,
  );

  // ── Step 4: Nonce audit ──────────────────────────────────────────────────────
  const hardFailures: string[] = [];
  const sizesSeen = new Set<number>();
  let epochsChecked = 0;
  for (const [hash, epochBets] of byHash) {
    const sorted = [...epochBets].sort((a, b) => a.nonce - b.nonce);
    const shortHash = hash.substring(0, 16);
    const nonces = sorted.map(b => b.nonce);

    const clientSeeds = new Set(sorted.map(b => b.clientSeed));
    if (clientSeeds.size !== 1) {
      hardFailures.push(`Epoch ${shortHash}: ${clientSeeds.size} distinct client seeds`);
    }
    if (nonces[0] !== 0) {
      hardFailures.push(`Epoch ${shortHash}: first nonce is ${nonces[0]} (expected 0)`);
    }
    const maxNonce = Math.max(...nonces);
    const nonceSet = new Set(nonces);
    // The nonce stream of an epoch must be EXACTLY {0,1,…,size−1}, each once, where size is the
    // epochSize of the epoch's plan entry (src/loader.ts EXPECTED_PLAN). A membership-only scan
    // (0..max present) misses a DUPLICATE — e.g. a second copy of nonce 0 replacing the last nonce
    // still spans 0..max. Require the distinct-nonce count to equal the bet count (no duplicates)
    // and the max to be size−1 (no truncation / off-by-one), in addition to first==0 and 0..max
    // fully covered.
    const ids = new Set(sorted.map(b => b.phaseId));
    const entry = ids.size === 1 ? planEntry([...ids][0]) : undefined;
    if (!entry) {
      hardFailures.push(`Epoch ${shortHash}: plan id(s) ${[...ids].join(',')} — not one entry of the plan`);
      epochsChecked++;
      continue;
    }
    sizesSeen.add(EXPECTED_EPOCH_SIZE[entry.id]);
    if (nonceSet.size !== sorted.length) {
      hardFailures.push(`Epoch ${shortHash}: ${sorted.length - nonceSet.size} duplicate nonce(s)`);
    }
    if (maxNonce !== EXPECTED_EPOCH_SIZE[entry.id] - 1) {
      hardFailures.push(`Epoch ${shortHash} (plan ${entry.id}): max nonce is ${maxNonce} (expected ${EXPECTED_EPOCH_SIZE[entry.id] - 1})`);
    }
    for (let n = 0; n <= maxNonce; n++) {
      if (!nonceSet.has(n)) {
        hardFailures.push(`Epoch ${shortHash}: missing nonce ${n}`);
        break;
      }
    }
    epochsChecked++;
  }
  const s4 = step(4, 'Nonce Audit',
    hardFailures.length === 0 ? 'PASS' : 'FAIL',
    hardFailures.length === 0
      ? `${epochsChecked} epochs: nonces sequential 0…size−1 with no gap or repeat, size = the epochSize of the epoch's plan entry (src/loader.ts EXPECTED_PLAN, not the dataset header; sizes ${[...sizesSeen].sort((a, b) => a - b).join(', ')}), single client seed per epoch`
      : `${hardFailures.length} violations: ${hardFailures.slice(0, 3).join('; ')}`,
  );

  return [s1, s2, s3, s4];
}
