/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step } from './context';
import type { VerifyContext } from './context';
import { commitHash } from '../../src/rng';
// G-BIND: the epoch length Step 4 enforces is a CODE constant, not `meta.epochSize`. Reading it
// from the header made the nonce-range check self-referential — a capture truncated to 30 nonces
// per epoch with `meta.epochSize = 30` satisfied it, which is exactly the shrink a reviewer
// executed against the sibling `dice` audit on 2026-09-09.
import { EXPECTED_EPOCH_SIZE, EXPECTED_SEEDS } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, byHash, bets, preCapture } = ctx;

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
  // Each epoch's nextHashedServerSeed must equal the following epoch's hashedServerSeed.
  // Prepended: the pre-capture link (meta.preCapture) — its revealed serverSeed hashes
  // to its committed hashedServerSeed, and its nextHashedServerSeed equals epoch 0's
  // hashedServerSeed. This is the evidence that epoch 0's seed was committed BEFORE the
  // first captured bet, which the epoch-to-epoch chain alone does not show.
  const byEpoch = [...seeds].sort((a, b) => a.epoch - b.epoch);
  let promoChecked = 0, promoFails = 0;
  const preFails: string[] = [];
  // The pre-capture link is scored evidence in F2 (it is what proves epoch 0's seed was
  // committed before the first captured bet), so it is MANDATORY, not optional: a dataset
  // without meta.preCapture cannot pass this step.
  if (!preCapture) {
    promoFails++; preFails.push('meta.preCapture missing (required — it anchors the chain before epoch 0)');
  } else {
    promoChecked++;
    // (a) pre-capture commit: SHA-256(utf8(revealedServerSeed)) == its hashedServerSeed.
    if (!preCapture.revealedServerSeed || commitHash(preCapture.revealedServerSeed) !== preCapture.hashedServerSeed) {
      promoFails++; preFails.push('pre-capture commit mismatch');
    }
    // (b) chain link: pre-capture nextHashedServerSeed == epoch 0's hashedServerSeed.
    if (byEpoch.length > 0 && preCapture.nextHashedServerSeed !== byEpoch[0].hashedServerSeed) {
      promoFails++; preFails.push('pre-capture → epoch 0 chain link mismatch');
    }
  }
  const epochTransitions = Math.max(byEpoch.length - 1, 0);
  for (let i = 0; i + 1 < byEpoch.length; i++) {
    promoChecked++;
    if (byEpoch[i].nextHashedServerSeed !== byEpoch[i + 1].hashedServerSeed) promoFails++;
  }
  const s2 = step(2, 'Next-Seed Pre-Commitment Chain',
    promoFails === 0 ? 'PASS' : 'FAIL',
    promoFails === 0
      ? `${promoChecked}/${promoChecked} pre-commitments verified (${epochTransitions} epoch transitions${preCapture ? ' plus the pre-capture link' : ''}): each nextHashedServerSeed == the next commitment's hashedServerSeed${preCapture ? ', and the pre-capture serverSeed hashes to its committed hash' : ''}`
      : `${promoChecked - promoFails}/${promoChecked} match; ${promoFails} mismatch${preFails.length ? ` (${preFails.join('; ')})` : ''}`,
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
    // The nonce stream of an epoch must be EXACTLY {0,1,…,EXPECTED_EPOCH_SIZE−1}, each once. A
    // membership-only scan (0..max present) misses a DUPLICATE — e.g. a second copy of
    // nonce 0 replacing the last nonce still spans 0..max. Require the distinct-nonce
    // count to equal the bet count (no duplicates) and the max to be EXPECTED_EPOCH_SIZE−1 (no
    // truncation / off-by-one), in addition to first==0 and 0..max fully covered.
    if (nonceSet.size !== sorted.length) {
      hardFailures.push(`Epoch ${shortHash}: ${sorted.length - nonceSet.size} duplicate nonce(s)`);
    }
    if (maxNonce !== EXPECTED_EPOCH_SIZE - 1) {
      hardFailures.push(`Epoch ${shortHash}: max nonce is ${maxNonce} (expected ${EXPECTED_EPOCH_SIZE - 1})`);
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
      ? `${epochsChecked} epochs: nonces sequential 0–${EXPECTED_EPOCH_SIZE - 1} (against src/loader.ts EXPECTED_EPOCH_SIZE, not meta.epochSize), single client seed per epoch`
      : `${hardFailures.length} violations: ${hardFailures.slice(0, 3).join('; ')}`,
  );

  return [s1, s2, s3, s4];
}
