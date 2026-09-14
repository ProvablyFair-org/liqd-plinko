import { strict as assert } from 'node:assert';
import { loadPlinkoConfig, allConfigs, theoreticalRTP, binomP } from '../../src/config';

/**
 * Published-figure drift guards.
 *
 * The report publishes the per-config RTP range, mean, and WTF figures to 4–5
 * decimal places, but until 2026-08-23 the only gate around them was Step 10's
 * policy band (|RTP − 0.99| < 0.01) — a tolerance ~6× wider than the largest real
 * deviation and 2–3 orders of magnitude coarser than the published precision, so a
 * perturbed table or model could move every published figure without failing
 * anything. These pins hold each published figure to 1e-12 (each is the exact
 * rational Σ table[k]·C(rows,k)·2^-rows; note these are NOT all dyadic — e.g.
 * 633/640 and 5077/5120 carry a factor of 5 in the denominator — so they are not
 * exactly float64-representable, which is why the gate is a 1e-12 tolerance rather
 * than exact equality; the mean accumulates 28 of them). Produced by a pinned run of this repo's own
 * config pipeline on 2026-08-23; Step 10's in-step exhaustive path enumeration
 * independently anchors the model these pins freeze.
 *
 * The mean pin doubles as provenance: it equals the simulation artifact's
 * `pass1.meanTheoreticalRTP` (0.9901524135044644), proving the published mean is
 * the equal-weighted mean over all 28 configs.
 */
const TOL = 1e-12;

describe('plinko: published RTP figures pinned at full precision', () => {
  const cfg = loadPlinkoConfig();
  const rtps = allConfigs(cfg).map(c => theoreticalRTP(cfg, c.rows, c.riskLevel));

  it('min per-config RTP = 0.9890625 (98.90625%)', () => {
    assert.ok(Math.abs(Math.min(...rtps) - 0.9890625) < TOL);
  });
  it('max per-config RTP = 0.9916015625 (99.16016%)', () => {
    assert.ok(Math.abs(Math.max(...rtps) - 0.9916015625) < TOL);
  });
  it('equal-weighted mean over 28 configs = 0.990152413504464 (99.0152%)', () => {
    assert.equal(rtps.length, 28, 'config count changed — the published mean is over 28');
    const mean = rtps.reduce((a, b) => a + b, 0) / rtps.length;
    assert.ok(Math.abs(mean - 0.990152413504464) < TOL);
  });
  it('WTF RTP = 0.989990234375 (98.9990%)', () => {
    const wtf = theoreticalRTP(cfg, cfg.wtf_mode.rows, cfg.wtf_mode.riskLevel);
    assert.ok(Math.abs(wtf - 0.989990234375) < TOL);
  });
  it('WTF zero-payout probability = 0.99658203125 (99.6582%)', () => {
    let pPay = 0;
    for (let k = 0; k <= cfg.wtf_mode.rows; k++) {
      if (cfg.wtf_mode.odds[k] > 0) pPay += binomP(cfg.wtf_mode.rows, k);
    }
    assert.ok(Math.abs((1 - pPay) - 0.99658203125) < TOL);
  });
});
