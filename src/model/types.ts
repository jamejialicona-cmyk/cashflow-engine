/**
 * The domain model.
 *
 * One `ContractModel` describes a revenue-generating agreement with an upfront
 * capital commitment: a managed service contract, an equipment lease, a SaaS
 * deal with onboarding cost, an infrastructure build-out. The engine turns it
 * into a month-by-month cash flow schedule and the metrics computed from it.
 *
 * Two rules hold throughout:
 *
 * 1. **Nothing is hardcoded.** Every rate, price and cost is an input. The
 *    engine has no opinion about your industry's numbers.
 * 2. **Money is unitless.** Pick a currency and a tax convention, then stay
 *    consistent. The engine never converts and never adds tax.
 */

/** A metered revenue line: units sold per month at a unit price. */
export interface RevenueStream {
  /** Human label carried through to the schedule, e.g. "Standard cycles". */
  label: string;
  /** Units delivered per month at the base volume. */
  unitsPerMonth: number;
  /** Price charged per unit, before any escalation. */
  pricePerUnit: number;
}

/** A one-off cash outflow at a known month. */
export interface InvestmentLine {
  label: string;
  amount: number;
  /**
   * Month the cash leaves. 0 is signing. Use several lines to express a
   * staged disbursement, e.g. 50% at month 0 and 50% at month 2.
   */
  month: number;
}

/** Capital equipment paid over time rather than in cash at signing. */
export interface FinancedAsset {
  /** Full purchase price. Also the basis for maintenance rates and residual value. */
  principal: number;
  /** Portion paid in cash at month 0. Zero for a no-money-down term. */
  downPayment: number;
  /** Number of level monthly payments. Zero means the asset is paid in cash. */
  termMonths: number;
  /**
   * Nominal annual rate on the financed balance, divided by 12 per month.
   * Use 0 for an interest-free installment plan.
   */
  annualRate: number;
  /**
   * Recovery value at the end of the term, booked as an inflow in the final
   * month. Zero when the asset transfers to the customer.
   */
  residualValue: number;
}

/** Terms that determine how much cash the operation ties up. */
export interface WorkingCapitalTerms {
  /** Days between delivering and being paid. */
  receivableDays: number;
  /** Days between being billed and paying. */
  payableDays: number;
  /**
   * Monthly cost base that is actually financed by suppliers. Usually a subset
   * of total cost, since payroll is not on supplier terms.
   */
  payableBaseMonthly: number;
  /** Cash permanently locked in stock. */
  inventory: number;
}

/** Maintenance that scales with the age of the asset rather than with volume. */
export interface MaintenanceSchedule {
  /** Amount the yearly rates apply to. Typically the financed asset principal. */
  basis: number;
  /**
   * Annual rate per contract year, as a fraction of `basis`. `[0.01, 0.02]`
   * means 1% in year one and 2% in year two. The last entry repeats for every
   * year beyond the array, so a short array models a plateau rather than a
   * cliff at zero.
   */
  annualRateByYear: number[];
}

export interface RevenueTerms {
  /** Flat monthly fee, independent of volume. */
  fixedMonthly: number;
  /** Metered lines. May be empty for a pure subscription. */
  streams: RevenueStream[];
  /**
   * Signed monthly adjustment applied to the fixed side: rebates and
   * commissions negative, ancillary income positive. Default 0.
   */
  adjustmentsMonthly?: number;
  /**
   * Annual price increase, applied from month 13 onward and compounded each
   * contract year. Models an inflation-indexation clause. Default 0.
   */
  annualEscalation?: number;
}

export interface CostTerms {
  /** Monthly cost that does not move with volume: payroll, licences, insurance. */
  fixedMonthly: number;
  /** Monthly cost that moves with volume at the base volume level. */
  variableMonthly: number;
  /**
   * Contingency as a fraction of operating cost plus maintenance. Never applied
   * to financing payments, which are contractual and not at risk. Default 0.
   */
  contingencyRate?: number;
  /**
   * Annual cost inflation, compounded per contract year. Set it below the
   * revenue escalation to model margin expansion, equal to hold margin flat.
   * Default 0.
   */
  annualEscalation?: number;
  /** Optional age-based maintenance. */
  maintenance?: MaintenanceSchedule;
}

