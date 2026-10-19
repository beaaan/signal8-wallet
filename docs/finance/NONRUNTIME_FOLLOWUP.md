# Finance research follow-up

Prepared 14 October 2026. Base: PR #30, runtime
`24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82`. This contribution contains Markdown
research only. It adds no code, test harness, presentation or PDF, and changes
no signed policy/book, deployment or historical evidence.

## 1. Production forecast versus no storm

This calculation follows the current production forecast's dollar-sized
parameters and compares an ordinary path (zero disrupted weeks) with its
existing six-week disruption. It is an arithmetic review, not a newly shipped
forecast implementation. No RPC, model or financial transaction is involved.

Input cash is an explicit illustrative 22,000 mUSD: a fully funded 25,000 brace
plus 20,000 cover less 23,000 payroll. This is not asserted to be an original
live-run balance export. Both cases start at the same post-payroll point, unlike
the original workbook's pre-storm opening week. The normal case changes only
the disruption assumption for the comparison, not the production constant.

| Metric (mUSD) | No disrupted weeks | Existing six-week disruption | Disruption after 15,000 capped credit |
|---|---:|---:|---:|
| Opening cash | 22,000 | 22,000 | 37,000 |
| Lowest projected cash including opening | 22,000 | (26,000) | (11,000) |
| Credit/remaining funding need to the 10,000 floor | 0 | 36,000 | 21,000 |
| Week 13 cash | 35,000 | (19,000) | (4,000) |

This reproduces what the current arithmetic does. A 15,000 draw respects the cap
but does not guarantee the operating floor under these assumptions. The comparison
does not add interest, future monthly payroll cash scheduling or repayment flows
absent from that production forecast. Accounting adoption decisions remain #31.

- No storm: weekly net inflow is 10,000 - 9,000 = 1,000; week 13 cash is
  22,000 + 13 x 1,000 = 35,000. The minimum remains the opening 22,000.
- Storm: the first six weeks lose 8,000 each, so minimum cash is
  22,000 - 6 x 8,000 = -26,000. Need to the floor is 10,000 - (-26,000) = 36,000.
- The 15,000 cap leaves minimum cash -11,000 and a 21,000 shortfall to the floor.

These calculations do not establish the real-world adequacy of the assumptions
or adopt a change to the production forecast. No new test code is included.

## 2. Benefit sizing and indicative premium arithmetic

For this demo, retain the current 20,000 mUSD benefit until owners approve a
different product. It covers 20,000 / 23,000 = 86.96% of one monthly fixture
payroll, or about 3.17 weeks of B's assumed 6,300 fixed costs. Those ratios
describe the fictional shop; they do not establish insurability.

Swiss Re's historical Insur8 material gives 51 No.8+ typhoons in 1980–2016.
Using 51 / 37 = 1.378 events/year only as a historic-frequency scenario gives:

| Illustrative calculation | Annual mUSD |
|---|---:|
| Expected benefit, 20,000 times 51/37 | 27,567.57 |
| With an assumed 25% expense/risk loading | 34,459.46 |
| With an assumed 50% expense/risk loading | 41,351.35 |

The loading assumptions are ours, not an insurer's tariff. There is no annual
cap in this simple calculation. It omits event modelling, climate change,
location/exposure, insured-hours conditions, tax, distribution charges and actual
underwriting. A quoted annual premium cannot be inferred from this table.

The original 10,000 annual premium is not supported for the current unconditional
20,000-per-event No.8+ mock. A smaller benefit or rarer trigger could change cost,
but would need independent product modelling and owner approval before any code
change. No.8+ itself has a real insurance precedent. A commercial next step is a
broker/insurer quote for the chosen risk, benefit and event terms. No third party
has been contacted by this contribution.

Source: [Swiss Re Insur8, historical product material](https://corporatesolutions.swissre.com/alternative-risk-transfer/innovative-natcat-covers/insur8.html),
[2017 business report, p33](https://www.swissre.com/dam/jcr%3A0d7c8340-35d0-41ac-aa9d-d9a55c54928b/2017_business_report_en.pdf).
Historical frequency is not a current market price.

## 3. Business-loss research with defensible scope

### Hong Kong / Ragasa

SCMP's 25 September 2025 direct interview reports Bacaba's owner estimating at
least HK$3 million of damage to that restaurant. Use this as an attributed
individual case, not an audited claim settlement or citywide SME total. The
article does not establish the employer headcount needed to classify the whole
business formally as an SME. Do not convert or extrapolate it to the demo shop.

Source: [SCMP, Restaurants need millions for repairs after Ragasa](https://www.scmp.com/news/hong-kong/society/article/3326864/restaurants-need-millions-repairs-after-ragasa-lashes-hong-kong).

### Vietnam / Yagi

ILO's 13 December 2024 recovery assessment explicitly identifies financing and
debt-repayment difficulties for micro and small enterprises. Its quantitative
labour result is 2.3 million workdays lost in Q3 2024 across the assessed region,
not a currency loss total for SMEs. Do not relabel it as SME revenue lost.

Source: [ILO recovery assessment](https://www.ilo.org/resource/article/multi-sector-assessment-highlights-recovery-needs-typhoon-yagi-employment).
The [UNDP report landing page](https://www.undp.org/vietnam/publications/viet-nam-multi-sector-assessment-vmsa-report-typhoon-yagi-recovery)
sets out the assessment's coverage. The full English PDF exceeded the web
reader's size limit and direct download returned 403; no unseen table is claimed
as verified here.

### Recommended presentation wording

Use the restaurant case plus the documented microenterprise financing problem.
Do not promise a comparable aggregate SME-only money-loss statistic for both
storms when it has not been established. Owner acceptance of this narrower
evidence scope remains necessary if it replaces the card's original aggregate
request. The research work can be reviewed without changing payment code.

## Remaining ownership and runtime work

- #31: decided on 19 October 2026 in [DECISION.md](DECISION.md). The implemented
  model and the 20,000 benefit are kept; no proposal is adopted. Any later
  runtime change needs a separate approved implementation.
- #32: generator changes to dates, evidence assertions and unknown terms merged
  separately in PR #34 on 16 October 2026; the issue is closed.
- Translation review is documented separately, explicitly AI-assisted rather
  than an independent native-speaker or professional legal sign-off. As requested
  on 16 October 2026, independent native-speaker sign-off is not a
  prototype completion gate; no human language review is claimed.
- Team rehearsal, finance sign-off, arena URL and physical-phone test cannot be
  inferred from a research document. Presentation delivery remains with its
  assigned owners and is outside this contribution.
