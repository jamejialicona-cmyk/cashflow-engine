import { describe, expect, it } from "vitest";
import { evaluateContract } from "../../src/engine/evaluate.js";
import { computeBreakeven } from "../../src/engine/breakeven.js";
import { computeWorkingCapital } from "../../src/engine/workingCapital.js";
import { runSensitivity, defaultScenarios } from "../../src/engine/sensitivity.js";
import { npv } from "../../src/core/npv.js";
import { annualToMonthlyEffective } from "../../src/core/rates.js";
import { baseModel } from "../fixtures.js";

/** A contract that actually commits capital, so IRR and payback are defined. */
function investedModel() {
  return baseModel({
    termMonths: 24,
    investments: [{ label: "Installation", amount: 100_000, month: 0 }],
  });
}

describe("evaluateContract", () => {
  it("computes NPV consistently with the standalone primitive", () => {
    const result = evaluateContract(investedModel());
    const flows = result.schedule.map((row) => row.netCashFlow);
    const monthlyRate = annualToMonthlyEffective(0.12);
    expect(result.metrics.npv).toBeCloseTo(npv(flows, monthlyRate), 6);
  });

  it("finds payback where cumulative cash flow first turns non-negative", () => {
    // 100,000 invested, 9,000 per month of EBITDA: whole at month 12.
    const result = evaluateContract(investedModel());
    expect(result.metrics.paybackMonth).toBe(12);
    expect(result.schedule[11]?.cumulativeCashFlow).toBeLessThan(0);
    expect(result.schedule[12]?.cumulativeCashFlow).toBeGreaterThanOrEqual(0);
  });

  it("puts discounted payback no earlier than simple payback", () => {
    const result = evaluateContract(investedModel());
    expect(result.metrics.discountedPaybackMonth).not.toBeNull();
    expect(result.metrics.discountedPaybackMonth!).toBeGreaterThanOrEqual(
      result.metrics.paybackMonth!,
    );
  });

  it("derives MOIC and ROI from the same inflow and outflow totals", () => {
    const { metrics } = evaluateContract(investedModel());
    expect(metrics.totalOutflows).toBeCloseTo(100_000, 6);
    expect(metrics.totalInflows).toBeCloseTo(9_000 * 24, 6);
    expect(metrics.moic).toBeCloseTo(metrics.totalInflows / metrics.totalOutflows, 10);
    expect(metrics.roi).toBeCloseTo(metrics.moic - 1, 10);
  });

  it("reports an IRR that drives the monthly flows to zero NPV", () => {
    const result = evaluateContract(investedModel());
    expect(result.metrics.irrAnnual).not.toBeNull();

    const monthlyEquivalent = Math.pow(1 + result.metrics.irrAnnual!, 1 / 12) - 1;
    const flows = result.schedule.map((row) => row.netCashFlow);
    expect(npv(flows, monthlyEquivalent)).toBeCloseTo(0, 2);
  });

  it("returns a null IRR with a reason when no cash is ever committed", () => {
    const result = evaluateContract(baseModel());
    expect(result.metrics.irrAnnual).toBeNull();
    expect(result.metrics.irrUnavailableReason).toBe("NO_OUTFLOW");
    expect(result.warnings.map((w) => w.code)).toContain("IRR_UNAVAILABLE");
  });

  it("rolls monthly rows up into years without losing cash", () => {
    const result = evaluateContract(investedModel());
    expect(result.annual).toHaveLength(2);

    const scheduleRevenue = result.schedule
      .filter((row) => row.month > 0)
      .reduce((sum, row) => sum + row.totalRevenue, 0);
    const annualRevenue = result.annual.reduce((sum, y) => sum + y.totalRevenue, 0);
    expect(annualRevenue).toBeCloseTo(scheduleRevenue, 6);
  });

  it("separates the down payment from the interest it avoids", () => {
    const result = evaluateContract(
      baseModel({
        financedAsset: {
          principal: 24_000,
          downPayment: 4_000,
          termMonths: 20,
          annualRate: 0,
          residualValue: 0,
        },
      }),
    );
    expect(result.financing.downPayment).toBe(4_000);
    expect(result.financing.monthlyInstallment).toBe(1_000);
    expect(result.financing.totalInstallments).toBeCloseTo(20_000, 6);
    expect(result.financing.financingCost).toBe(0);
  });

  it("prices the interest on a rate-bearing term", () => {
    const result = evaluateContract(
      baseModel({
        financedAsset: {
          principal: 100_000,
          downPayment: 0,
          termMonths: 24,
          annualRate: 0.12,
          residualValue: 0,
        },
      }),
    );
    expect(result.financing.financingCost).toBeGreaterThan(0);
    expect(result.financing.totalInstallments).toBeGreaterThan(100_000);
  });

  it("flags an operation that loses money before financing", () => {
    const result = evaluateContract(
      baseModel({ costs: { fixedMonthly: 20_000, variableMonthly: 5_000 } }),
    );
    expect(result.metrics.baseMonthlyEbitda).toBeLessThan(0);
    expect(result.warnings.map((w) => w.code)).toContain("NEGATIVE_EBITDA");
  });

  it("flags a deal dominated by collection terms", () => {
    const result = evaluateContract(
      baseModel({
        investments: [{ label: "Installation", amount: 10_000, month: 0 }],
        workingCapital: {
          receivableDays: 120,
          payableDays: 0,
          payableBaseMonthly: 0,
          inventory: 0,
        },
      }),
    );
    expect(result.warnings.map((w) => w.code)).toContain("WORKING_CAPITAL_HEAVY");
  });
});

