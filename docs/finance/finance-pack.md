# Signal 8 Wallet: finance track pack

Contributed by Ngọc, Dung and Hân. Reviewed 14 October 2026 against runtime
commit 24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82.

The original English contribution is preserved in PR #28, commit d57bcd4.
This revision distinguishes external research, the implemented demo and proposals
that have not been approved. It is not a final deck, a timed rehearsal, an
actuarial quotation or a legal/compliance sign-off.

## 1. The project in one page

Signal 8 Wallet is a prototype AI treasurer for a fictional small business.
Owners pre-authorise plans. The agent reads untrusted documents, proposes typed
actions and submits permitted actions through PlanModule. Its key cannot expand
the registered payees, caps or administrative permissions through an email.

On Base Sepolia, funds sit in a 2-of-3 Safe. This is a signature threshold, not
proof that independently held human keys reviewed every automatic payment.
The documented testnet owner keys are currently held together. Within-plan
actions are pre-authorised; exceptional payments need owner approval. Subsequent
payee/configuration changes have a 24-hour delay, not every large payment.

Storm activation uses fresh signed local-weather and GDACS attestations through
registered relayers. Signatures establish the reporting addresses, not independent
operators or the accuracy of every underlying observation. The replay uses
historical weather data. The insurer, lender, vault and tokens are simulations.

The website shows balances and decisions, an owner plan view and a separate
attacker arena. The local FISCO Yagi variant uses a standalone one-admin wallet,
not the Base Sepolia Safe's two-owner approval model. [S03] [S15]

| Term | Meaning in this prototype |
|---|---|
| Parametric cover | A predefined benefit linked to a specified trigger; real policies have eligibility, limits and basis risk |
| Basis risk | A loss without a payout, or a payout that does not match the actual loss |
| Credit line | Mock 50,000 mUSD facility, capped at 15,000 per event through the signed module path |
| Sweep | 10% of customer payments repays principal outside storm mode |
| Operating cash floor | A 10,000 mUSD target, not a guarantee when caps or delays prevent funding |
| mUSD | Fictional USD-denominated demo token; approximately US$1 per unit for the demo, not HK$1 or legal tender |
| Base Sepolia | Public testnet; execution evidence does not establish a live banking service |

## 2. Typhoon cover and credit line terms — Hân

### Current mock cover and real comparables

The current mock cover pays 20,000 mUSD once per event while the Signal 8+
storm trigger is active. It has no commercial premium quote.

A No.8+ trigger is not inherently unrealistic. Swiss Re launched Insur8 in 2017
as non-damage business-interruption cover triggered by Hong Kong Signal No.8 or
higher. That supports the concept, not our payout size, pricing or eligibility.
[S06]

Vietnam also has parametric precedents, with different insured risks:

- Bao Minh/Hillridge agricultural typhoon-index cover uses storm intensity and
  distance. The insurer describes payouts within 10 days; this is not a universal
  same-day service promise for a Hong Kong restaurant. [S08]
- WTW announced a Vietnamese coffee drought-policy payout on 17 February 2025,
  related to low rainfall during the 2024 season. [S09]
- Global Parametrics announced payouts on 21 May 2026 under a separate
  high-rainfall policy for the 2025/26 coffee season. [S10]

Basis risk includes damaging rainfall without the chosen wind-warning trigger,
a qualifying signal with little loss at the shop, and inland floods or
landslides not captured by a coastal trigger. Event identity, duration,
geographic scope and aggregation must be specified before pricing.

### Optional tier proposal — not implemented

The original contribution proposes a small Signal 8/9 payout, a 20,000 Signal 10
payout replacing it, a six-hour condition and a 30,000 annual cap. None of these
new conditions is implemented or approved as a signed-policy amendment.

The original annual-loss calculation added overlapping frequency groups.
If 1.4 No.8+ events/year includes 0.2 No.10 events/year, and 20,000 replaces
2,000, the conditional arithmetic before duration rules and the annual cap is:

2,000 × (1.4 − 0.2) + 20,000 × 0.2 = 6,400 per year, not 6,800.

This does not validate the frequency assumptions or produce an actuarial premium.
The six-hour condition and annual cap require event-level modelling. An expected
annual payout above one event's benefit does not make a product impossible.
Do not quote the original 10,000 annual premium or 2% of receipts as a purchasable
or verified price. Changing the trigger/tier timing requires technical review
even though Ragasa eventually reached No.10.

