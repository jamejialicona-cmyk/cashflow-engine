import { describe, expect, it } from "vitest";
import { buildSchedule } from "../../src/engine/schedule.js";
import { baseModel } from "../fixtures.js";

describe("buildSchedule", () => {
  it("spans month zero through the contract term inclusive", () => {
    const { schedule } = buildSchedule(baseModel({ termMonths: 24 }));
    expect(schedule).toHaveLength(25);
    expect(schedule[0]?.month).toBe(0);
    expect(schedule[24]?.month).toBe(24);
  });

  it("books no operations in month zero", () => {
    const { schedule } = buildSchedule(baseModel());
    const signing = schedule[0]!;
    expect(signing.totalRevenue).toBe(0);
    expect(signing.totalCost).toBe(0);
    expect(signing.ebitda).toBe(0);
    expect(signing.installment).toBe(0);
  });

  it("pays the unescalated base amounts in month one", () => {
    const first = buildSchedule(baseModel()).schedule[1]!;
    expect(first.fixedRevenue).toBe(10_000);
    expect(first.variableRevenue).toBe(4_000);
    expect(first.totalRevenue).toBe(14_000);
    expect(first.operatingCost).toBe(5_000);
    expect(first.ebitda).toBe(9_000);
  });

  it("assigns contract years in twelve-month blocks starting at month one", () => {
    const { schedule } = buildSchedule(baseModel());
    expect(schedule[1]?.year).toBe(0);
    expect(schedule[12]?.year).toBe(0);
    expect(schedule[13]?.year).toBe(1);
  });

  it("applies revenue escalation from month thirteen, not month twelve", () => {
    const model = baseModel({
      revenue: {
        fixedMonthly: 10_000,
        streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
        annualEscalation: 0.05,
      },
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[12]?.totalRevenue).toBeCloseTo(14_000, 8);
    expect(schedule[13]?.totalRevenue).toBeCloseTo(14_000 * 1.05, 8);
  });

  it("escalates cost independently of revenue", () => {
    const model = baseModel({
      revenue: {
        fixedMonthly: 10_000,
        streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
        annualEscalation: 0.05,
      },
      costs: { fixedMonthly: 3_000, variableMonthly: 2_000, annualEscalation: 0.03 },
    });
    const secondYear = buildSchedule(model).schedule[13]!;
    expect(secondYear.operatingCost).toBeCloseTo(5_000 * 1.03, 8);
    // Revenue outruns cost, so margin widens in year two.
    expect(secondYear.ebitda).toBeGreaterThan(9_000);
  });

  it("charges contingency on operations and maintenance but never on financing", () => {
    const model = baseModel({
      costs: { fixedMonthly: 3_000, variableMonthly: 2_000, contingencyRate: 0.1 },
      financedAsset: {
        principal: 24_000,
        downPayment: 0,
        termMonths: 24,
        annualRate: 0,
        residualValue: 0,
      },
    });
    const first = buildSchedule(model).schedule[1]!;
    expect(first.contingencyCost).toBeCloseTo(500, 8);
    expect(first.installment).toBe(1_000);
    expect(first.totalCost).toBeCloseTo(5_500, 8);
    // Contingency is 10% of 5,000, not of 6,000.
    expect(first.ebitda).toBeCloseTo(14_000 - 5_500, 8);
  });

  it("repeats the last maintenance rate past the end of the table", () => {
    const model = baseModel({
      termMonths: 48,
      costs: {
        fixedMonthly: 3_000,
        variableMonthly: 2_000,
        maintenance: { basis: 120_000, annualRateByYear: [0.01, 0.02] },
      },
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[1]?.maintenanceCost).toBeCloseTo(100, 8);
    expect(schedule[13]?.maintenanceCost).toBeCloseTo(200, 8);
    // Years three and four fall past the table and hold at the last rate.
    expect(schedule[25]?.maintenanceCost).toBeCloseTo(200, 8);
    expect(schedule[37]?.maintenanceCost).toBeCloseTo(200, 8);
  });

  it("places staged investments in the months they are scheduled for", () => {
    const model = baseModel({
      investments: [
        { label: "Fit-out deposit", amount: 50_000, month: 0 },
        { label: "Fit-out balance", amount: 50_000, month: 2 },
      ],
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[0]?.investment).toBe(50_000);
    expect(schedule[1]?.investment).toBe(0);
    expect(schedule[2]?.investment).toBe(50_000);
  });

  it("pulls an investment scheduled past the term back to the final month", () => {
    const model = baseModel({
      termMonths: 12,
      investments: [{ label: "Late line", amount: 7_000, month: 99 }],
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[12]?.investment).toBe(7_000);
    expect(schedule.reduce((sum, row) => sum + row.investment, 0)).toBe(7_000);
  });

  it("adds the down payment to month zero and amortizes only the balance", () => {
    const model = baseModel({
      financedAsset: {
        principal: 24_000,
        downPayment: 12_000,
        termMonths: 12,
        annualRate: 0,
        residualValue: 0,
      },
    });
    const { schedule, monthlyInstallment } = buildSchedule(model);
    expect(schedule[0]?.investment).toBe(12_000);
    expect(monthlyInstallment).toBe(1_000);
  });

  it("stops charging installments after the financing term ends", () => {
    const model = baseModel({
      termMonths: 24,
      financedAsset: {
        principal: 12_000,
        downPayment: 0,
        termMonths: 12,
        annualRate: 0,
        residualValue: 0,
      },
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[12]?.installment).toBe(1_000);
    expect(schedule[13]?.installment).toBe(0);
  });

  it("books residual value only in the final month", () => {
    const model = baseModel({
      financedAsset: {
        principal: 24_000,
        downPayment: 0,
        termMonths: 24,
        annualRate: 0,
        residualValue: 5_000,
      },
    });
    const { schedule } = buildSchedule(model);
    expect(schedule[23]?.residualValue).toBe(0);
    expect(schedule[24]?.residualValue).toBe(5_000);
  });

  it("consumes working capital at signing and releases it at the end", () => {
    const model = baseModel({
      workingCapital: {
        receivableDays: 30,
        payableDays: 0,
        payableBaseMonthly: 0,
        inventory: 0,
      },
    });
    const { schedule, netWorkingCapital } = buildSchedule(model);
    expect(netWorkingCapital).toBeCloseTo(14_000, 8);
    expect(schedule[0]?.workingCapitalDelta).toBeCloseTo(-14_000, 8);
    expect(schedule[24]?.workingCapitalDelta).toBeCloseTo(14_000, 8);
    // Over the full term working capital nets out to nothing.
    const total = schedule.reduce((sum, row) => sum + row.workingCapitalDelta, 0);
    expect(total).toBeCloseTo(0, 8);
  });

  it("releases cash at signing when suppliers fund the operation", () => {
    const model = baseModel({
      workingCapital: {
        receivableDays: 0,
        payableDays: 60,
        payableBaseMonthly: 2_000,
        inventory: 0,
      },
    });
    const { schedule, netWorkingCapital } = buildSchedule(model);
    expect(netWorkingCapital).toBeCloseTo(-4_000, 8);
    expect(schedule[0]?.workingCapitalDelta).toBeCloseTo(4_000, 8);
  });

  it("keeps cumulative columns consistent with the per-month values", () => {
    const { schedule } = buildSchedule(baseModel());
    let runningCash = 0;
    let runningNpv = 0;
    for (const row of schedule) {
      runningCash += row.netCashFlow;
      runningNpv += row.discountedCashFlow;
      expect(row.cumulativeCashFlow).toBeCloseTo(runningCash, 6);
      expect(row.cumulativeNpv).toBeCloseTo(runningNpv, 6);
    }
  });

  it("is pure: the same model evaluated twice gives identical schedules", () => {
    const model = baseModel();
    expect(buildSchedule(model).schedule).toEqual(buildSchedule(model).schedule);
  });

  describe("overrides", () => {
    it("scales metered volume and the variable cost that follows it", () => {
      const first = buildSchedule(baseModel(), { volumeFactor: 0.5 }).schedule[1]!;
      expect(first.variableRevenue).toBe(2_000);
      expect(first.operatingCost).toBe(4_000);
      expect(first.fixedRevenue).toBe(10_000);
    });

    it("scales price without touching volume or cost", () => {
      const first = buildSchedule(baseModel(), { priceFactor: 1.1 }).schedule[1]!;
      expect(first.variableRevenue).toBeCloseTo(4_400, 8);
      expect(first.operatingCost).toBe(5_000);
    });

    it("replaces the model's escalation rather than compounding with it", () => {
      const model = baseModel({
        termMonths: 24,
        revenue: {
          fixedMonthly: 10_000,
          streams: [{ label: "Units", unitsPerMonth: 400, pricePerUnit: 10 }],
          annualEscalation: 0.05,
        },
      });
      const flat = buildSchedule(model, { revenueEscalation: 0 }).schedule[13]!;
      expect(flat.totalRevenue).toBeCloseTo(14_000, 8);
    });
  });
});
