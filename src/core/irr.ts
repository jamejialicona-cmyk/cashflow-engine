import { npv } from "./npv.js";
import { monthlyToAnnualEffective } from "./rates.js";

/** Why an IRR could not be produced for a given flow vector. */
export type IrrFailure =
  | "TOO_FEW_PERIODS"
  | "NO_OUTFLOW"
  | "NO_INFLOW"
  | "NEVER_RECOVERED"
  | "NO_CONVERGENCE";

export type IrrResult =
  | { ok: true; periodicRate: number }
  | { ok: false; reason: IrrFailure };

export interface IrrOptions {
  /** Absolute NPV tolerance that counts as a root. Defaults to a scale-relative epsilon. */
  tolerance?: number;
  /** Maximum bisection steps. Default 200. */
  maxIterations?: number;
  /** Upper bracket for the periodic rate. Default 5 (500% per period). */
  upperBound?: number;
}

/**
 * Internal rate of return by bisection.
 *
 * Bisection rather than Newton-Raphson on purpose. It cannot diverge, it needs
 * no derivative, and over the bracket (-1, upperBound] it converges on *a* root
 * for every conventional flow vector. The cost is a fixed iteration count,
 * which is irrelevant next to the cost of an unstable answer in a financial
 * model.
 *
 * Returns a discriminated result rather than throwing or returning a sentinel
 * number, because "this project has no IRR" is an ordinary outcome and not an
 * error: a vector with no outflow, or one that never recovers its investment,
 * genuinely has nothing to report.
 *
 * ## Caveat: non-conventional flows
 *
 * A vector whose sign changes more than once may have several real roots.
 * Bisection returns one of them and gives no warning. That is a property of IRR
 * itself, not of this implementation. Prefer NPV when signs alternate.
 */
export function irr(flows: readonly number[], options: IrrOptions = {}): IrrResult {
  const { maxIterations = 200, upperBound = 5 } = options;

  if (flows.length < 2) return { ok: false, reason: "TOO_FEW_PERIODS" };

  let hasOutflow = false;
  let hasInflow = false;
  let sum = 0;
  let scale = 0;
  for (const f of flows) {
    if (f < 0) hasOutflow = true;
    if (f > 0) hasInflow = true;
    sum += f;
    scale = Math.max(scale, Math.abs(f));
  }

  if (!hasOutflow) return { ok: false, reason: "NO_OUTFLOW" };
  if (!hasInflow) return { ok: false, reason: "NO_INFLOW" };
  // Undiscounted flows must at least sum positive. Otherwise no rate above
  // -100% brings NPV to zero and the bracket below contains no root.
  if (sum <= 0) return { ok: false, reason: "NEVER_RECOVERED" };

  const tolerance = options.tolerance ?? Math.max(scale, 1) * 1e-9;

  let low = -0.999999;
  let high = upperBound;
  let mid = 0;

  for (let i = 0; i < maxIterations; i++) {
    mid = (low + high) / 2;
    const value = npv(flows, mid);
    if (Math.abs(value) < tolerance) return { ok: true, periodicRate: mid };
    // NPV decreases monotonically in the rate for conventional flows.
    if (value > 0) low = mid;
    else high = mid;
  }

  // The bracket has collapsed to machine noise; mid is the best available root.
  if (high - low < 1e-12) return { ok: true, periodicRate: mid };
  return { ok: false, reason: "NO_CONVERGENCE" };
}

/**
 * IRR of a monthly flow vector, expressed as an effective annual rate.
 * Returns `null` when the vector has no reportable IRR.
 */
export function annualizedIrr(monthlyFlows: readonly number[]): number | null {
  const result = irr(monthlyFlows);
  return result.ok ? monthlyToAnnualEffective(result.periodicRate) : null;
}
