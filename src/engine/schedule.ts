import { annualToMonthlyEffective } from "../core/rates.js";
import { pmt } from "../core/pmt.js";
import { discountFactor } from "../core/npv.js";
import { computeWorkingCapital } from "./workingCapital.js";
import type { ContractModel, MonthlyFlow } from "../model/types.js";

/**
 * Levers a scenario can pull without rewriting the model.
 *
 * Kept as a small, closed set on purpose. A scenario that needs anything else
 * is a different model, and saying so is clearer than growing a options bag
 * nobody can reason about.
 */
export interface ScheduleOverrides {
  /** Scales metered volume and the variable cost that follows it. Default 1. */
  volumeFactor?: number;
  /** Scales unit prices without touching volume. Default 1. */
  priceFactor?: number;
  /** Scales the operating cost base. Default 1. */
  costFactor?: number;
  /** Replaces the model's annual revenue escalation. */
  revenueEscalation?: number;
  /** Replaces the model's annual cost escalation. */
  costEscalation?: number;
}

/** Everything the schedule needed that the metrics layer also wants. */
export interface ScheduleContext {
  schedule: MonthlyFlow[];
  monthlyDiscountRate: number;
  monthlyInstallment: number;
  downPayment: number;
  installmentMonths: number;
  netWorkingCapital: number;
  baseMonthlyRevenue: number;
}

/**
 * Expands a contract into a month-by-month cash flow schedule.
 *
 * Month 0 carries the capital commitment and nothing else: no revenue, no
 * operating cost. Months 1 through `termMonths` carry operations. The final
 * month additionally releases working capital and books any residual value.
 *
 * The function is pure. Same model in, same schedule out, no clock, no I/O, no
 * randomness. That is what makes the sensitivity runner cheap and the tests
 * exact.
 */
export function buildSchedule(
  model: ContractModel,
  overrides: ScheduleOverrides = {},
): ScheduleContext {
  const volumeFactor = overrides.volumeFactor ?? 1;
  const priceFactor = overrides.priceFactor ?? 1;
  const costFactor = overrides.costFactor ?? 1;
  const revenueEscalation = overrides.revenueEscalation ?? model.revenue.annualEscalation ?? 0;
  const costEscalation = overrides.costEscalation ?? model.costs.annualEscalation ?? 0;
  const contingencyRate = model.costs.contingencyRate ?? 0;

  const monthlyDiscountRate = annualToMonthlyEffective(model.discountRateAnnual);

  // Base amounts, before any escalation. Month 1 pays exactly these.
  const baseFixedRevenue =
    model.revenue.fixedMonthly + (model.revenue.adjustmentsMonthly ?? 0);
  const baseVariableRevenue = model.revenue.streams.reduce(
    (sum, s) => sum + s.unitsPerMonth * volumeFactor * s.pricePerUnit * priceFactor,
    0,
  );
  const baseMonthlyRevenue = baseFixedRevenue + baseVariableRevenue;
  const baseOperatingCost =
    (model.costs.fixedMonthly + model.costs.variableMonthly * volumeFactor) * costFactor;

  // Financing.
  const asset = model.financedAsset;
  const financedPrincipal = asset ? Math.max(0, asset.principal - asset.downPayment) : 0;
  const installmentMonths = asset?.termMonths ?? 0;
  const monthlyInstallment =
    asset && installmentMonths > 0
      ? pmt(asset.annualRate, installmentMonths, financedPrincipal)
      : 0;
  const downPayment = asset?.downPayment ?? 0;
  const residualValue = asset?.residualValue ?? 0;

  // Working capital is sized on base revenue and held flat. Indexing it to
  // escalated revenue would imply the customer's payment terms tighten with
  // inflation, which no contract says.
  const workingCapital = computeWorkingCapital(baseMonthlyRevenue, model.workingCapital);

  const investmentsByMonth = groupInvestmentsByMonth(model);

  const schedule: MonthlyFlow[] = [];
  let cumulativeCashFlow = 0;
  let cumulativeNpv = 0;

  for (let month = 0; month <= model.termMonths; month++) {
    const isOperating = month > 0;
    const isFinalMonth = month === model.termMonths;
    const year = isOperating ? Math.floor((month - 1) / 12) : 0;

    const revenueFactor = isOperating ? Math.pow(1 + revenueEscalation, year) : 0;
    const costEscalationFactor = isOperating ? Math.pow(1 + costEscalation, year) : 0;

    const fixedRevenue = baseFixedRevenue * revenueFactor;
    const variableRevenue = baseVariableRevenue * revenueFactor;
    const totalRevenue = fixedRevenue + variableRevenue;

    const operatingCost = baseOperatingCost * costEscalationFactor;
    const maintenanceCost = isOperating ? monthlyMaintenance(model, year) : 0;
    const contingencyCost = (operatingCost + maintenanceCost) * contingencyRate;
    const totalCost = operatingCost + maintenanceCost + contingencyCost;

    const ebitda = totalRevenue - totalCost;

    const installment = isOperating && month <= installmentMonths ? monthlyInstallment : 0;
    const scheduledInvestment = investmentsByMonth.get(month) ?? 0;
    const investment = month === 0 ? scheduledInvestment + downPayment : scheduledInvestment;

    // Working capital is consumed at signing and released at the end.
    let workingCapitalDelta = 0;
    if (month === 0) workingCapitalDelta = -workingCapital.net;
    else if (isFinalMonth) workingCapitalDelta = workingCapital.net;

    const residual = isFinalMonth ? residualValue : 0;

    const netCashFlow =
      ebitda - installment - investment + workingCapitalDelta + residual;

    cumulativeCashFlow += netCashFlow;
    const factor = discountFactor(monthlyDiscountRate, month);
    const discountedCashFlow = netCashFlow * factor;
    cumulativeNpv += discountedCashFlow;

    schedule.push({
      month,
      year,
      fixedRevenue,
      variableRevenue,
      totalRevenue,
      operatingCost,
      maintenanceCost,
      contingencyCost,
      totalCost,
      ebitda,
      installment,
      investment,
      workingCapitalDelta,
      residualValue: residual,
      netCashFlow,
      cumulativeCashFlow,
      discountFactor: factor,
      discountedCashFlow,
      cumulativeNpv,
    });
  }

  return {
    schedule,
    monthlyDiscountRate,
    monthlyInstallment,
    downPayment,
    installmentMonths,
    netWorkingCapital: workingCapital.net,
    baseMonthlyRevenue,
  };
}

/**
 * Monthly maintenance for a given contract year.
 *
 * The last rate in the table repeats for every later year. An asset does not
 * stop needing parts because the table ran out of rows, and silently charging
 * zero is the kind of optimism that shows up as a surprise in year six.
 */
function monthlyMaintenance(model: ContractModel, year: number): number {
  const maintenance = model.costs.maintenance;
  if (!maintenance) return 0;

  const rates = maintenance.annualRateByYear;
  if (rates.length === 0) return 0;

  const rate = rates[Math.min(year, rates.length - 1)] ?? 0;
  return (maintenance.basis * rate) / 12;
}

/**
 * Collapses investment lines into a month-indexed total.
 *
 * Lines scheduled past the end of the contract are pulled back to the final
 * month rather than dropped, so a mis-specified model overstates cost instead
 * of quietly losing it.
 */
function groupInvestmentsByMonth(model: ContractModel): Map<number, number> {
  const byMonth = new Map<number, number>();
  for (const line of model.investments ?? []) {
    const month = Math.min(Math.max(0, line.month), model.termMonths);
    byMonth.set(month, (byMonth.get(month) ?? 0) + line.amount);
  }
  return byMonth;
}