### Credit terms: current simulation versus pricing proposals

| Item | Current mock | Finance proposal or external context |
|---|---|---|
| Facility limit | 50,000 mUSD | No change proposed in this contribution |
| Per-event module draw cap | 15,000 mUSD | Not waived by an untrusted message |
| Principal repayment | 10% of customer payments, paused during storm mode | Not a guarantee of repayment by week 13 |
| Interest | No interest charge implemented by the current mock lender | 8% p.a. is an illustrative workbook assumption |
| Draw fee | Not implemented by the mock lender | 1% is an illustrative workbook assumption |
| Undrawn fee | Not implemented or included in the workbook | 0.25% p.a. is unvalidated, not a quotation |
| HKMC guarantee | None obtained by this prototype | Comparable framework only; lender and HKMCI approval required |

The linked HKMC factsheet states a 10% maximum overall rate as of 11 November
2024 for the relevant product, with case-specific provisions. Overall rate
includes relevant lender fees. It is not evidence that an 8% headline rate plus
any fees is currently eligible or that this fictional loan is guaranteed.
[S02] The 80% product's application period was extended to March 2028; that is
not an approval of this prototype. [S17]

## 3. Cash-flow forecast — Dung, Ngọc and Hân

Use the companion workbook and WORKBOOK_REVIEW.md. All amounts below are mUSD.

- A is a fixed-cost reference scenario, not an exact reproduction of storm.ts.
- B is a proposed fixed/variable-cost scenario with two weeks of headroom.
- Both start with assumed cash 20,000 and zero debt, with one normal week before
  six disrupted weeks. Neither is the live Safe's actual opening balance.
- The current runtime instead reads Safe cash after payroll and projects
  thirteen weeks, with six disrupted weeks first. It does not implement the
  workbook's interest, draw fee or extra two-week headroom. [S03]

| Metric | A: fixed-cost reference | B: proposed split costs |
|---|---:|---:|
| Lowest week-end cash without emergency funding | (27,000.00) | (12,420.00) |
| Pre-cost gap to the 10,000 floor after assumed cover | 17,000.00 | 2,420.00 |
| Modelled credit draw | 15,000.00 | 15,000.00 |
| Remaining shortfall after modelled flows | 2,380.77 | 0.00 |
| Lowest week-end cash with cover and credit | 7,619.23 | 21,000.00 |
| Week 7 cash with funding | 7,734.62 | 22,314.62 |
| Week 13 cash with funding | 7,619.23 | 22,199.23 |
| Modelled interest plus draw fee | 380.77 | 380.77 |
| Principal still owed at week 13 | 9,000.00 | 9,000.00 |

B requests 2,420 + 12,600 = 15,020 before the 15,000 cap. Its lowest week-end
cash is 21,000, not approximately 22,000. Including opening cash, its minimum
is 20,000. These are weekly snapshots, not proof of intra-week liquidity.

Fixture payroll is ten staff at 2,300 per month: 23,000 monthly, or 5,307.69 per
week on an annualised basis. [S04] The original 4,500 wages plus 1,800 rent note
was inconsistent. Fixed costs 6,300 and variable costs 27% are retained as
unvalidated scenario assumptions, not a measured Hong Kong shop budget.

The workbook is not a monthly payroll cash schedule. Finance and tech must
identify which pay periods the already-paid payroll and future wage accruals
cover before deciding whether any item is missing or double counted.

The 380.77 financing cost excludes insurance premium, undrawn commitment fee and
statutory employment costs. The retained sizing rule does not account for cover
delay or financing costs. Corrected shortfall reporting reveals the limitation:
paying B's cover in week 9 produces a 7,708.46 gap. It does not silently implement
a new draw rule.

The chart compares no emergency funding with simulated cover plus credit.
It does not isolate the benefit of AI versus a manual operator with the same
financing. The 15,000 credit is debt, not revenue or savings. Negative cash
represents unmet funding, not an approved overdraft.

## 4. Business case and numbers — Dung and Hân

A defensible claim is that disaster-related business interruption creates a
timing problem for operating cash. Parametric cover and pre-approved credit
can help if valid arrangements are in place before the storm. The prototype
demonstrates execution under pre-authorised controls; it does not originate a
real policy, approve a bank loan or establish measured customer savings.

