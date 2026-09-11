/**
 * Net present value of a cash flow vector.
 *
 * `flows[0]` sits at t=0 and is therefore undiscounted. `flows[t]` is
 * discounted by `(1 + rate) ** t`. The rate must match the period of the
 * vector: a monthly vector needs a monthly rate.
 */
export function npv(flows: readonly number[], periodicRate: number): number {
  let total = 0;
  for (let t = 0; t < flows.length; t++) {
    total += (flows[t] ?? 0) / Math.pow(1 + periodicRate, t);
  }
  return total;
}

/**
 * Discount factor applied to a flow at period `t`.
 *
 * Exposed so a caller can rebuild the arithmetic of any row in a schedule
 * without re-deriving the convention.
 */
export function discountFactor(periodicRate: number, t: number): number {
  return 1 / Math.pow(1 + periodicRate, t);
}