describe("computeWorkingCapital", () => {
  it("returns zeros when no terms are given", () => {
    expect(computeWorkingCapital(50_000, undefined)).toEqual({
      receivables: 0,
      payables: 0,
      inventory: 0,
      net: 0,
    });
  });

  it("adds inventory to the cash the operation ties up", () => {
    const result = computeWorkingCapital(30_000, {
      receivableDays: 30,
      payableDays: 30,
      payableBaseMonthly: 30_000,
      inventory: 5_000,
    });
    expect(result.receivables).toBeCloseTo(30_000, 8);
    expect(result.payables).toBeCloseTo(30_000, 8);
    expect(result.net).toBeCloseTo(5_000, 8);
  });
});

describe("computeBreakeven", () => {
  it("solves the textbook case by hand", () => {
    // Fixed 1,000 with no fixed revenue, price 10, variable cost 5 per unit.
    const model = baseModel({
      revenue: {
        fixedMonthly: 0,
        streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
      },
      costs: { fixedMonthly: 1_000, variableMonthly: 2_000 },
    });
    const result = computeBreakeven(model)!;
    expect(result.averagePrice).toBe(10);
    expect(result.variableCostPerUnit).toBe(5);
    expect(result.contributionPerUnit).toBe(5);
    expect(result.units).toBeCloseTo(200, 8);
    expect(result.marginOfSafetyPct).toBeCloseTo(50, 8);
  });

  it("lets fixed revenue offset fixed cost instead of going negative", () => {
    const model = baseModel({
      revenue: {
        fixedMonthly: 10_000,
        streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
      },
      costs: { fixedMonthly: 3_000, variableMonthly: 2_000 },
    });
    const result = computeBreakeven(model)!;
    expect(result.units).toBe(0);
  });

  it("weights price across streams by volume", () => {
    const model = baseModel({
      revenue: {
        fixedMonthly: 0,
        streams: [
          { label: "Cheap", unitsPerMonth: 300, pricePerUnit: 10 },
          { label: "Premium", unitsPerMonth: 100, pricePerUnit: 30 },
        ],
      },
      costs: { fixedMonthly: 1_000, variableMonthly: 2_000 },
    });
    const result = computeBreakeven(model)!;
    // (300*10 + 100*30) / 400 = 15
    expect(result.averagePrice).toBeCloseTo(15, 8);
  });

  it("folds contingency into contribution rather than onto fixed cost", () => {
    const withoutContingency = computeBreakeven(
      baseModel({
        revenue: {
          fixedMonthly: 0,
          streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
        },
        costs: { fixedMonthly: 1_000, variableMonthly: 2_000 },
      }),
    )!;
    const withContingency = computeBreakeven(
      baseModel({
        revenue: {
          fixedMonthly: 0,
          streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
        },
        costs: { fixedMonthly: 1_000, variableMonthly: 2_000, contingencyRate: 0.1 },
      }),
    )!;
    expect(withContingency.contributionPerUnit).toBeCloseTo(10 - 5 * 1.1, 8);
    expect(withContingency.units).toBeGreaterThan(withoutContingency.units);
  });

  it("reports an unreachable break-even when contribution is negative", () => {
    const model = baseModel({
      revenue: {
        fixedMonthly: 0,
        streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 4 }],
      },
      costs: { fixedMonthly: 1_000, variableMonthly: 2_000 },
    });
    const result = computeBreakeven(model)!;
    expect(result.contributionPerUnit).toBeLessThan(0);
    expect(result.units).toBe(Infinity);
  });

  it("returns null when there is no metered volume", () => {
    const model = baseModel({ revenue: { fixedMonthly: 10_000, streams: [] } });
    expect(computeBreakeven(model)).toBeNull();
  });
});

describe("runSensitivity", () => {
  it("reports every default scenario against the base case", () => {
    const results = runSensitivity(investedModel());
    expect(results).toHaveLength(defaultScenarios.length);
    expect(results.map((r) => r.id)).toContain("volume_down_20");
  });

  it("shows lower volume hurting NPV and higher volume helping it", () => {
    const results = runSensitivity(investedModel());
    const down = results.find((r) => r.id === "volume_down_20")!;
    const up = results.find((r) => r.id === "volume_up_20")!;
    expect(down.npvDelta).toBeLessThan(0);
    expect(up.npvDelta).toBeGreaterThan(0);
  });

  it("leaves the base case untouched by any scenario", () => {
    const model = investedModel();
    const before = evaluateContract(model).metrics.npv;
    runSensitivity(model);
    expect(evaluateContract(model).metrics.npv).toBe(before);
  });

  it("reports a null IRR delta when a scenario has no IRR", () => {
    const results = runSensitivity(baseModel());
    expect(results.every((r) => r.irrDeltaPoints === null)).toBe(true);
  });

  it("accepts a caller-defined scenario", () => {
    const results = runSensitivity(investedModel(), [
      { id: "custom", label: "Prices held flat", priceFactor: 1, revenueEscalation: 0 },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe("Prices held flat");
  });
});