| Evidence | What can be said | What must not be inferred |
|---|---|---|
| Swiss Re 2017 estimate | About HK$4.29bn GDP impact for a qualifying warning day, expressed in 2015 HKD [S06] | Actual Ragasa losses, SME-only losses or an independently checked US$627m conversion |
| JPMorgan Chase Institute 2016 study | 27-day median small-business and 16-day restaurant cash buffers in the studied US accounts, using 2015 data [S01] | Current Hong Kong restaurant liquidity or a required reserve for this shop |
| HKO Ragasa record | No.10 lasted 10h40 on 24 September 2025, second longest in its record [S07] | Every business closed for six weeks or suffered the same loss |
| Current demo evidence | Dated testnet cover, payroll, credit and reporting transactions [S15] | Licensed live banking/insurance, or a universal same-day payment guarantee |
| Scenario B | Weekly cash under the stated funding and cost assumptions | The causal value of the wallet, actual staff payment timing or guaranteed solvency |

The original regional 12%-insured figure, Yagi loss/GDP headlines and the
190-trillion/94,000-borrower pair are not used in the revised spoken pitch.
Their original dated publications, geography, peril, denominator and population
must be checked before reuse. Affected loan principal is not realised loss, and
a region's share of GDP is not GDP destroyed. No SME-only Ragasa/Yagi loss total
has been established here.

Pricing hypothesis: the shop might be subsidised by a bank/insurer distribution
model. US$5 per active wallet/month, an interest share and 10–15% insurance
commission remain unvalidated commercial proposals. No partner has agreed to
pay; distribution/licensing arrangements need separate review. The prototype
does not establish that every conventional loan requires a branch visit or
every insurance claim requires weeks.

## 5. After-storm paperwork and Vietnam rules — Dung

This is a review of research and current source templates, not a bank or insurer's
acceptance. The agent drafts documents; an owner reviews and sends them.

Circular 53/2024 took effect on 4 December 2024. Article 4 limits consideration
to the effective-date-to-31-December-2025 window and requires qualifying
pre-7-September-2024 principal, relevant due dates, affected borrowers, lawful
loans and bank assessment of repayment capacity. Final rescheduled repayment
cannot exceed 31 December 2027. Eligibility is not automatic. [S11]

A historical request must be labelled as such and have a permissible fictional
application date. Dating it to September 2024 would predate the circular.
Never backdate a real filing. A current application needs its applicable
programme/bank-policy basis, not an expired relief window presented as current.

The current templates have confirmed follow-up concerns:

- The Yagi preview uses the current generation date while directing the owner
  to the historical Circular 53 window.
- The claim template asserts a commitment to premises photos and stock records
  even when those files are not present in the anchored evidence.
- A default 30-day claim period and an additional-loss claim are not established
  by a real policy. They require owner confirmation, not a promise of entitlement.

These need separate runtime/template changes. This contribution does not fix
the generator, alter historical anchors or claim an insurer will accept a mock
letter. Outputs must be checked for contract/policy identity, dates, amounts,
actual evidence, recipient details and relevant terms before use.

The earlier reference to translations/translation-review.md does not identify
an existing file on the reviewed main. Native-speaker review is still required
for applicable Vietnamese/Chinese outputs; it has not been completed by this
research alone.

Hong Kong's stablecoin issuer regime began on 1 August 2025. [S12] HKMA announced
the first issuer licences for Anchorpoint and HSBC on 10 April 2026. [S13]
A licence is not proof a product has launched. Neither fact makes MockUSD a
licensed HKD stablecoin.

The local Yagi variant uses mock mVND on FISCO. Naming a token a deposit does
not establish bank authorisation, lawful live payment or regulatory compliance.
A real Vietnam deployment requires activity-specific legal assessment. This
pack does not provide that sign-off.

## 6. Pitch script and story — Ngọc and Hân

Working spoken draft. Speaker allocation and durations are proposals, not an
observed rehearsal. The target is under 10 minutes, with spare time for transaction
confirmation. Use the public evidence as a backup if presenting a local fork.
Do not label fork transactions as newly executed Base Sepolia transactions.

