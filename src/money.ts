/**
 * MONEY, in exact integer settlement units. One definition, every money check.
 *
 * Money is compared as integers, never within a tolerance. `betAmount` and
 * `winningAmount` are 8-decimal strings, so every legal amount lands exactly on a
 * 1e-8 grid and two amounts are either equal or they are not.
 *
 * A float tolerance is the wrong SHAPE of check here, not merely a loose one: it
 * rejects an amount that cannot exist on the grid, and accepts a wrong amount that
 * can. On a 1 USDC stake an underpayment of 99 settlement units is a real shortfall
 * and measures 9.9e-7, which any bound at 1e-6 admits. The framework floor is exact,
 * or ≤ 1e-8.
 *
 * Two copies of a rule are two rules, so the rule lives here and Step 8 imports it. Step 18 (tests/steps/
 * standardization.ts) does not: it converts the Phase C amounts to 1e-8 units with its own Math.round.
 */

/** 8 decimals — the captured game-accounting precision. `betAmount` and `winningAmount` are 8-dp strings. */
export const GRID = 1e8;

/**
 * Tolerance for snapping a JSON double back onto the grid, IN GRID UNITS — not a
 * tolerance on money. Measured by Step 8 on every run over the committed dataset: 0 amounts off
 * the grid and 0 units of deviation between `betAmount × multiplier` and
 * `winningAmount`. This bound exists only so a double that reads back as
 * 4.6000000000000005 still lands on 460,000,000 units; it is 1/1000 of the smallest
 * error that can exist, so representation noise and a real money error cannot be
 * confused for one another.
 */
export const GRID_TOL = 1e-3;

/** A recorded money amount in exact integer settlement units, or null if it is OFF the 1e-8 grid. */
export function unitsOf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  const u = x * GRID;
  const r = Math.round(u);
  return Math.abs(u - r) > GRID_TOL ? null : r;
}

/** Grid units rendered back as a decimal amount, for failure messages. */
export const asMoney = (units: number): string => (units / GRID).toFixed(8);
