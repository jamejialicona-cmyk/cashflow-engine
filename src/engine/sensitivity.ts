import { evaluateContract } from "./evaluate.js";
import type { ScheduleOverrides } from "./schedule.js";
import type { ContractModel } from "../model/types.js";

export interface Scenario extends ScheduleOverrides {
  id: string;
  label: string;
  description?: string;
}

export interface ScenarioResult {
  id: string;
  label: string;
  description: string;
  irrAnnual: number | null;
  npv: number;
  paybackMonth: number | null;
  /**
   * IRR gap against the base case, in percentage points. `null` when either
   * side has no reportable IRR, because a difference against nothing is not a
   * number worth printing.
   */
  irrDeltaPoints: number | null;
  /** NPV gap against the base case, in currency units. */
  npvDelta: number;
}

/**
 * A default set of stress tests.
 *
 * Volume down is first because it is the assumption that breaks most often: a
 * forecast built from a customer's own estimate is a negotiating position, not
 * a measurement.
 */
export const defaultScenarios: Scenario[] = [
  {
    id: "volume_down_20",
    label: "Volume -20%",
    description: "Demand lands a fifth below the forecast.",
    volumeFactor: 0.8,
  },
  {
    id: "volume_down_10",
    label: "Volume -10%",
    description: "Demand lands a tenth below the forecast.",
    volumeFactor: 0.9,
  },
  {
    id: "volume_up_20",
    label: "Volume +20%",
    description: "Demand exceeds the forecast by a fifth.",
    volumeFactor: 1.2,
  },
  {
    id: "no_indexation",
    label: "No price indexation",
    description: "The annual price increase is never applied.",
    revenueEscalation: 0,
  },
  {
    id: "cost_shock",
    label: "Cost +10%",
    description: "The operating cost base comes in a tenth above plan.",
    costFactor: 1.1,
  },
];

/**
 * Runs each scenario against the same model and reports the gap to the base
 * case.
 *
 * Because the engine is pure, a scenario is just another evaluation with
 * different overrides. There is no cloning of models, no mutation to undo, and
 * no chance of a scenario leaking into the base case.
 */
export function runSensitivity(
  model: ContractModel,
  scenarios: Scenario[] = defaultScenarios,
): ScenarioResult[] {
  const base = evaluateContract(model);

  return scenarios.map((scenario) => {
    const { id, label, description, ...overrides } = scenario;
    const result = evaluateContract(model, overrides);

    const irrDeltaPoints =
      result.metrics.irrAnnual !== null && base.metrics.irrAnnual !== null
        ? result.metrics.irrAnnual - base.metrics.irrAnnual
        : null;

    return {
      id,
      label,
      description: description ?? "",
      irrAnnual: result.metrics.irrAnnual,
      npv: result.metrics.npv,
      paybackMonth: result.metrics.paybackMonth,
      irrDeltaPoints,
      npvDelta: result.metrics.npv - base.metrics.npv,
    };
  });
}