export interface ContractModel {
  /** Contract length in months. The schedule runs from month 0 to this value. */
  termMonths: number;
  /**
   * Effective annual discount rate for NPV, typically the cost of capital.
   * Converted to a compounded monthly rate internally.
   */
  discountRateAnnual: number;
  revenue: RevenueTerms;
  costs: CostTerms;
  /** One-off outflows outside the financed asset: installation, training, fit-out. */
  investments?: InvestmentLine[];
  financedAsset?: FinancedAsset;
  /** Omit to model a business that collects and pays on the same day. */
  workingCapital?: WorkingCapitalTerms;
}

/** One row of the monthly schedule. Every field is an amount in the model's currency. */
export interface MonthlyFlow {
  /** 0 is signing. 1 is the first month of operation. */
  month: number;
  /** Contract year, 0-based. Months 1 to 12 are year 0. */
  year: number;

  fixedRevenue: number;
  variableRevenue: number;
  totalRevenue: number;

  operatingCost: number;
  maintenanceCost: number;
  contingencyCost: number;
  totalCost: number;

  /** Revenue minus operating, maintenance and contingency. Excludes financing. */
  ebitda: number;

  /** Level payment on the financed asset while the term runs. */
  installment: number;
  /** Scheduled one-off outflows landing this month, including the down payment. */
  investment: number;
  /** Negative when working capital consumes cash, positive when it is released. */
  workingCapitalDelta: number;
  /** Asset recovery value, only in the final month. */
  residualValue: number;

  netCashFlow: number;
  cumulativeCashFlow: number;

  discountFactor: number;
  discountedCashFlow: number;
  cumulativeNpv: number;
}

/** Year-level rollup of the monthly schedule, for reporting. */
export interface AnnualSummary {
  /** Contract year, 1-based for presentation. */
  year: number;
  totalRevenue: number;
  operatingCost: number;
  installments: number;
  maintenanceCost: number;
  netCashFlow: number;
  /** `netCashFlow / totalRevenue`, or 0 when there is no revenue. */
  operatingMargin: number;
  /** Compounded revenue escalation factor applied this year. */
  revenueEscalationFactor: number;
  /** Compounded cost escalation factor applied this year. */
  costEscalationFactor: number;
}

export interface WorkingCapitalResult {
  receivables: number;
  payables: number;
  inventory: number;
  /** Receivables minus payables plus inventory. Positive consumes cash. */
  net: number;
}

export interface BreakevenResult {
  /** Units per month at which contribution covers fixed cost. */
  units: number;
  /** Monthly revenue at that volume. */
  revenue: number;
  /** Headroom between planned volume and break-even volume, as a percentage. */
  marginOfSafetyPct: number;
  /** Volume-weighted average price across all streams. */
  averagePrice: number;
  /** Variable cost attributed to one unit. */
  variableCostPerUnit: number;
  /** Average price minus variable cost per unit. */
  contributionPerUnit: number;
}

export interface Metrics {
  /** Effective annual IRR, or `null` when the flow vector has no reportable IRR. */
  irrAnnual: number | null;
  /** Why the IRR is null. `null` when the IRR was computed. */
  irrUnavailableReason: string | null;
  npv: number;
  /** First month cumulative cash flow turns non-negative, or `null`. */
  paybackMonth: number | null;
  /** Same, on discounted flows. */
  discountedPaybackMonth: number | null;
  /** Total inflows divided by total outflows. */
  moic: number;
  /** `(inflows - outflows) / outflows`. */
  roi: number;
  totalInflows: number;
  totalOutflows: number;
  /** EBITDA of the first operating month, before escalation. */
  baseMonthlyEbitda: number;
  /** Mean net cash flow across the operating months. */
  averageMonthlyNetCashFlow: number;
  /** Cumulative net cash flow divided by cumulative revenue. */
  netCashFlowMargin: number;
}

export type WarningCode =
  | "NEGATIVE_EBITDA"
  | "NO_INITIAL_INVESTMENT"
  | "WORKING_CAPITAL_HEAVY"
  | "BREAKEVEN_NOT_REACHED"
  | "IRR_UNAVAILABLE";

export interface Warning {
  code: WarningCode;
  level: "error" | "warning";
  message: string;
}

export interface Evaluation {
  schedule: MonthlyFlow[];
  annual: AnnualSummary[];
  metrics: Metrics;
  workingCapital: WorkingCapitalResult;
  /** `null` when the model has no metered streams to break even on. */
  breakeven: BreakevenResult | null;
  /** Total cash committed to the financed asset, including interest. */
  financing: {
    downPayment: number;
    monthlyInstallment: number;
    totalInstallments: number;
    /** Interest paid over the life of the term. */
    financingCost: number;
  };
  warnings: Warning[];
}
