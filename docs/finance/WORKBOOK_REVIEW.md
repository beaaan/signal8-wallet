# Cash-flow workbook review

Reviewed 14 October 2026 against runtime commit
`24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82`. Original contribution: PR #28,
commit `d57bcd4`. The original supplied files are unchanged. The import omits
the live Google Sheet URL for privacy and preserves the original workbook bytes.

## Scope

Correct shortfall reporting, scenario/period/unit labels and the chart. Preserve
all numeric input assumptions, the five-sheet structure and the draw-sizing
algorithm. This workbook is a weekly scenario model, not a literal replay of
agent cash movements or an approved insurance/credit product.

## Results

Amounts are mUSD demo units. Values below are rounded for presentation only.

| Metric | A: fixed-cost reference | B: proposed split costs |
|---|---:|---:|
| Lowest week-end cash before funding | (27,000.00) | (12,420.00) |
| Credit draw | 15,000.00 | 15,000.00 |
| Remaining shortfall, old label/calculation | 2,000.00 | 0.00 |
| Remaining shortfall after modelled flows, corrected | 2,380.77 | 0.00 |
| Lowest week-end cash with funding | 7,619.23 | 21,000.00 |
| Week 7 cash with funding | 7,734.62 | 22,314.62 |
| Week 13 cash with funding | 7,619.23 | 22,199.23 |
| Modelled interest plus draw fee | 380.77 | 380.77 |
| Principal outstanding at week 13 | 9,000.00 | 9,000.00 |

`Forecast_A!R9` now uses
`=MAX(0,Inputs!$B$11-MIN(Inputs!$B$4,M5:M17))`, with column C for B.
It checks opening cash and the lowest modelled week-end balance after cover,
capped credit, fees, interest and repayments. `Summary!B7:C7` links to it.
The week-end minimum remains `MIN(M5:M17)` and does not claim intra-week coverage.

## Retained assumptions and limitations

- Opening cash 20,000 and zero opening debt are assumptions, not live balances.
- Runtime forecasts from the Safe balance after payroll. This workbook starts
  one normal week before six disrupted weeks and models weekly costs/fees.
- Monthly fixture payroll is 23,000. Its annualised weekly average is
  5,307.69, not the original note's 4,500. This is not a monthly cash schedule.
- Fixed costs 6,300 and variable costs 27% remain unvalidated aggregate proposals.
  No market rent or ingredient cost is inferred from the residual.
- Sizing still offsets cover against the minimum without its payout timing or
  financing costs. The corrected shortfall reveals, rather than fixes, that gap.
- Interest is opening debt times 8% / 52. Draw-week interest is zero under the
  existing model. The 1% draw fee is illustrative; no lender quote is claimed.
- Insurance premium, undrawn commitment fee and statutory employment costs are
  excluded. The 380.77 figure is not an all-in product cost.
- The floor is a target. A cap, delay or lower starting cash can breach it.
- Negative cash means unmet funding, not an agreed overdraft. The chart compares
  funding scenarios and does not isolate the causal value of AI automation.
- Inputs carries the source/assumption register, including source dates and scope.

## Sensitivity evaluation

Change one B input at a time, recalculate, then restore it. These are computed
scenario results, not additional historical observations or live-chain runs.

| Input change | Credit draw | Lowest week-end cash | Corrected remaining shortfall |
|---|---:|---:|---:|
| No two-week headroom (`C16=0`) | 2,420.00 | 9,951.28 | 48.72 |
| Total line 1,000 (`C15=1000`) | 1,000.00 | 8,560.77 | 1,439.23 |
| Cover paid week 9 (`C13=9`) | 15,000.00 | 2,291.54 | 7,708.46 |
| Opening cash 5,000 (`C4=5000`) | 15,000.00 | 6,000.00 | 5,000.00 |

## Verification

Recalculated using the bundled artifact-tool spreadsheet engine; independently
checked the underlying arithmetic against the original inputs and saved outputs.
Valid shared-formula followers in the Google-exported source were expanded in
memory before recalculation because the importer otherwise kept cached followers.
That import limitation is not an original workbook defect.

The saved XLSX retains every original calculation except the two R9 formula
changes, all numeric Inputs values, the five sheet names and one formula-bound
three-series line chart. The corrected chart uses straight segments. Exported
values, chart bindings and absence of saved formula errors are checked after
saving. All five sheet previews were rendered for visual review.

Native Excel/Google Sheets interactive recalculation has not been verified in
this contribution. Saved-value CSV checking is not a calculation engine.
Runtime, signed policy/book/hash, contracts, deployment and historical evidence
are unchanged. Product/model decisions are tracked in [issue #31](https://github.com/beaaan/signal8-wallet/issues/31).
