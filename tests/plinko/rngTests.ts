import { strict as assert } from 'node:assert';
import { generateProvablyFairNumber, revealPlinko, commitHash } from '../../src/rng';

// HMAC draw validation vectors (independent of any plinko round).
const SERVER_SEED = 'a3f90b1c2d4e5f60718293a4b5c6d7e8';
const CLIENT_SEED = 'client-seed';

describe('rng: HMAC draw validation vectors', () => {
  it('nonce=7 cursor=0 range=25 -> 2', () => {
    assert.equal(generateProvablyFairNumber(SERVER_SEED, CLIENT_SEED, 7, 0, 25), 2);
  });

  it('nonce=7 cursor=3 range=52 -> 49', () => {
    assert.equal(generateProvablyFairNumber(SERVER_SEED, CLIENT_SEED, 7, 3, 52), 49);
  });
});

describe('plinko: real captured bet reproduction', () => {
  // Master dataset epoch-0 bet (seed[0]): the worked example used throughout the report.
  // serverSeed fc9a…, clientSeed auditb1141320acde, nonce 0, rows 8 -> dropDetails "01101111" slot 6.
  it('serverSeed fc9a… clientSeed auditb1141320acde nonce=0 rows=8 -> dropDetails "01101111" slot 6', () => {
    const { path, winningSlot } = revealPlinko(
      'fc9a1d6fad00e0832fddfdea45435c85',
      'auditb1141320acde',
      0,
      8,
    );
    assert.equal(path, '01101111');
    assert.equal(winningSlot, 6);
  });
});

describe('rng: commitment hash (SHA-256 of utf8 hex string)', () => {
  it('commitHash reproduces a known hashedServerSeed', () => {
    // seed[0] of the master dataset: serverSeed fc9a… -> hashedServerSeed 3b34…
    assert.equal(
      commitHash('fc9a1d6fad00e0832fddfdea45435c85'),
      '3b34a0fce5732f2d9c89b16fca9c2b6a231c2b7f2de29bbc41e141861dc39d36',
    );
  });
});
