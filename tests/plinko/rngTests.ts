import { strict as assert } from 'node:assert';
import { revealPlinko, commitHash } from '../../src/rng';

// Removed 20 Oct 2026 with the rebuild of src/rng.ts from docs/ALGORITHM.md: four
// generateProvablyFairNumber vectors at ranges 25, 52 and 3,000,000,000, two of which exercised
// the earlier port's rejection branch (first chunk rejected; all eight chunks rejected and the draw
// retried at cursor + 1,000,000). The spec defines the draw for range 2 only, with no rejection
// step, and Plinko draws nothing else; the spec's own vectors and properties are
// tests/plinko/rngSpecTests.ts.

describe('plinko: real captured bet reproduction', () => {
  // The first drop of the production dataset (epoch 0, nonce 0): the worked example used throughout the report.
  // serverSeed 9ef0…, clientSeed auditf011676cf201, nonce 0, rows 8 -> dropDetails "10010101" slot 4.
  it('serverSeed 9ef0… clientSeed auditf011676cf201 nonce=0 rows=8 -> dropDetails "10010101" slot 4', () => {
    const { path, winningSlot } = revealPlinko(
      '9ef0b85313bd2d1b8d96e22df9b08ff4',
      'auditf011676cf201',
      0,
      8,
    );
    assert.equal(path, '10010101');
    assert.equal(winningSlot, 4);
  });
  // A drop that landed in a 1,000x bucket (Phase B, 16 rows / high risk, epoch 35, nonce 122): sixteen lefts.
  it('serverSeed 715b… clientSeed audit08d03eedd4b7 nonce=122 rows=16 -> sixteen lefts, slot 0', () => {
    const { path, winningSlot } = revealPlinko('715bcb6f4a43571308e03e95b99931bc', 'audit08d03eedd4b7', 122, 16);
    assert.equal(path, '0000000000000000');
    assert.equal(winningSlot, 0);
  });
});

describe('rng: commitment hash (SHA-256 of utf8 hex string)', () => {
  it('commitHash reproduces a known hashedServerSeed', () => {
    // The pair that was active before the first capture's first round (meta.captures[0].preCapture):
    // serverSeed ddcd… -> hashedServerSeed 3de4…
    assert.equal(
      commitHash('ddcda6f7c125e6494b4f090024ed3090'),
      '3de47d79a186ad44530ee8c65f292879e3d3b47ce31a0dd454e947216861c222',
    );
  });
});
