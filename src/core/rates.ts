/**
 * Rate conversions.
 *
 * Every rate crossing this library's public surface is an *effective annual*
 * rate. Internally every schedule is monthly, so conversion happens in exactly
 * one place: here.
 */

/**
 * Effective annual rate to effective monthly rate, compounded.
 *
 * `(1 + annual) ** (1/12) - 1`, not `annual / 12`. The naive division
 * understates the monthly rate and quietly inflates NPV.
 */
export function annualToMonthlyEffective(annualRate: number): number {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

/** Effective monthly rate to effective annual rate, compounded. */
export function monthlyToAnnualEffective(monthlyRate: number): number {
  return Math.pow(1 + monthlyRate, 12) - 1;
}

/**
 * Nominal annual rate to periodic rate by simple division.
 *
 * This is the convention amortization schedules use: a "12% APR" loan charges
 * 1% per month. Use this for `pmt`, never for discounting.
 */
export function nominalAnnualToMonthly(annualRate: number): number {
  return annualRate / 12;
}