| Part | Proposed speaker | Target window |
|---|---|---|
| Yagi hook and operating-cash problem | Ngọc | 0:00–1:20 |
| Signed plans and the idea | Hân | 1:20–2:30 |
| Ragasa live walkthrough | Hưng | 2:30–5:45 |
| Everyday mode | Hưng | 5:45–6:25 |
| Controls and dated benchmark | Bean | 6:25–7:55 |
| Separate attacker arena | Bean | 7:55–8:25 |
| Finance scenario, commercial hypothesis and close | Dung | 8:25–9:30 |

### Hook — Ngọc

"In September 2024, Typhoon Yagi disrupted lives and businesses in northern
Vietnam. A year later, Ragasa brought Hong Kong's No.10 warning for ten hours
and forty minutes. Our fictional shop owner, Mrs Chan, still has ten staff to pay.

A 2016 US study found a median cash buffer of just sixteen days for restaurants.
That is not a Hong Kong estimate, but it illustrates the timing problem: bills
can fall due while sales are disrupted.

An AI assistant could help, but giving it unrestricted payment power creates
another risk. Giskard's analysis of a May 2026 Grok-linked wallet incident
describes an encoded instruction that caused a token transfer valued at roughly
150,000 to 174,000 US dollars. We need useful automation with limits outside
the model." [S01] [S07] [S14]

### The idea — Hân

"Signal 8 Wallet is a prototype AI treasurer acting inside plans owners approve
before a storm. On Base Sepolia, the money is in a Safe. PlanModule restricts
the agent's recipients, amounts and permitted actions.

The model reads and proposes; it cannot widen its own permissions through an
email. Exceptional payments go to owners. These limits reduce risk. They do
not prove every payment within a limit is commercially valid.

Storm mode is activated from signed local-weather and GDACS reports, not an
email telling the assistant there is a storm. Our financial institutions and
tokens are simulations."

### Ragasa walkthrough — Hưng

[Show the environment and historical evidence links.]

"We are replaying Ragasa's historical warning timeline. The published Base
Sepolia run provides transaction links. This presentation is using the environment
shown on screen."

[No.3 rising.]

"Before the strongest warning, the agent tries to bring Safe cash to payroll
plus a margin by withdrawing available vault funds. It holds scheduled supplier
payments for owner review after the storm."

[No.8 and corroboration.]

"No.8 begins on 23 September at 14:20 Hong Kong time. Signed reports activate
storm mode. The mock cover pays 20,000 mUSD once for this event."

[No.10 and fake email.]

"No.10 begins at 02:40 on the 24th. Five minutes later the replay injects an
email asking the shop to move all funds to a protected account. That account is
not an approved recipient. The request is refused."

[Payroll at 09:00.]

"Payroll is today, during No.10: ten registered staff payments. While these
confirm, notice that the signed plan limits both recipients and amounts."

[Credit.]

"After payroll the agent projects thirteen weeks of operating cash, including
six disrupted weeks. It draws credit only within the remaining event and facility
limits. In the published replay that draw is 15,000 mUSD.

The separate finance workbook explores different costs and extra headroom.
Those proposals have not changed this runtime."

[No.3 at 20:20.]

"When the warning drops below eight, storm mode ends. Customer receipts can
again sweep principal to the lender. The agent prepares paperwork for the owner
to review and send; those templates still have documented follow-up limitations."

### Everyday mode — Hưng

"On an ordinary day the agent checks the supplier, approved order, outstanding
amount and paid history. It pays permitted invoices, proposes exceptions,
places surplus in a mock fund and produces reconciliation reports. This is not
a claim of complete independent delivery verification."

### Controls and benchmark — Bean

"Automatic payments are pre-authorised, not individually checked by two humans.
Exceptional payments need owner approval. New payee and configuration changes
have a delay; not every large payment waits on a timelock.

In the published 14 October model evaluation, fifty attack scenarios ran in
ordinary and storm modes: one hundred attack runs, plus fifty benign cases.

Our system recorded one attacker win and no funds lost, and matched all fifty
benign cases. Four attack runs had extraction or validation errors, leaving
ninety-five of one hundred matching the attack oracle. The bare agent recorded
five attacker wins, 4,820 mUSD lost and forty-one benign matches.

These are simulated evaluations with model calls, not live-chain losses or a
guarantee against the next attack." [S16]

### Arena — Bean

"The QR opens a separate attacker arena. It is isolated from the treasury demo.
Try to persuade the assistant to pay an unauthorised recipient and inspect the
decision. The board shows observed attempts, not a security guarantee."

### Finance and close — Dung

