import { nominalAnnualToMonthly } from "./rates.js";

/**
 * Level monthly payment that amortizes `principal` over `termMonths`.
 *
 * Matches the spreadsheet `PMT(rate/12, nper, -pv)` convention, including the
 * zero-rate case, so an output can be checked against Excel cell by cell. The
 * sign is positive: this is an amount paid, and the schedule decides where the
 * minus goes.
 */
export function pmt(nominalAnnualRate: number, termMonths: number, principal: number): number {
  if (principal === 0) return 0;
  if (termMonths <= 0) return principal;

  const monthlyRate = nominalAnnualToMonthly(nominalAnnualRate);
  if (monthlyRate === 0) return principal / termMonths;

  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
}

/** Total paid over the life of the loan. */
export function totalPayments(
  nominalAnnualRate: number,
  termMonths: number,
  principal: number,
): number {
  if (termMonths <= 0) return principal;
  return pmt(nominalAnnualRate, termMonths, principal) * termMonths;
}

/** Financing cost: everything paid above the principal. Zero for interest-free terms. */
export function financingCost(
  nominalAnnualRate: number,
  termMonths: number,
  principal: number,
): number {
  return Math.max(0, totalPayments(nominalAnnualRate, termMonths, principal) - principal);
}
