# Finance contribution review

Reviewed 14 October 2026 against main/runtime
`24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82`. The original English contribution is
preserved in PR #28 / commit `d57bcd4`. Workbook corrections are PR #29, based
on that import. This documentation revision is stacked on the workbook branch.

## Scope and evidence

The supplied Markdown and five-sheet XLSX were reviewed alongside six project
task cards, the storm loop, payroll/loan/replay fixtures, draft templates and
published evidence/model results. Research references and their permitted scope
are in the finance pack; input/model references also travel with the workbook.

The contribution is shared. Task assignees are recorded, but an individual
percentage of authorship or completion is not inferred from the common file.
No final presentation, timed read-through or native-speaker sign-off was supplied.

Update, 16 October 2026: the requested review scope does not require independent
native-speaker sign-off as a prototype completion gate. The supplied
[translation review](../../translations/translation-review.md) is AI-assisted;
no human review or professional legal approval is claimed.

## Findings addressed in the finance documentation

| Finding | Correction |
|---|---|
| No.8 cover described as not a real product | Real Insur8 No.8+ precedent retained; optional tiers labelled unimplemented |
| Overlapping payout frequencies added together | Conditional replacement-tier arithmetic shown; no premium validated |
| 8%/fees and HKMC eligibility presented as current terms | Mock implementation, pricing assumptions and real lender approval separated |
| Reference workbook labelled current runtime | Cash origin, periods, payroll timing, costs and headroom differences documented |
| A shortfall understated; B minimum conflated with week 13 | Workbook PR #29 reports 2,380.77 and distinguishes 21,000 from 22,199.23 |
| US cash-buffer study presented without geography/date | Source identified as JPMorgan 2016 using US 2015 accounts |
| HK$4.29bn treated as current Ragasa/SME loss | Qualified as Swiss Re's 2017 economy-wide estimate in 2015 HKD |
| Unsupported 12%/loss/GDP/affected-loan headlines | Removed from spoken pitch pending original-publication verification |
| Financing chart treated as causal wallet savings | Funding/debt assumptions and lack of same-financing manual counterfactual stated |
| Safety, floor, timelock and delivery claims overstated | Permissions, owner approval, configuration delay and actual checks described |
| Old 43/15 and 86-run benchmark | Published 50/50 corpus, 100 attack runs and four errors recorded honestly |
| Fake-email amount/order and payday differed from replay | Script uses actual fixture times, all-funds email and same-day payday |
| Stablecoin licence confused with prototype authorisation | Regime/licence dates separated from product launch and mock-token status |
| Outline and draft timings implied completed artifacts | Actual slide/PDF, phone-QR and timed rehearsal gates remain open |

The research does not validate a market insurance premium, a lender's quotation,
an SME-only disaster loss estimate, regulatory approval or future attack safety.

## Source-template reproduction: confirmed follow-up, not fixed here

Command run from agent/ on the reviewed runtime, using pure preview templates:

```text
npx tsx src/drafts.ts --event yagi-2024 --out <temporary-review-directory>
```

No model or blockchain calls. The generated preview is not evidence of a live
run, a real insurance policy or a real filing. Source output facts:

- The Circular 53 request is dated 2026-10-14, although it directs the owner to
  the historical consideration window ending 2025-12-31.
- The English claim is dated 2026-10-14 but calculates its default claim deadline
  as 2024-10-08, without describing the expired deadline as historical.
- PRE_STORM evidence is shown as absent, with no anchor transaction, but the
  prose still asserts a commitment to premises photos/stock records and the
  availability of original files.
- The template asserts a default 30-day period and claims additional losses
  without a real policy establishing that deadline or coverage.

The storm-loop source can hash a record with an empty photo list. A hash does
not prove that underlying photos exist. These are generator/wording findings,
not a reason to rewrite old signed evidence or claim that a bank rejected a file.

## Decisions and unresolved work

Finance/tech must decide whether to adopt B's cost model, extra headroom,
insurance tiers or pricing; none is adopted by this contribution. Reconcile
post-payroll cash, weekly accruals and monthly cash periods before claiming
runtime equivalence. Tracked in [issue #31](https://github.com/beaaan/signal8-wallet/issues/31).

Update, 19 October 2026: decided in [DECISION.md](DECISION.md). The implemented
model is kept, none of the proposals is adopted, and the workbook is mapped to
the runtime there. The DEMO/TECHNICAL consistency pass is recorded there too.

The after-storm generator findings above record the 14 October baseline.
Their separate correction merged in [PR #34](https://github.com/beaaan/signal8-wallet/pull/34)
on 16 October 2026, closing [issue #32](https://github.com/beaaan/signal8-wallet/issues/32).
This documentation PR does not implement or independently re-verify that fix.

The separate existing DEMO.md and TECHNICAL.md may also need a consistency pass
for source attribution and absolute safety language. They are outside this
finance-pack correction and have not silently been changed.

## Task acceptance still outstanding

| Task | What the contribution supplies | Still required for completion |
|---|---|---|
| Typhoon cover and credit line terms | Qualified comparables, mock/proposed terms and basis risk | Finance acceptance of the chosen demo terms; no actuarial quote invented |
| Cash-flow forecast for the Ragasa storm | Reviewed workbook, chart and shortfall tests | Agreed assumptions and decision about alignment with the agent's draw model |
| Business case and numbers for the deck | Qualified claims and pricing hypothesis | Owner acceptance and handoff to actual slides |
| After-storm paperwork and Vietnam rules check | Legal-window research, AI-assisted translation review and generator correction tracked in PR #34 | Accurate supplied facts and applicable term checks; independent native-speaker sign-off is not a prototype completion gate |
| Pitch script and story | Working script, speakers and Q&A | Team approval and a timed complete read-through under 10 minutes |
| Pitch deck | Reviewed build outline | Actual deck, screenshots, phone-tested QR and inspected submission PDF |

Neither PR creation nor research alone establishes all six tasks are Done.

## Verification

- Runtime tree, policy, signed plan books/hash, contracts, deployments and
  historical evidence are unchanged from the reviewed base.
- Existing agent typecheck and 32-file / 410-test regression passed on the
  workbook predecessor. The final docs branch repeats the checks before push.
- The published model benchmark was read, not rerun. Its four extraction/
  validation errors remain in the 100 attack-run denominator.
- No real payments, new chain execution, paid model run or external filing.
- XLSX native Excel/Sheets interaction and actual presentation delivery remain
  unverified; the workbook review states its computation-engine coverage.
