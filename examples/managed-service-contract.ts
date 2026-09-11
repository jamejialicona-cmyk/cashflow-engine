/**
 * A five-year managed service contract, evaluated end to end.
 *
 * The operator installs equipment at the customer's site, runs it, and bills a
 * monthly fee plus a per-unit charge. Every number below is invented for
 * illustration.
 *
 * Run it with `npm run example`.
 */

import { evaluateContract, runSensitivity } from "../src/index.js";
import type { ContractModel } from "../src/index.js";

const contract: ContractModel = {
  termMonths: 60,
  discountRateAnnual: 0.14,

  revenue: {
    fixedMonthly: 300_000,
    streams: [
      { label: "Standard cycles", unitsPerMonth: 180, pricePerUnit: 1_800 },
      { label: "Low-temperature cycles", unitsPerMonth: 45, pricePerUnit: 1_400 },
    ],
    adjustmentsMonthly: -15_000, // volume rebate owed back to the customer
    annualEscalation: 0.05, // inflation-indexation clause
  },

  costs: {
    fixedMonthly: 340_000, // payroll, licences, insurance
    variableMonthly: 120_000, // consumables at the planned volume
    contingencyRate: 0.05,
    annualEscalation: 0.03, // costs rise slower than prices, so margin widens
    maintenance: {
      basis: 3_500_000,
      annualRateByYear: [0.01, 0.015, 0.025, 0.035, 0.05],
    },
  },

  investments: [
    { label: "Water treatment, deposit", amount: 175_000, month: 0 },
    { label: "Water treatment, balance", amount: 175_000, month: 2 },
    { label: "Furniture and fit-out", amount: 280_000, month: 0 },
    { label: "Installation and training", amount: 161_630, month: 0 },
  ],

  financedAsset: {
    principal: 3_500_000,
    downPayment: 350_000,
    termMonths: 36,
    annualRate: 0.12, // nominal, charged at 1% per month on the balance
    residualValue: 0, // the equipment transfers to the customer at the end
  },

  workingCapital: {
    receivableDays: 45,
    payableDays: 60,
    payableBaseMonthly: 60_000,
    inventory: 120_000,
  },
};

const result = evaluateContract(contract);
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const percent = (value: number | null) =>
  value === null ? "not reportable" : `${(value * 100).toFixed(2)}%`;

console.log("=== Headline metrics ===");
console.table({
  "IRR (annual)": percent(result.metrics.irrAnnual),
  "NPV @ 14%": money.format(result.metrics.npv),
  "Payback (months)": result.metrics.paybackMonth ?? "beyond term",
  "Discounted payback": result.metrics.discountedPaybackMonth ?? "beyond term",
  MOIC: result.metrics.moic.toFixed(2),
  "Base monthly EBITDA": money.format(result.metrics.baseMonthlyEbitda),
});

console.log("\n=== Capital committed ===");
console.table({
  "Down payment": money.format(result.financing.downPayment),
  "Monthly installment": money.format(result.financing.monthlyInstallment),
  "Total installments": money.format(result.financing.totalInstallments),
  "Financing cost": money.format(result.financing.financingCost),
  "Net working capital": money.format(result.workingCapital.net),
});

console.log("\n=== Break-even ===");
if (result.breakeven) {
  console.table({
    "Units per month": Math.ceil(result.breakeven.units),
    "Planned units per month": 225,
    "Average price": money.format(result.breakeven.averagePrice),
    "Contribution per unit": money.format(result.breakeven.contributionPerUnit),
    "Margin of safety": `${result.breakeven.marginOfSafetyPct.toFixed(1)}%`,
  });
}

console.log("\n=== By contract year ===");
console.table(
  result.annual.map((year) => ({
    Year: year.year,
    Revenue: money.format(year.totalRevenue),
    "Operating cost": money.format(year.operatingCost),
    Installments: money.format(year.installments),
    "Net cash flow": money.format(year.netCashFlow),
    Margin: `${(year.operatingMargin * 100).toFixed(1)}%`,
  })),
);

console.log("\n=== Sensitivity ===");
console.table(
  runSensitivity(contract).map((scenario) => ({
    Scenario: scenario.label,
    IRR: percent(scenario.irrAnnual),
    "IRR delta (pts)":
      scenario.irrDeltaPoints === null
        ? "n/a"
        : (scenario.irrDeltaPoints * 100).toFixed(2),
    NPV: money.format(scenario.npv),
    Payback: scenario.paybackMonth ?? "beyond term",
  })),
);

if (result.warnings.length > 0) {
  console.log("\n=== Warnings ===");
  for (const warning of result.warnings) {
    console.log(`[${warning.level}] ${warning.code}: ${warning.message}`);
  }
}
