# cashflow-engine

A deterministic project cash flow engine in pure TypeScript. Give it a contract,
get back a month-by-month schedule and the metrics computed from it: IRR, NPV,
payback, working capital, break-even and sensitivity analysis.

No framework, no I/O, no database, no opinion about your industry's numbers.
Every rate, price and cost is an input.

[![CI](https://github.com/jamejialicona-cmyk/cashflow-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/jamejialicona-cmyk/cashflow-engine/actions/workflows/ci.yml)

---

## Why this exists

Deals like this get evaluated in spreadsheets, and spreadsheets have three
problems that only show up once the deal matters.

**They cannot be tested.** A formula that silently excludes one revenue line
from the total looks exactly like one that includes it. The error surfaces in a
negotiation, not in a review.

**They cannot be diffed.** When a model produces a different answer on Tuesday
than it did on Monday, there is no way to find out which cell changed and why.

**They mix the model with the data.** Copy the workbook for a new customer and
you have forked the logic, so a fix applied to one file never reaches the other
eleven.

This library is the calculation layer pulled out and made testable. The model is
code with a test suite. The data is an argument.

## Install

```bash
npm install cashflow-engine
```

## Usage

```ts
import { evaluateContract, runSensitivity } from "cashflow-engine";
import type { ContractModel } from "cashflow-engine";

const contract: ContractModel = {
  termMonths: 60,
  discountRateAnnual: 0.14,

  revenue: {
    fixedMonthly: 300_000,
    streams: [
      { label: "Standard cycles", unitsPerMonth: 180, pricePerUnit: 1_800 },
      { label: "Low-temperature cycles", unitsPerMonth: 45, pricePerUnit: 1_400 },
    ],
    adjustmentsMonthly: -15_000,  // rebate owed back to the customer
    annualEscalation: 0.05,       // inflation-indexation clause
  },

  costs: {
    fixedMonthly: 340_000,
    variableMonthly: 120_000,
    contingencyRate: 0.05,
    annualEscalation: 0.03,       // costs rise slower than prices
    maintenance: {
      basis: 3_500_000,
      annualRateByYear: [0.01, 0.015, 0.025, 0.035, 0.05],
    },
  },

  investments: [
    { label: "Site works, deposit", amount: 175_000, month: 0 },
    { label: "Site works, balance", amount: 175_000, month: 2 },
    { label: "Installation and training", amount: 161_630, month: 0 },
  ],

  financedAsset: {
    principal: 3_500_000,
    downPayment: 350_000,
    termMonths: 36,
    annualRate: 0.12,
    residualValue: 0,
  },

  workingCapital: {
    receivableDays: 45,
    payableDays: 60,
    payableBaseMonthly: 120_000,
    inventory: 120_000,
  },
};

const result = evaluateContract(contract);

result.metrics.irrAnnual;        // 0.8103
result.metrics.npv;              // 4_773_133
result.metrics.paybackMonth;     // 24
result.breakeven?.units;         // 64.7 of 225 planned
result.warnings;                 // [{ code: "WORKING_CAPITAL_HEAVY", ... }]
```

The full worked example, including the reporting tables, is in
[`examples/managed-service-contract.ts`](examples/managed-service-contract.ts).
Run it with `npm run example`.

## What comes back

`evaluateContract` returns one object with five parts.

- **`schedule`** is one row per month from signing to the end of the term.
  Revenue, cost, EBITDA, installment, investment, working capital movement,
  residual value, net cash flow, and both cumulative columns.
- **`annual`** rolls those rows up by contract year with margins and the
  escalation factors that produced them.
- **`metrics`** holds the headline numbers: IRR, NPV, simple and discounted
  payback, MOIC, ROI, and base monthly EBITDA.
- **`breakeven`** gives the volume at which the contract stops losing money,
  plus the headroom between that and planned volume.
- **`warnings`** names the conditions that make a headline number misleading.

## Design decisions worth defending

**IRR returns a result type, not a number.** A flow vector with no outflow, or
one that never recovers its investment, has no IRR. Returning `-1`, `0` or
`NaN` invites a caller to format it as a percentage and put it in front of a
customer. `irr()` returns `{ ok: false, reason }` and `evaluateContract` carries
the reason through to `irrUnavailableReason`.

**Bisection, not Newton-Raphson.** Bisection cannot diverge, needs no
derivative, and converges on a root for every conventional vector. The fixed
iteration count is irrelevant next to the cost of an unstable answer. Where IRR
is genuinely ambiguous, because signs alternate more than once, the docs say so
and point at NPV instead.

**Two rate conventions, named separately.** Discounting compounds:
`(1 + annual) ** (1/12) - 1`. Amortization divides: `annual / 12`, because that
is what a loan contract says. Using one for the other is the most common error
in a hand-built model, so the two live in `rates.ts` under different names and
neither is the default.

**Contingency lives inside the contribution margin.** Total cost is
`(fixed + maintenance + variable * u / u0) * (1 + contingency)`. Contingency
multiplies both sides, so bolting it onto fixed cost gives the wrong break-even.
The derivation is written out in `breakeven.ts`.

**The last maintenance rate repeats.** An asset does not stop needing parts
because the rate table ran out of rows. A short table models a plateau, not a
cliff to zero in year six.

**Warnings are reported, not thrown.** A contract with negative EBITDA is one a
user might genuinely want to model. Refusing to evaluate a bad deal is not the
engine's job. Saying plainly that it is bad is.

**Everything is pure.** Same model in, same schedule out. No clock, no I/O, no
randomness, no mutation. That is what makes the sensitivity runner a loop over
`evaluateContract` with different arguments rather than a clone-and-restore
dance, and what makes the tests exact rather than approximate.

## Sensitivity

```ts
runSensitivity(contract);
```

Five default scenarios, each reported against the base case:

| Scenario | IRR | Delta (pts) | NPV | Payback |
|---|---|---|---|---|
| Base | 81.03% | — | $4,773,133 | 24 |
| Volume -20% | 44.35% | -36.68 | $2,294,102 | 39 |
| Volume -10% | 62.11% | -18.92 | $3,533,618 | 31 |
| Volume +20% | 122.71% | +41.68 | $7,252,163 | 17 |
| No price indexation | 50.32% | -30.71 | $2,091,728 | 33 |
| Cost +10% | 45.96% | -35.07 | $2,545,161 | 39 |

Volume comes first because it is the assumption that breaks most often. A
forecast built from a customer's own estimate is a negotiating position, not a
measurement. Here a fifth less volume nearly halves the return.

Scenarios are plain objects, so define your own:

```ts
runSensitivity(contract, [
  { id: "hard_year", label: "Volume down, costs up", volumeFactor: 0.85, costFactor: 1.08 },
]);
```

## Using the primitives directly

The building blocks are exported on their own and work on any flow vector.

```ts
import { irr, npv, pmt, paybackPeriod, annualizedIrr } from "cashflow-engine";

npv([-1000, 400, 400, 400], 0.01);   // 176.39
irr([-1000, 500, 500, 500]);          // { ok: true, periodicRate: 0.2337 }
annualizedIrr([-100, 110]);           // 2.1384 as an effective annual rate
pmt(0.06, 360, 200_000);              // 1199.10, matching Excel PMT
paybackPeriod([-100, -60, -20, 30]);  // 3
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit, strict with noUncheckedIndexedAccess
npm test            # 69 tests
npm run example     # the worked example above
npm run build       # emits dist/ with declarations
```

Tests are written so that expected values are derived by hand or checked against
a closed form, not copied from a previous run. `pmt` is verified against the
canonical 30-year mortgage payment. `npv` is verified against the closed form of
a level annuity. `irr` is verified by feeding its own answer back through `npv`
and asserting the result is zero.

## Scope

This library computes cash flows. It does not:

- convert currencies, or know what currency you are using
- apply tax of any kind
- read or write files, databases or spreadsheets
- recommend a decision

Pick a currency and a tax convention, stay consistent, and the arithmetic holds.

## License

MIT