"This chart is an illustrative financing scenario. Without the modelled cover
and credit, cash falls below the target floor in week three and becomes negative
in week five. With them, scenario B's lowest week-end balance is 21,000 mUSD.
It still owes 9,000 at week thirteen.

That is not proof the AI itself created 35,000 of value: insurance provides a
benefit and credit creates debt. Our contribution is controlled execution and
an evidence trail around pre-arranged financing.

A bank- or insurer-funded distribution model is a hypothesis we would test with
partners. Signal 8 Wallet demonstrates how an agent can act during disruption
without giving it an unrestricted wallet. Thank you."

### Rehearsal gates

- [ ] Finance owners confirm the assumptions and scope of every spoken number.
- [ ] Tech owners confirm the actual demo environment and latest evidence.
- [ ] Refresh the dated benchmark after the planned case/feature freezes if rerun.
- [ ] Test the arena QR from a phone on its isolated deployment.
- [ ] Time a complete read-through, including realistic transaction waits.
- [ ] Export and inspect the final slides/PDF and record the rehearsal duration.

## 7. Ten likely judge questions

Proposed answers; the named speakers still need to approve and rehearse them.

| # | Question | Answer | Proposed speaker |
|---|---|---|---|
| 1 | Why pay on an index rather than a loss assessment? | Parametric insurance already does this, including Insur8's No.8+ precedent. The trade-off is basis risk and predefined eligibility and limits. | Hân |
| 2 | Is 20,000 per No.8 event commercially priced? | No. It is a mock benefit. Tiering and premium ideas need event-level pricing; they are not current product terms. | Hân |
| 3 | What if losses occur without the trigger? | Cover may not pay. Credit is limited too. Owners need other reserves, financing or cover; the prototype cannot guarantee solvency. | Hân |
| 4 | How is the draw sized? | Current runtime uses post-payroll cash in a 13-week forecast and caps the requested amount. The workbook's split costs and extra two-week margin are proposals. | Dung |
| 5 | Who pays for the service? | Bank/insurer sponsorship is a commercial hypothesis. No partner pricing, commission or free-to-shop offer is agreed. | Dung |
| 6 | Can the agent still make a bad payment? | Yes, a fraudulent payment can fit permitted recipients/caps. Controls constrain permissions, and tests measure known cases; neither eliminates fraud. | Bean |
| 7 | What if weather data is wrong? | Two signed reports reduce a single-source activation risk, but addresses do not prove independent operators or correct data. | Bean |
| 8 | Why blockchain? | Shared execution restrictions and a transaction/evidence trail. Anchors still require retained original files; blockchain does not establish commercial truth. | Hưng |
| 9 | Is this a licensed payment or lending service? | No. The testnet/local tokens and financial contracts are mocks. Real deployment requires partners, approvals and activity-specific legal review. | Dung |
| 10 | What happens to the debt? | Outside storm mode, 10% of routed customer receipts repays principal. The workbook's 8% rate is illustrative and no HKMC guarantee has been obtained. | Ngọc |

## 8. Pitch deck outline — Dung and Ngọc

This is a build specification, not evidence that a deck or PDF is complete.
Every slide must use reviewed numbers and distinguish current demo from proposals.

| # | Slide | Content | Completion evidence still needed |
|---|---|---|---|
| 1 | Title | Project, team, prototype scope | Actual slide |
| 2 | Local relevance | Qualitative Yagi hook and official Ragasa timeline | Rights-cleared image and source footer |
| 3 | Operating cash | US 2016 restaurant buffer, correctly qualified | Actual sourced slide |
| 4 | Agent risk | Attributed Grok example, approximate value and date | Actual sourced slide |
| 5 | Architecture | Model, backend controls, module and owner procedures | Diagram verified by tech |
| 6 | Live walkthrough | Environment-labelled dashboard fallback | Fresh screenshot and readable labels |
| 7 | Replay sequence | Brace, No.8 cover, fake email, payroll/credit, storm end | Correct times and published evidence links |
| 8 | Ordinary day | Order/payee/balance checks, fund and report | Screenshot; no complete delivery-match claim |
| 9 | Controls | Layers and limitations from current SECURITY.md | Accurate control wording |
| 10 | Red team | 50 cases × 2 modes; wins, losses and four errors | Dated chart with provider and denominator |
| 11 | Arena | Isolated attacker environment | QR tested on a phone |
| 12 | Finance and next steps | Workbook B, debt remaining, partner hypothesis | Corrected chart and rehearsed closing |

