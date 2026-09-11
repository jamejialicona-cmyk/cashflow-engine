/**
 * cashflow-engine
 *
 * A deterministic project cash flow engine. Pure functions, no I/O, no
 * framework, no assumptions about your industry's numbers.
 */

export {
  annualToMonthlyEffective,
  monthlyToAnnualEffective,
  nominalAnnualToMonthly,
} from "./core/rates.js";
export { npv, discountFactor } from "./core/npv.js";
export { irr, annualizedIrr } from "./core/irr.js";
export type { IrrResult, IrrFailure, IrrOptions } from "./core/irr.js";
export { pmt, totalPayments, financingCost } from "./core/pmt.js";
export { paybackPeriod, fractionalPaybackPeriod } from "./core/payback.js";

export { buildSchedule } from "./engine/schedule.js";
export type { ScheduleOverrides, ScheduleContext } from "./engine/schedule.js";
export { evaluateContract } from "./engine/evaluate.js";
export { computeBreakeven } from "./engine/breakeven.js";
export { computeWorkingCapital } from "./engine/workingCapital.js";
export { runSensitivity, defaultScenarios } from "./engine/sensitivity.js";
export type { Scenario, ScenarioResult } from "./engine/sensitivity.js";

export type {
  AnnualSummary,
  BreakevenResult,
  ContractModel,
  CostTerms,
  Evaluation,
  FinancedAsset,
  InvestmentLine,
  MaintenanceSchedule,
  Metrics,
  MonthlyFlow,
  RevenueStream,
  RevenueTerms,
  Warning,
  WarningCode,
  WorkingCapitalResult,
  WorkingCapitalTerms,
} from "./model/types.js";
