import { irr } from "../core/irr.js";
import { monthlyToAnnualEffective } from "../core/rates.js";
import { paybackPeriod } from "../core/payback.js";
import { buildSchedule, type ScheduleOverrides } from "./schedule.js";
import { computeBreakeven } from "./breakeven.js";
import { computeWorkingCapital } from "./workingCapital.js";
import type {
  AnnualSummary,
  ContractModel,
  Evaluation,
  Metrics,
  MonthlyFlow,
  Warning,
} from "../model/types.js";

/**
 * Evaluates a contract end to end.
 *
 * This is the one function most callers need. It builds the schedule, rolls it
 * up by year, derives the metrics, and reports the conditions that make a
 * metric misleading rather than leaving the reader to notice on their own.
 */
export function evaluateContract(
  model: ContractModel,
  overrides: ScheduleOverrides = {},
): Evaluation {
  const context = buildSchedule(model, overrides);
  const { schedule } = context;

  const flows = schedule.map((row) => row.netCashFlow);
  const metrics = computeMetrics(schedule, flows, context.monthlyDiscountRate, model.termMonths);
  const annual = summarizeByYear(schedule, model);
  const breakeven = computeBreakeven(model, overrides.volumeFactor ?? 1);
  const workingCapital = computeWorkingCapital(
    context.baseMonthlyRevenue,
    model.workingCapital,
  );

  const asset = model.financedAsset;
  const financedPrincipal = asset ? Math.max(0, asset.principal - asset.downPayment) : 0;
  const totalInstallments = context.monthlyInstallment * context.installmentMonths;

  return {
    schedule,
    annual,
    metrics,
    workingCapital,
    breakeven,
    financing: {
      downPayment: context.downPayment,
      monthlyInstallment: context.monthlyInstallment,
      totalInstallments,
      financingCost: Math.max(0, totalInstallments - financedPrincipal),
    },
    warnings: collectWarnings(schedule, metrics, breakeven, context.netWorkingCapital),
  };
}

function computeMetrics(
  schedule: MonthlyFlow[],
  flows: number[],
  monthlyDiscountRate: number,
  termMonths: number,
): Metrics {
  const irrResult = irr(flows);
  const irrAnnual = irrResult.ok ? monthlyToAnnualEffective(irrResult.periodicRate) : null;
  const irrUnavailableReason = irrResult.ok ? null : irrResult.reason;

  const cumulative = schedule.map((row) => row.cumulativeCashFlow);
  const cumulativeDiscounted = schedule.map((row) => row.cumulativeNpv);

  let totalInflows = 0;
  let totalOutflows = 0;
  for (const flow of flows) {
    if (flow > 0) totalInflows += flow;
    else totalOutflows += -flow;
  }

  const operatingMonths = schedule.filter((row) => row.month > 0);
  const totalRevenue = operatingMonths.reduce((sum, row) => sum + row.totalRevenue, 0);
  const finalCumulative = cumulative[cumulative.length - 1] ?? 0;

  return {
    irrAnnual,
    irrUnavailableReason,
    npv: cumulativeDiscounted[cumulativeDiscounted.length - 1] ?? 0,
    paybackMonth: paybackPeriod(cumulative),
    discountedPaybackMonth: paybackPeriod(cumulativeDiscounted),
    moic: totalOutflows > 0 ? totalInflows / totalOutflows : 0,
    roi: totalOutflows > 0 ? (totalInflows - totalOutflows) / totalOutflows : 0,
    totalInflows,
    totalOutflows,
    baseMonthlyEbitda: schedule[1]?.ebitda ?? 0,
    averageMonthlyNetCashFlow:
      termMonths > 0
        ? operatingMonths.reduce((sum, row) => sum + row.netCashFlow, 0) / termMonths
        : 0,
    netCashFlowMargin: totalRevenue > 0 ? finalCumulative / totalRevenue : 0,
  };
}

function summarizeByYear(schedule: MonthlyFlow[], model: ContractModel): AnnualSummary[] {
  const revenueEscalation = model.revenue.annualEscalation ?? 0;
  const costEscalation = model.costs.annualEscalation ?? 0;
  const yearCount = Math.ceil(model.termMonths / 12);

  const summaries: AnnualSummary[] = [];
  for (let year = 0; year < yearCount; year++) {
    const months = schedule.filter((row) => row.month > 0 && row.year === year);

    const totalRevenue = sum(months, (row) => row.totalRevenue);
    const operatingCost = sum(months, (row) => row.operatingCost);
    const installments = sum(months, (row) => row.installment);
    const maintenanceCost = sum(months, (row) => row.maintenanceCost);
    const netCashFlow = sum(months, (row) => row.netCashFlow);

    summaries.push({
      year: year + 1,
      totalRevenue,
      operatingCost,
      installments,
      maintenanceCost,
      netCashFlow,
      operatingMargin: totalRevenue > 0 ? netCashFlow / totalRevenue : 0,
      revenueEscalationFactor: Math.pow(1 + revenueEscalation, year),
      costEscalationFactor: Math.pow(1 + costEscalation, year),
    });
  }
  return summaries;
}

function sum(rows: MonthlyFlow[], pick: (row: MonthlyFlow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Conditions that make a headline number misleading.
 *
 * Reported rather than thrown. All of these describe contracts a user might
 * genuinely want to model, including bad ones, and refusing to evaluate a bad
 * deal is not the engine's job. Saying plainly that it is bad is.
 */
function collectWarnings(
  schedule: MonthlyFlow[],
  metrics: Metrics,
  breakeven: Evaluation["breakeven"],
  netWorkingCapital: number,
): Warning[] {
  const warnings: Warning[] = [];

  const baseEbitda = metrics.baseMonthlyEbitda;
  if (baseEbitda < 0) {
    warnings.push({
      code: "NEGATIVE_EBITDA",
      level: "error",
      message:
        "Operating costs exceed revenue before financing. No payment structure fixes this.",
    });
  }

  const initialOutflow = -(schedule[0]?.netCashFlow ?? 0);
  if (initialOutflow <= 0 && metrics.totalOutflows === 0) {
    warnings.push({
      code: "NO_INITIAL_INVESTMENT",
      level: "warning",
      message:
        "No cash is committed at any point, so IRR and payback are undefined. Read NPV instead.",
    });
  }

  if (netWorkingCapital > baseEbitda * 3 && baseEbitda > 0) {
    warnings.push({
      code: "WORKING_CAPITAL_HEAVY",
      level: "warning",
      message:
        "Net working capital exceeds three months of EBITDA. Collection terms dominate this deal.",
    });
  }

  if (breakeven && !Number.isFinite(breakeven.units)) {
    warnings.push({
      code: "BREAKEVEN_NOT_REACHED",
      level: "error",
      message:
        "Contribution per unit is zero or negative. Volume cannot reach break-even at these prices.",
    });
  } else if (breakeven && breakeven.marginOfSafetyPct === 0) {
    warnings.push({
      code: "BREAKEVEN_NOT_REACHED",
      level: "warning",
      message: "Planned volume is at or below break-even volume.",
    });
  }

  if (metrics.irrAnnual === null) {
    warnings.push({
      code: "IRR_UNAVAILABLE",
      level: "warning",
      message: `IRR is not reportable for these flows (${metrics.irrUnavailableReason}).`,
    });
  }

  return warnings;
}
