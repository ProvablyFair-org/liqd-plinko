import { strict as assert } from 'node:assert';
import { revealPlinko, commitHash } from '../../src/rng';

// Removed 20 Oct 2026 with the rebuild of src/rng.ts from docs/ALGORITHM.md: four
// generateProvablyFairNumber vectors at ranges 25, 52 and 3,000,000,000, two of which exercised
// the earlier port's rejection branch (first chunk rejected; all eight chunks rejected and the draw
// retried at cursor + 1,000,000). The spec defines the draw for range 2 only, with no rejection
// step, and Plinko draws nothing else; the spec's own vectors and properties are
// tests/plinko/rngSpecTests.ts.

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
