/**
 * First period at which a running total turns non-negative.
 *
 * `cumulative[0]` is skipped: period 0 is the investment, and a project that is
 * already whole before it starts has not paid anything back. Returns `null`
 * when the total never crosses, which callers should render as "not within the
 * term" rather than as a large sentinel number.
 */
export function paybackPeriod(cumulative: readonly number[]): number | null {
  for (let t = 1; t < cumulative.length; t++) {
    if ((cumulative[t] ?? -Infinity) >= 0) return t;
  }
  return null;
}

/**
 * Payback with linear interpolation inside the crossing period.
 *
 * Useful when a monthly schedule is reported in years and a whole-month answer
 * is too coarse. Returns a fractional period.
 */
export function fractionalPaybackPeriod(cumulative: readonly number[]): number | null {
  for (let t = 1; t < cumulative.length; t++) {
    const current = cumulative[t] ?? -Infinity;
    if (current < 0) continue;

    const previous = cumulative[t - 1] ?? 0;
    const gained = current - previous;
    if (gained <= 0) return t;
    return t - 1 + -previous / gained;
  }
  return null;
}
