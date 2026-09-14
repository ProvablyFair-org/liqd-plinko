import { strict as assert } from 'node:assert';
import { randomFillSync } from 'node:crypto';

import { loadPlinkoConfig, allConfigs } from '../../src/config';
import {
  Z_LEFT_TAIL,
  payoutValueDistribution,
  payoutMuSd,
  leftTailSumThreshold,
  exactLeftTailProbability,
  enumerationLeftTailProbability,
  poissonBinomialPmf,
  poissonBinomialSurvival,
  calibrateLeftTailCount,
  type ValueProb,
} from '../../src/calibration';

/**
 * Tests for the calibrated null (FIX-19).
 *
 * The calibrated expectation is a scored input to Step 17, so per audit-rules 9.4 the
 * new derived predicate needs (a) an independent check that it is RIGHT and (b) a
 * known-bad value proving the guard can FAIL. Both are here.
 *
 * Three independent anchors, deliberately not sharing code with the DP:
 *   1. brute-force enumeration of every payout sequence at small n — exact;
 *   2. a closed-form multinomial sum at the FULL production n on the WTF config;
 *   3. Monte-Carlo at the full production n on a config the other two cannot reach.
 */

const cfg = loadPlinkoConfig();

/** Exact P(sum < threshold) by enumerating every length-n sequence. Only for tiny n. */
function bruteForceLeftTail(dist: ValueProb[], n: number, threshold: number): number {
  let acc = 0;
  const walk = (i: number, sum: number, p: number): void => {
    if (i === n) { if (sum < threshold) acc += p; return; }
    for (const d of dist) walk(i + 1, sum + d.value, p * d.prob);
  };
  walk(0, 0, 1);
  return acc;
}

describe('calibration: exact left-tail DP vs brute-force enumeration', () => {
  // Small n, every config family, thresholds above and below the mean — the DP has to
  // agree with a full enumeration to floating-point rounding, not "approximately".
  const cases: Array<[number, number, number]> = [[8, 1, 6], [16, 3, 5], [13, 4, 7], [12, 2, 5], [14, 1, 5]];
  for (const [rows, risk, n] of cases) {
    const dist = payoutValueDistribution(cfg, rows, risk);
    const { mu } = payoutMuSd(cfg, rows, risk);
    for (const frac of [0.7, 0.9, 1.0, 1.15]) {
      const threshold = n * mu * frac;
      it(`rows ${rows} risk ${risk}, n=${n}, threshold ${frac}x mean`, () => {
        const brute = bruteForceLeftTail(dist, n, threshold);
        const dp = exactLeftTailProbability(dist, n, threshold).probability;
        assert.ok(
          Math.abs(dp - brute) <= 1e-12 * Math.max(1, brute),
          `DP ${dp} != brute force ${brute}`,
        );
      });
    }
  }
});

describe('calibration: WTF left tail at the production window, two algorithms', () => {
  // The WTF payout support is {0, 235, 1000}, so a closed-form multinomial sum is
  // available at the full n = 5,000 — a completely different computation from the
  // lattice convolution. This is the only config where an exact non-DP answer exists
  // at production scale, and it is the strongest single anchor in the suite.
  const rows = cfg.wtf_mode.rows;
  const risk = cfg.wtf_mode.riskLevel;
  const n = 5_000;
  const dist = payoutValueDistribution(cfg, rows, risk);
  const { mu, sd } = payoutMuSd(cfg, rows, risk);
  const threshold = leftTailSumThreshold(mu, sd, n, Z_LEFT_TAIL);

  it('the two algorithms agree to better than 1e-9 relative', () => {
    const dp = exactLeftTailProbability(dist, n, threshold).probability;
    const closed = enumerationLeftTailProbability(dist, n, threshold);
    assert.ok(closed !== null, 'closed-form path should be available for a 3-value support');
    const rel = Math.abs(dp - (closed as number)) / (closed as number);
    assert.ok(rel < 1e-9, `relative difference ${rel} between DP ${dp} and closed form ${closed}`);
  });

  it('the WTF left tail is far below the naive 0.05 — this is the whole point', () => {
    const dp = exactLeftTailProbability(dist, n, threshold).probability;
    assert.ok(dp > 0.02 && dp < 0.03, `WTF left tail ${dp} outside the expected 2-3% band`);
  });
});

