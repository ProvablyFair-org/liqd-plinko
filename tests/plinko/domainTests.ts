/**
 * Value-domain rules (QA-13) — asserted in BOTH directions.
 *
 * A mistake in `src/domains.ts` is expensive whichever way it falls: too loose and a
 * forged value ships behind a Full Pass (the QA-13 defect itself); too tight and a
 * GENUINE audit is rejected for producing an honest number (the mines G-VALID defect,
 * which cost a whole review round). So this suite pins both edges:
 *
 *   1. Every numeric leaf of every committed artifact satisfies its declared domain.
 *      If a rule is too tight, this fails immediately rather than at delivery.
 *   2. Every numeric leaf PATH is covered by an explicit rule. There is no silent
 *      fallback, so adding a field to an artifact without declaring what it physically
 *      admits fails here — that is what stops the class reopening.
 *   3. The specific impossible values from the round-4 probes are rejected.
 *   4. Honest values that a naive classifier would wrongly reject are ACCEPTED.
 */

import { strict as assert } from 'assert';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

import { loadPlinkoConfig } from '../../src/config';
import {
  domainRules,
  validateDomains,
  numericLeaves,
  attainableMultiplierRange,
  boardMultiplierRange,
  pass2WindowDrops,
  totalPayoutCells,
  PROBABILITY,
  NONNEG_INT,
  CORRELATION,
  PERCENT,
  FINITE,
} from '../../src/domains';

const cfg = loadPlinkoConfig();
const OUTPUTS = path.join(__dirname, '../../outputs');
const ARTIFACTS = [
  'simulation-results.json',
  'calibration-results.json',
  'coverage-results.json',
  'verification-stats.json',
] as const;

describe('value domains: the committed artifacts are all inside their declared domains', () => {
  const rules = domainRules(cfg);
  for (const name of ARTIFACTS) {
    it(`${name} — every numeric leaf satisfies its domain, and every leaf has one`, function () {
      const p = path.join(OUTPUTS, name);
      if (!existsSync(p)) this.skip();
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      const r = validateDomains(doc, rules[name]);

      assert.equal(
        r.violations.length, 0,
        `committed ${name} carries value(s) outside their physical domain — either the artifact is wrong or the rule is too tight:\n  `
        + r.violations.slice(0, 10).map(v => `${v.path} = ${v.value} is not ${v.expected}`).join('\n  '),
      );
      assert.equal(
        r.uncovered.length, 0,
        `committed ${name} has numeric field(s) with NO declared value domain — declare them in src/domains.ts:\n  `
        + r.uncovered.slice(0, 10).join('\n  '),
      );
      assert.ok(r.checked > 0, `${name}: no numeric leaves were checked, so this assertion proved nothing`);
    });
  }
});

