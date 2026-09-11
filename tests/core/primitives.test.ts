import { describe, expect, it } from "vitest";
import { npv, discountFactor } from "../../src/core/npv.js";
import { irr, annualizedIrr } from "../../src/core/irr.js";
import { pmt, totalPayments, financingCost } from "../../src/core/pmt.js";
import { paybackPeriod, fractionalPaybackPeriod } from "../../src/core/payback.js";
import {
  annualToMonthlyEffective,
  monthlyToAnnualEffective,
  nominalAnnualToMonthly,
} from "../../src/core/rates.js";

describe("rates", () => {
  it("round-trips an annual rate through monthly compounding", () => {
    const annual = 0.14;
    expect(monthlyToAnnualEffective(annualToMonthlyEffective(annual))).toBeCloseTo(annual, 12);
  });

  it("compounds rather than divides when converting for discounting", () => {
    // 12% effective annual is about 0.949% per month, not 1%.
    expect(annualToMonthlyEffective(0.12)).toBeCloseTo(0.0094888, 6);
    expect(annualToMonthlyEffective(0.12)).toBeLessThan(0.12 / 12);
  });

  it("divides for amortization, which is the loan convention", () => {
    expect(nominalAnnualToMonthly(0.12)).toBe(0.01);
  });
});

describe("npv", () => {
  it("leaves period zero undiscounted", () => {
    expect(npv([100], 0.1)).toBe(100);
  });

  it("discounts one period by exactly one factor", () => {
    expect(npv([0, 100], 0.1)).toBeCloseTo(100 / 1.1, 10);
  });

  it("matches the closed form of a level annuity", () => {
    // Present value of 100 per period for 5 periods at 8%, starting at t=1.
    const rate = 0.08;
    const periods = 5;
    const closedForm = (100 * (1 - Math.pow(1 + rate, -periods))) / rate;
    expect(npv([0, 100, 100, 100, 100, 100], rate)).toBeCloseTo(closedForm, 9);
  });

  it("is unchanged by a zero rate", () => {
    expect(npv([-100, 50, 50, 50], 0)).toBe(50);
  });

  it("exposes the same discount factor the schedule uses", () => {
    expect(discountFactor(0.01, 3)).toBeCloseTo(1 / Math.pow(1.01, 3), 12);
  });
});

describe("irr", () => {
  it("solves a single-period doubling exactly", () => {
    const result = irr([-100, 110]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.periodicRate).toBeCloseTo(0.1, 8);
  });

  it("returns a rate that drives NPV to zero", () => {
    const flows = [-1000, 500, 500, 500];
    const result = irr(flows);
    expect(result.ok).toBe(true);
    if (result.ok) expect(npv(flows, result.periodicRate)).toBeCloseTo(0, 5);
  });

  it("annualizes a monthly rate by compounding", () => {
    const annual = annualizedIrr([-100, 110]);
    expect(annual).not.toBeNull();
    expect(annual).toBeCloseTo(Math.pow(1.1, 12) - 1, 6);
  });

  it("reports why there is no IRR instead of inventing one", () => {
    expect(irr([100, 100])).toEqual({ ok: false, reason: "NO_OUTFLOW" });
    expect(irr([-100, -100])).toEqual({ ok: false, reason: "NO_INFLOW" });
    expect(irr([-1000, 100, 100])).toEqual({ ok: false, reason: "NEVER_RECOVERED" });
    expect(irr([-100])).toEqual({ ok: false, reason: "TOO_FEW_PERIODS" });
  });

  it("returns null from the annualized helper when no IRR exists", () => {
    expect(annualizedIrr([100, 100])).toBeNull();
  });

  it("handles a break-even project as a zero rate", () => {
    const result = irr([-100, 100]);
    expect(result.ok).toBe(false);
    // Sum is exactly zero, so nothing was recovered beyond the principal.
    if (!result.ok) expect(result.reason).toBe("NEVER_RECOVERED");
  });
});

describe("pmt", () => {
  it("matches the textbook 30-year mortgage payment", () => {
    // $200,000 at 6% nominal over 360 months is the canonical $1,199.10.
    expect(pmt(0.06, 360, 200_000)).toBeCloseTo(1199.1, 1);
  });

  it("divides evenly when the rate is zero", () => {
    expect(pmt(0, 24, 12_000)).toBe(500);
  });

  it("returns the principal when there is no term to spread it over", () => {
    expect(pmt(0.1, 0, 5_000)).toBe(5_000);
  });

  it("charges nothing on a zero principal", () => {
    expect(pmt(0.15, 36, 0)).toBe(0);
  });

  it("reports zero financing cost for an interest-free plan", () => {
    expect(financingCost(0, 24, 12_000)).toBe(0);
    expect(totalPayments(0, 24, 12_000)).toBeCloseTo(12_000, 10);
  });

  it("reports interest as the excess over principal", () => {
    const principal = 100_000;
    const cost = financingCost(0.12, 36, principal);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(totalPayments(0.12, 36, principal) - principal, 8);
  });
});

describe("payback", () => {
  it("finds the first non-negative period after period zero", () => {
    expect(paybackPeriod([-100, -60, -20, 30])).toBe(3);
  });

  it("ignores a non-negative period zero", () => {
    expect(paybackPeriod([0, -50, 10])).toBe(2);
  });

  it("returns null when the total never crosses", () => {
    expect(paybackPeriod([-100, -90, -80])).toBeNull();
  });

  it("interpolates inside the crossing period", () => {
    // Crosses a quarter of the way through period 2: -30 of a 40 gain.
    expect(fractionalPaybackPeriod([-100, -30, 10])).toBeCloseTo(1.75, 10);
  });

  it("returns null from the interpolating variant when it never crosses", () => {
    expect(fractionalPaybackPeriod([-10, -5, -1])).toBeNull();
  });
});
