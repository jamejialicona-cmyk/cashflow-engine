import type { BreakevenResult, ContractModel } from "../model/types.js";

/**
 * Volume at which the contract stops losing money, in base-year terms.
 *
 * The arithmetic starts from total monthly cost written as a function of volume
 * `u`, where `u0` is planned volume:
 *
 * ```
 * cost(u) = (fixed + maintenance + variable * u / u0) * (1 + contingency)
 * ```
 *
 * Contingency multiplies both sides, so it belongs inside the contribution
 * margin rather than being bolted onto fixed cost. Setting revenue equal to
 * cost and solving for `u` gives:
 *
 * ```
 * contribution = price - unitVariableCost * (1 + contingency)
 * fixedToCover = (fixed + maintenance) * (1 + contingency) - fixedRevenue
 * breakevenUnits = fixedToCover / contribution
 * ```
 *
 * Fixed revenue offsets fixed cost, so a contract whose flat fee already covers
 * its fixed base breaks even at zero units rather than at a negative volume.
 *
 * Escalation is deliberately excluded: break-even is a statement about the base
 * year, and indexing both sides would make it a different number every year
 * without telling the reader anything new.
 *
 * Returns `null` when the model has no metered volume to solve for.
 */
export function computeBreakeven(
  model: ContractModel,
  volumeFactor = 1,
): BreakevenResult | null {
  const { revenue, costs } = model;

  const totalUnits = revenue.streams.reduce(
    (sum, s) => sum + s.unitsPerMonth * volumeFactor,
    0,
  );
  if (totalUnits <= 0) return null;

  const grossVariableRevenue = revenue.streams.reduce(
    (sum, s) => sum + s.unitsPerMonth * volumeFactor * s.pricePerUnit,
    0,
  );
  const averagePrice = grossVariableRevenue / totalUnits;

  const contingencyRate = costs.contingencyRate ?? 0;
  const contingencyMultiplier = 1 + contingencyRate;

  const variableCostPerUnit = (costs.variableMonthly * volumeFactor) / totalUnits;
  const contributionPerUnit = averagePrice - variableCostPerUnit * contingencyMultiplier;

  const maintenanceMonthly = baseYearMaintenance(model);
  const fixedRevenue = revenue.fixedMonthly + (revenue.adjustmentsMonthly ?? 0);
  const fixedToCover =
    (costs.fixedMonthly + maintenanceMonthly) * contingencyMultiplier - fixedRevenue;

  if (contributionPerUnit <= 0) {
    return {
      units: Infinity,
      revenue: Infinity,
      marginOfSafetyPct: 0,
      averagePrice,
      variableCostPerUnit,
      contributionPerUnit,
    };
  }

  const units = Math.max(0, fixedToCover / contributionPerUnit);
  const breakevenRevenue = fixedRevenue + units * averagePrice;
  const marginOfSafetyPct =
    units < totalUnits ? ((totalUnits - units) / totalUnits) * 100 : 0;

  return {
    units,
    revenue: breakevenRevenue,
    marginOfSafetyPct,
    averagePrice,
    variableCostPerUnit,
    contributionPerUnit,
  };
}

/** Monthly maintenance charge for contract year 0. */
function baseYearMaintenance(model: ContractModel): number {
  const maintenance = model.costs.maintenance;
  if (!maintenance || maintenance.annualRateByYear.length === 0) return 0;
  return (maintenance.basis * (maintenance.annualRateByYear[0] ?? 0)) / 12;
}