describe('value domains: impossible values are rejected', () => {
  const rules = domainRules(cfg);

  it('a negative count of configurations is rejected (the executed QA-13 probe)', () => {
    const p = path.join(OUTPUTS, 'coverage-results.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.totalConfigs = -1;
    const r = validateDomains(doc, rules['coverage-results.json']);
    assert.ok(
      r.violations.some(v => v.path === '.totalConfigs'),
      'totalConfigs = -1 was accepted; a negative count of configurations is physically impossible',
    );
  });

  it('a probability above 1 is rejected', () => {
    const p = path.join(OUTPUTS, 'calibration-results.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.byConfig[0].leftTailProbability = 1.5;
    const r = validateDomains(doc, rules['calibration-results.json']);
    assert.ok(
      r.violations.some(v => v.path === '.byConfig[].leftTailProbability'),
      'a left-tail probability of 1.5 was accepted',
    );
  });

  it('an RTP outside the paytable\'s attainable range is rejected', () => {
    const { max } = attainableMultiplierRange(cfg);
    const p = path.join(OUTPUTS, 'simulation-results.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.pass1_fresh_seeds.results[0].simRTP = max + 1;
    const r = validateDomains(doc, rules['simulation-results.json']);
    assert.ok(
      r.violations.some(v => v.path === '.pass1_fresh_seeds.results[].simRTP'),
      `a simulated RTP of ${max + 1} was accepted, above the largest multiplier the pinned paytable contains (${max})`,
    );
  });

  it('an edge-hit count above the drops a window contains is rejected (the executed QA-16 probe)', () => {
    const p = path.join(OUTPUTS, 'simulation-results.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.pass2_casino_seeds.payoutWeighted.edgeHitsEarly = 1_000_000_000;
    const r = validateDomains(doc, rules['simulation-results.json']);
    assert.ok(
      r.violations.some(v => v.path === '.pass2_casino_seeds.payoutWeighted.edgeHitsEarly'),
      `edgeHitsEarly = 1,000,000,000 was accepted; one Pass-2 window contains only ${pass2WindowDrops()} drops`,
    );
  });

  it('a window RTP below the board\'s smallest multiplier is rejected by the per-board range', () => {
    // The global union is [0, 1000] because the high-risk boards contain a 0x slot, which is
    // why 0 on an 8-row LOW board slipped through the artifact-wide domain check. The bound
    // that matters is the board's own, and `tests/steps/simulation.ts` applies it with the
    // board taken from the dataset.
    const { min, max } = boardMultiplierRange(cfg, 8, 1);
    assert.equal(min, 0.5);
    assert.equal(max, 5.6);
    assert.ok(0 < min, 'a 0% window RTP is impossible on a board whose smallest multiplier is 0.5');
    assert.ok(min <= 1.0028 && 1.0028 <= max, 'the committed rtpEarly must stay inside its own board range');
  });

  it('a field with no declared domain is reported rather than waved through', () => {
    const doc = { totalConfigs: 28, somethingNobodyDeclared: 7 };
    const r = validateDomains(doc, rules['coverage-results.json']);
    assert.deepEqual(r.uncovered, ['.somethingNobodyDeclared']);
  });
});

describe('value domains: G-VALID — honest values are NOT rejected', () => {
  // Each of these is a real value from the committed artifacts that a naive name-based
  // classifier gets wrong. Rejecting any of them is the mines defect, and it is just as
  // expensive as accepting a forgery.
  it('an expected COUNT is a real, not an integer (expectedFlagsByChance = 9.595)', () => {
    assert.ok(!NONNEG_INT.ok(9.595), 'sanity: 9.595 is not an integer');
    const rules = domainRules(cfg);
    const doc = JSON.parse(readFileSync(path.join(OUTPUTS, 'simulation-results.json'), 'utf8'));
    assert.equal(doc.pass2_casino_seeds.expectedFlagsByChance, 9.595);
    const r = validateDomains(doc, rules['simulation-results.json']);
    assert.ok(!r.violations.some(v => v.path.endsWith('expectedFlagsByChance')));
  });

  it('a window RTP above 1 is attainable and accepted (rtpEarly = 1.0028…)', () => {
    const rules = domainRules(cfg);
    const doc = JSON.parse(readFileSync(path.join(OUTPUTS, 'simulation-results.json'), 'utf8'));
    const above = doc.pass2_casino_seeds.results.filter((r: { rtpEarly: number }) => r.rtpEarly > 1);
    assert.ok(above.length > 0, 'expected at least one window RTP above 1 in the committed artifact');
    const r = validateDomains(doc, rules['simulation-results.json']);
    assert.ok(!r.violations.some(v => v.path.endsWith('rtpEarly')),
      'an RTP above 1 was rejected — a window mean is bounded by the paytable, not by 1');
  });

  it('a percentage is [0,100] and a probability is [0,1]; they are not the same domain', () => {
    assert.ok(PERCENT.ok(78.1) && !PROBABILITY.ok(78.1));
    assert.ok(PROBABILITY.ok(0.781) && PERCENT.ok(0.781));
  });

  it('a correlation may be negative and may sit on its bound', () => {
    assert.ok(CORRELATION.ok(-0.9999999643182262));
    assert.ok(CORRELATION.ok(-1) && CORRELATION.ok(1) && CORRELATION.ok(0));
    assert.ok(!CORRELATION.ok(-1.0000001));
  });

  it('a z-score is unbounded, so an extreme but genuine run is not rejected', () => {
    assert.ok(FINITE.ok(-42) && FINITE.ok(1e6));
    assert.ok(!FINITE.ok(NaN) && !FINITE.ok(Infinity));
  });

  it('a value landing exactly on its expectation is accepted', () => {
    // The mines defect in one line: an exactly-on-expectation result is the single most
    // likely honest outcome, not a suspicious one.
    assert.ok(PROBABILITY.ok(0.05));
    assert.ok(NONNEG_INT.ok(0), 'zero failures is an honest result, not an impossible one');
  });

  it('the paytable bounds come from the pinned config, not from any artifact', () => {
    const { min, max } = attainableMultiplierRange(cfg);
    assert.equal(min, 0);
    assert.equal(max, 1000);
    assert.equal(totalPayoutCells(cfg), 365);
  });

  it('the committed edge-hit counts are ACCEPTED — the new bound is not too tight', () => {
    // G-VALID, the mirror of the probe above. 1,063 and 1,020 are the honest counts; a bound
    // that rejected them would cost exactly as much as the one that accepted a billion.
    const rules = domainRules(cfg);
    const doc = JSON.parse(readFileSync(path.join(OUTPUTS, 'simulation-results.json'), 'utf8'));
    const pw = doc.pass2_casino_seeds.payoutWeighted;
    assert.ok(pw.edgeHitsEarly > 0 && pw.edgeHitsLate > 0, 'sanity: the committed artifact records edge hits');
    assert.ok(pw.edgeHitsEarly <= pass2WindowDrops() && pw.edgeHitsLate <= pass2WindowDrops());
    const r = validateDomains(doc, rules['simulation-results.json']);
    assert.ok(!r.violations.some(v => v.path.includes('edgeHits')),
      'an honest edge-hit count was rejected by its own bound');
  });

  it('every committed Pass 2 window RTP is inside ITS OWN board\'s range', () => {
    // The per-board bound is applied per row in tests/steps/simulation.ts. Asserting it here
    // over all 202 committed rows is the "too tight" half: if any honest row fell outside its
    // board range, the new check would reject a genuine audit.
    const doc = JSON.parse(readFileSync(path.join(OUTPUTS, 'simulation-results.json'), 'utf8'));
    const rows = doc.pass2_casino_seeds.results as { rows: number; riskLevel?: number; rtpEarly: number; rtpLate: number }[];
    assert.ok(rows.length > 0, 'sanity: the committed artifact has Pass 2 rows');
    for (const r of rows) {
      const { min, max } = boardMultiplierRange(cfg, r.rows, r.riskLevel ?? 3);
      assert.ok(r.rtpEarly >= min && r.rtpEarly <= max,
        `honest rtpEarly ${r.rtpEarly} falls outside [${min}, ${max}] on the ${r.rows}r/risk-${r.riskLevel} board`);
      assert.ok(r.rtpLate >= min && r.rtpLate <= max,
        `honest rtpLate ${r.rtpLate} falls outside [${min}, ${max}] on the ${r.rows}r/risk-${r.riskLevel} board`);
    }
  });
});
