import type { ContractModel } from "../src/model/types.js";

/**
 * A deliberately round contract, so every expected value in the tests can be
 * derived by hand rather than copied from a previous run.
 *
 * Base month: revenue 10,000 fixed + 400 units x 10 = 14,000.
 * Base cost: 3,000 fixed + 2,000 variable = 5,000. EBITDA 9,000.
 */
export function baseModel(overrides: Partial<ContractModel> = {}): ContractModel {
  return {
    termMonths: 24,
    discountRateAnnual: 0.12,
    revenue: {
      fixedMonthly: 10_000,
      streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
    },
    costs: {
      fixedMonthly: 3_000,
      variableMonthly: 2_000,
    },
    ...overrides,
  };
}