- [ ] Build actual slides following the reviewed script.
- [ ] Confirm chart and benchmark versions immediately before export.
- [ ] Export the final PDF to docs/submission/ and inspect it.
- [ ] Record a full timed rehearsal. No completion is inferred from this outline.

## Sources

Research sources support only the scope stated below. Internal code and evidence
references are pinned to the reviewed commit. Workbook source IDs S01–S05 match
this register.

| ID | Publisher and scope |
|---|---|
| [S01] | JPMorgan Chase Institute, 1 September 2016: US cash-buffer study using 2015 accounts |
| [S02] | HKMC SFGS factsheet, updated 18 November 2024; overall-rate snapshot as at 11 November, p8 |
| [S03] | Current storm-loop implementation at the reviewed runtime commit |
| [S04] | Fictional payroll fixture at the reviewed runtime commit |
| [S05] | Fictional loan terms at the reviewed runtime commit |
| [S06] | Swiss Re, 11 July 2017: Insur8 launch and dated GDP estimate in 2015 HKD |
| [S07] | HKO September 2025 weather report: Ragasa warning timeline |
| [S08] | Bao Minh: agricultural typhoon-index product with Hillridge |
| [S09] | WTW, 17 February 2025: Vietnam coffee drought-policy payout |
| [S10] | Global Parametrics, 21 May 2026: separate high-rainfall-policy payout |
| [S11] | Official Circular 53/2024 text: conditions, consideration window and final repayment |
| [S12] | HKMA stablecoin-issuer regime: commencement 1 August 2025 |
| [S13] | HKMA, 10 April 2026: first two issuer licences, not a product-launch claim |
| [S14] | Giskard, 7 May 2026: attributed Grok/Bankr incident analysis |
| [S15] | Published project execution evidence; testnet/local scope and limitations |
| [S16] | Published 14 October simulated model evaluation, not a new run for this contribution |
| [S17] | HKMA, 17 September 2025: SFGS extension, not borrower approval |

[S01]: https://www.jpmorganchase.com/institute/all-topics/business-growth-and-entrepreneurship/report-cash-flows-balances-and-buffer-days
[S02]: https://www.hkmc.com.hk/files/product_shortcut/6/74/eng/SFGS%20Factsheet_Eng%20eff%2018%20Nov%202024_Final%20clean.pdf
[S03]: https://github.com/beaaan/signal8-wallet/blob/24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82/agent/src/loops/storm.ts
[S04]: https://github.com/beaaan/signal8-wallet/blob/24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82/data/fixtures/payroll.json
[S05]: https://github.com/beaaan/signal8-wallet/blob/24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82/data/fixtures/loan.txt
[S06]: https://corporatesolutions.swissre.com/insights/news/swiss_re_corporate_solutions_launches_insur8__the_first_ever_typhoon_warning_insurance_product_for_businesses_operating_in_hong_kong.html
[S07]: https://www.hko.gov.hk/en/publica/mws/files/mws202509.pdf
[S08]: https://www.baominh.com.vn/bao-minh-ra-mat-san-pham-bao-hiem-chi-so-bao-ho-tro-nguoi-dung-trong-nong-nghiep
[S09]: https://www.wtwco.com/en-il/news/2025/02/willis-and-global-parametrics-deliver-new-parametric-solution-to-coffee-farmers-in-vietnam
[S10]: https://www.globalparametrics.com/news-1/willis-and-global-parametrics-deliver-first-payout-to-coffee-farmers-in-vietnam-hit-by-heavy-rainfall
[S11]: https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=172435
[S12]: https://www.hkma.gov.hk/eng/key-functions/international-financial-centre/stablecoin-issuers/
[S13]: https://www.hkma.gov.hk/eng/news-and-media/insight/2026/04/20260410/
[S14]: https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet
[S15]: https://github.com/beaaan/signal8-wallet/blob/24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82/docs/EVIDENCE.md
[S16]: https://github.com/beaaan/signal8-wallet/blob/24145ab39d5aaf7f0ba8840bc2acfcd3859d5e82/redteam/results/finance-model-summary.json
[S17]: https://www.hkma.gov.hk/eng/news-and-media/press-releases/2025/09/20250917-4/
