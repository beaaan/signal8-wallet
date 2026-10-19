# Decision: finance scenarios and the implemented treasury model

Resolves [issue #31](https://github.com/beaaan/signal8-wallet/issues/31).
Recorded on 19 October 2026, after the 17 October case freeze and the 18 October
feature freeze. Merging this record is the owners' decision.

## Decision

**The implemented model is kept unchanged.** The finance workbook and the
research in #28, #29, #30 and #33 stay explanatory models. None of their
proposals is adopted. No contract, policy, signed plan book, plan hash,
deployment or historical evidence changes.

The deck's cash-model slide uses workbook scenario B and is labelled as an
illustration, not a forecast. It is not a replay of what the agent does.

## How the workbook maps to the runtime

Amounts are mUSD demo units. Runtime sources: `agent/src/loops/storm.ts`
(`FORECAST`, `forecast`, the payday credit draw), `contracts/script/Deploy.s.sol`
(mock cover, credit line and router), `data/fixtures/payroll.json` and
`data/fixtures/plans/plan-book.example.json`.

| Item | Workbook (A and B) | Runtime | Decision |
|---|---|---|---|
| Starting point | Opening cash 20,000, zero debt, one normal week before six disrupted weeks | Actual Safe cash read on storm payday, after payroll is paid | Keep the runtime. The workbook start is an assumption, not a balance |
| Horizon | 13 weeks | 13 weeks | Same |
| Disruption | Six disrupted weeks from week 2 | Six disrupted weeks from the forecast's first week | Keep. Week numbers differ by one; the counts match |
| Inflow | 10,000 a week, 1,000 while disrupted | 10,000 a week, 1,000 while disrupted | Same |
| Outflow | A: 9,000 a week fixed. B: 6,300 fixed plus 27% of receipts | 9,000 a week, flat, including wage accrual | Keep. A matches the runtime; B's split is not adopted |
| Payroll | Inside weekly fixed costs, no separate payday (the original note said 4,500 a week) | 23,000 a month, paid in one batch on payday (10 staff). The 9,000 flat outflow stands in for later paydays | Keep. See payroll timing below |
| Floor | 10,000 target | 10,000 buffer | Same value. In both it is a target, not a guarantee |
| Headroom | B adds two weeks | None | Not adopted |
| Credit sizing | Pre-cost gap less cover, plus B's headroom, capped at 15,000 per storm and a 50,000 line | Need to the buffer from the forecast, capped by the storm plan's 15,000 per event and by the line's unused limit (50,000 line) | Keep the runtime |
| Cover | 20,000, paid in week 2 (the storm's first week) | 20,000 fixed payout, one claim per attested event, claimed when storm mode starts | Keep the current No.8+ mock. Optional tiers not adopted |
| Interest and fees | 8% a year on opening debt, 1% draw fee | None in the mock credit line | Explanatory only. No lending simulation is approved |
| Repayment | 10% of receipts outside storm weeks | 10% of each customer payment through `PaymentRouter` while credit is drawn and no storm is on | Same |
| Opening debt | Zero | Not in the forecast. Existing debt shrinks the draw only through the line's unused limit; the per-event cap counts this event's draws | Keep. Listed as a limitation |

## Answers to the open questions

1. **Opening cash and week numbering.** Not reconciled into one model. The
   workbook stays a pre-storm illustration from an assumed 20,000. The runtime
   forecasts from real post-payroll cash. The table above records the
   differences instead of forcing them to agree.
2. **Payroll timing.** The runtime pays 23,000 once on payday. The forecast
   then runs from cash after that payment, so that payday is not counted
   again. Later paydays are covered by the flat 9,000 weekly outflow:
   23,000 a month averages 5,307.69 a week, which leaves about 3,692 a week
   for rent, suppliers and utilities. A forecast that starts just after a
   payday and spreads the next paydays evenly is conservative: real cash
   before each later payday is higher than forecast, and about equal just
   after it. This is an approximation. There is no monthly cash schedule.
3. **Fixed costs 6,300, variable costs 27%, two-week headroom.** Not adopted.
   They are unvalidated assumptions.
4. **Payout timing, financing costs, opening debt, line room.** The runtime
   claims the cover when storm mode starts, before the payday draw, so the
   forecast's starting cash already includes the payout when it has landed.
   The mock credit line charges no interest or fees. Opening debt is not
   forecast. It reduces the draw through the line's unused limit. Line room
   and the per-event cap are both read from the chain.
5. **Cover tiers.** The current No.8+ mock stays: a fixed 20,000 per event.
   The event id is fixed when the storm starts, and a second claim for the
   same event is refused. There is no duration condition and no annual cap.
   Tiers would need event aggregation and annual-cap rules first. They are
   not adopted.
6. **Interest and fees.** They belong in explanatory models only. There is no
   lender quote and no HKMC guarantee.
7. **DEMO and TECHNICAL descriptions.** Reviewed on 19 October.
   [TECHNICAL.md](../submission/TECHNICAL.md) now says that the buffer is a
   target the credit cap can override. Its summary already limits the safety
   claim to the contract controls (registered payees, owners' caps) and gives
   the 1-of-100 red-team result next to it. [DEMO.md](../DEMO.md) is a run
   sheet and makes no cash-model claim.

## Limitations kept

- **The buffer is not guaranteed.** With the illustrative 22,000 post-payroll
  cash in [NONRUNTIME_FOLLOWUP.md](NONRUNTIME_FOLLOWUP.md), the forecast needs
  36,000. The storm plan's 15,000 cap leaves the projected low at (11,000),
  21,000 under the buffer. The 14 October Ragasa run drew the full 15,000 (row 25
  in [EVIDENCE.md](../EVIDENCE.md)). The agent never borrows past the cap. Raising
  the cap is an owner plan change with the 24-hour delay.
- **The forecast has no costs of credit.** Interest, fees, insurance premium
  and statutory employment costs are left out, and so is cover payout timing
  beyond what has already landed.
- **Weekly averages, not a cash calendar.** The forecast checks week-end
  balances and spreads monthly payroll evenly.
- **The insurance and pricing figures are not quotes.** The 20,000 benefit
  and the premium arithmetic in #33 are illustrations. A commercial next step
  is a broker or insurer quote.

## If a change is adopted later

Use a separate PR with expected results and regression tests for late cover,
cap-bound draws, nonzero opening debt and monthly paydays. Trace the change
through the policy, the plan book and its hash, owner approval and the
deployment. Do not rewrite signed terms or recorded evidence.