describe('calibration: Monte-Carlo cross-check at the production window', () => {
  // The brute-force test above proves the DP machinery exact, but only at n = 5-7.
  // These run it at the production n = 5,000 by direct simulation.
  //
  // Tolerance is 5 standard errors of the MC estimate itself (false-failure probability
  // ~6e-7 per case). Note the window is intrinsically wide where the probability is
  // small: on 16r/3, p ~ 0.0019, so 5 SE is about a third of p even at 100k replicates.
  // That is a magnitude check, not a precision one — the precision anchor for the DP is
  // the exact brute-force agreement, and for the production n it is the WTF closed form.
  // 8r/1 has the largest left tail of any config, which makes it the tightest available
  // relative check at a cost of a few seconds.
  const SCALE = 2 ** 32;

  /**
   * Uniforms from crypto entropy, buffered. `crypto.randomInt` per draw would be
   * hundreds of millions of calls here; `randomFillSync` into a Uint32Array gives the
   * same source in bulk. Fresh entropy every run — no pinned seed.
   */
  function makeUniformStream(): () => number {
    const buf = new Uint32Array(1 << 16);
    let i = buf.length;
    return () => {
      if (i >= buf.length) { randomFillSync(buf); i = 0; }
      return buf[i++] / SCALE;
    };
  }

  function monteCarloLeftTail(rows: number, risk: number, n: number, replicates: number): { pHat: number; se: number; dp: number } {
    const dist = payoutValueDistribution(cfg, rows, risk);
    const { mu, sd } = payoutMuSd(cfg, rows, risk);
    const threshold = leftTailSumThreshold(mu, sd, n, Z_LEFT_TAIL);
    const dp = exactLeftTailProbability(dist, n, threshold).probability;

    // Fresh entropy per run (never a pinned seed): the check must not be able to pass
    // only for one lucky stream.
    const cum: number[] = [];
    const vals: number[] = [];
    let acc = 0;
    for (const d of dist) { acc += d.prob; cum.push(acc); vals.push(d.value); }
    cum[cum.length - 1] = 1;

    const nextU = makeUniformStream();
    let hits = 0;
    for (let r = 0; r < replicates; r++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const u = nextU();
        let j = 0;
        while (u > cum[j]) j++;
        sum += vals[j];
      }
      if (sum < threshold) hits++;
    }
    const pHat = hits / replicates;
    return { pHat, se: Math.sqrt(Math.max(pHat, 1 / replicates) * (1 - pHat) / replicates), dp };
  }

  for (const [rows, risk, replicates] of [[8, 1, 150_000], [16, 3, 100_000]] as Array<[number, number, number]>) {
    it(`rows ${rows} risk ${risk}: DP within 5 SE of ${replicates.toLocaleString()} simulated 5,000-nonce windows`, function () {
      this.timeout(600_000);
      const { pHat, se, dp } = monteCarloLeftTail(rows, risk, 5_000, replicates);
      assert.ok(
        Math.abs(dp - pHat) <= 5 * se,
        `exact ${dp} vs Monte-Carlo ${pHat} +/- ${se} (${Math.abs(dp - pHat) / se} SE)`,
      );
    });
  }
});

describe('calibration: Poisson-binomial aggregation', () => {
  it('pmf is a distribution and reproduces the binomial when all p are equal', () => {
    const ps = new Array(20).fill(0.05);
    const pmf = poissonBinomialPmf(ps);
    const total = [...pmf].reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(total - 1) < 1e-12, `pmf sums to ${total}`);
    // Binom(20, 0.05): P(X = 0) = 0.95^20
    assert.ok(Math.abs(pmf[0] - Math.pow(0.95, 20)) < 1e-12);
    const mean = [...pmf].reduce((s, v, k) => s + k * v, 0);
    assert.ok(Math.abs(mean - 1) < 1e-12, `mean ${mean}`);
  });

  it('survival is monotone and bounded', () => {
    const ps = [0.1, 0.2, 0.3, 0.4];
    assert.ok(Math.abs(poissonBinomialSurvival(ps, 0) - 1) < 1e-12);
    assert.ok(poissonBinomialSurvival(ps, 1) > poissonBinomialSurvival(ps, 2));
    assert.ok(poissonBinomialSurvival(ps, 5) === 0);
  });
});

describe('calibration: the guard can fail (known-bad values)', () => {
  // A 1,000-nonce window rather than the production 5,000: the properties under test
  // (the calibrated null is materially tighter than the naive one, and the survival gate
  // rejects an inflated count) hold at any window length, and the production-scale
  // numbers are already anchored by the tests above. This keeps `npx mocha` — which the
  // mutation battery runs once per mutation — in seconds rather than minutes.
  const epochs = allConfigs(cfg).map((c, i) => ({ epoch: i, rows: c.rows, riskLevel: c.riskLevel }));
  let cal: ReturnType<typeof calibrateLeftTailCount>;
  before(function () {
    this.timeout(600_000);
    cal = calibrateLeftTailCount(cfg, epochs, 1_000, Z_LEFT_TAIL);
  });

  it('the calibrated expectation is materially below the naive 0.05·n it replaced', () => {
    assert.ok(
      cal.expectedZEarlyBelow1645Calibrated < 0.9 * cal.expectedZEarlyBelow1645Naive,
      `calibrated ${cal.expectedZEarlyBelow1645Calibrated} is not below naive ${cal.expectedZEarlyBelow1645Naive}`,
    );
  });

  it('an impossible count has survival 0 — a fabricated high count cannot pass the gate', () => {
    const ps = cal.perEpoch.map(e => e.leftTailProbability);
    assert.equal(poissonBinomialSurvival(ps, epochs.length + 1), 0);
    // A count far into the tail must be well under the 0.01 gate.
    assert.ok(poissonBinomialSurvival(ps, Math.ceil(cal.expectedZEarlyBelow1645Calibrated) + 12) < 0.01);
  });

  it('a payout value off the 0.1 lattice is rejected, not silently rounded', () => {
    const bad: ValueProb[] = [{ value: 0.25, prob: 0.5 }, { value: 1.75, prob: 0.5 }];
    assert.throws(() => exactLeftTailProbability(bad, 10, 5), /not a multiple of/);
  });

  it('a threshold below the minimum attainable sum gives probability 0', () => {
    const dist = payoutValueDistribution(cfg, 16, 3);
    // Minimum payout is 0.2, so no 100-drop window can total less than 20.
    assert.equal(exactLeftTailProbability(dist, 100, 19.9).probability, 0);
  });
});
