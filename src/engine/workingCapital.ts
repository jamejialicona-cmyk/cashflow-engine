import type { WorkingCapitalResult, WorkingCapitalTerms } from "../model/types.js";

/** Days used to convert a monthly amount into a daily one. */
const DAYS_PER_MONTH = 30;

/**
 * Cash tied up by payment terms.
 *
 * Receivables are cash already earned but not collected. Payables are cash owed
 * but not yet paid, so they fund the operation and carry a minus. Inventory is
 * cash sitting on a shelf.
 *
 * A negative net figure is not an error: a business collecting faster than it
 * pays runs on its suppliers' money and releases cash at signing.
 */
export function computeWorkingCapital(
  monthlyRevenue: number,
  terms: WorkingCapitalTerms | undefined,
): WorkingCapitalResult {
  if (!terms) {
    return { receivables: 0, payables: 0, inventory: 0, net: 0 };
  }

  const receivables = monthlyRevenue * (terms.receivableDays / DAYS_PER_MONTH);
  const payables = terms.payableBaseMonthly * (terms.payableDays / DAYS_PER_MONTH);
  const inventory = terms.inventory;

  return {
    receivables,
    payables,
    inventory,
    net: receivables - payables + inventory,
  };
}
