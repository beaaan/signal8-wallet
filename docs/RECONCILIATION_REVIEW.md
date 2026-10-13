# Daily report and reconciliation review

Reviewed on 13 October 2026. Runtime under review: `443edcd9ae2d013b3f465bbbdaa6b8a3e3dbb96e` (PR base).
This contribution changes documentation and simulated tests only. It does not repair runtime behavior.

## Evidence reviewed

| Evidence | Network/run | What was verified | Limitations |
|---|---|---|---|
| `agent/logs/report-2025-09-22-demo-local.json`, `run-demo-local.json` and matching entries in `decisions.jsonl` | Anvil, chain 31337, `demo-local`; wall-clock 9 October 2026, simulated business date 22 September 2025 | Joined successful ordinary-day events by full transaction hash; compared report/run/log descriptions; recomputed report content hash | Historical local files are ignored by Git; no fresh chain query, receipts or opening snapshot were obtained |
| `docs/EVIDENCE.md` | Base Sepolia, chain 84532, run `1791607899`, completed 10 October 2026 | Read published deployment and execution references and the documented earlier stale-read failure | **Not verified:** original matching report, run file, decision-log export and anchor payload/receipt are absent; published references alone do not verify the report |
| Production implementation and `agent/test/reconciliation-review.test.ts` | Runtime commit above; rules provider; simulated chain/RPC | Real `runEveryday` serializer, pipeline, inflow watcher, reconciliation and consistency transport exercised with mocked chain boundaries | Not a live-chain execution or a model benchmark; simulated sink does not prove EVM execution |

Local file SHA-256 digests at review time:

| File | SHA-256 |
|---|---|
| Local report | `99dd232e8883316a79f4904a17af4286effe8ec09c1f774935fadb082ee41b15` |
| Local run | `3cf00e311c0cb40202ad46fd6da07f8278b08a3000e4259016489b59a782f25d` |
| Shared decision log | `69e2b9a12c410f5ada7ad53f14e0d2c938e2dec61f7a4b0da12b58aff1c06c7a` |
| Published evidence document | `86c9cd947242975f8acdc59fd805e9b6a4326574d7623b1d0cc46054a32afa5f` |

These identify reviewed file bytes, not blockchain verification. The shared log contains other runs; it was not treated as one run's ledger.

### Local join and historical amounts

| Event | Full transaction hash shared by run/log/report | Historical amount or content |
|---|---|---|
| Customer receipt | `0x6bb28bed104905ba14d5b9864c5e8a955a9788f7852d23b82b34642426871d95` | Gross 8,000 mUSD; repayment sweep 0; invoice `INV-C-2025-09-22` |
| Lee Kee Flour payment | `0x0f60c3e2f33be4034b27c3c79e70a51c6a00ce9e89261338789f7ada9b902849` | 1,250.50 mUSD; `LK-0921#demo-local`; supplier name in run/log, not a structured recipient in report |
| Vault deposit | `0x455ded20565eb6e46946081891a4eeb2b5fae45128831fa4ac671d44671841b3` | 46,749.50 mUSD asset transfer |
| Report anchor | `0x69da8166973fc507a69e88d3b11f6dd424ce616b589a469c0cdca115d24a75b0` (run/log only) | Recomputed canonical report hash `0xb9d382898f2758fed0c6eb46b917960dd11e53a98baa99370ced83432d11bca9`; agrees with the recorded **prefix**, not a verified on-chain full hash |

The matching log timestamps are 18:27:18.948Z, 18:27:22.998Z, 18:27:23.157Z and 18:27:23.216Z on 9 October 2026. No-transaction refusal/reconciliation lines cannot be uniquely joined by transaction; report fields and current-code tests establish those behaviors instead.

The report records closing Safe 10,000, vault 46,749.50 and outstanding credit 0 mUSD. It holds a later-due 1,400.00 mUSD `WO-2231#demo-local` payment and refuses the injected WO-2240 input. Scheduled is **not paid**. Current re-priced fixture amounts (200/1,200/820) are not substituted into this old run.

An opening Safe amount of 50,000 can be inferred algebraically from those movements, but it is **not an observed opening snapshot**. The report's `ok: true` is an implementation claim, not independent verification of its historical balance comparison.

## Report completeness

Verdicts concern adequacy for bookkeeping, not financial-statement assurance.

| Required information | Current location/behavior | Verdict | Proposed action |
|---|---|---|---|
| Opening cash, fund and debt balances | Absent from daily JSON; starting `ChainView` exists only in memory and excludes debt | Missing | Preserve observed opening snapshot with chain/block provenance |
| Closing cash and fund balances | `balances.safe` and `balances.vault`, raw six-decimal token units | Partial | Keep values; add unit/network/block metadata and reuse the compared snapshot rather than rereading |
| Outstanding credit | `balances.creditDrawn` reads lender `drawn()`; it is outstanding principal, not lifetime borrowing | Partial | Label semantics; record opening/closing liability, draws and repayments and reconcile them |
| Payment recipient, amount, invoice, outcome and transaction | Paid `results` contain filename/outcome/tx; invoice ID, recipient and amount are not structured there; run/log supply human descriptions | Partial | Serialize verified executed payment details and immutable registry/reference context |
| Customer receipt and repayment sweep | `inflows` includes matched receivable, gross `amount`, `swept`, kind and tx | Partial | Net cash is derivable; add explicit net and exception totals, do not count gross and net twice |
| Refused, owner-review and later-due items | Refusal/proposal outcome and reason when produced; later-due actions in `scheduled` | Partial | Keep separate from successful payments; attach structured invoice/due/owner-review status |
| Reconciliation result and exceptions | `{ok,diffs}`, or `null` when not run; no persisted opening/compared closing/expected deltas | Partial | Explicit verified/not-run/failed-read/limited-coverage states and reproducible comparison details |
| Correct balance labels in decision log | Successful close labels net Safe/vault changes as `Safe` and `vault` | Fail | Label deltas explicitly and present actual closing balances separately |
| Entire storm/replay period | Ordinary-day report is anchored before the storm phase; later cover, payroll, credit and resumed sweep appear in run/log, not that daily report | Missing for whole replay | Add phase/day ledger and report coverage; do not relabel pre-storm report as end-of-replay evidence |
| Base Sepolia report/log and full anchor match | Only published transaction references available locally | Not verified | Obtain original matching exports; verify network/chain/run, original bytes and full on-chain anchor hash |

## Reconciliation checks

All amounts below are mUSD unless identified as token base units. One base unit is 0.000001 mUSD. R IDs correspond to characterization tests; G IDs retain unmet business expectations using `it.fails`.

| Case | Expected | Observed | Verdict | Evidence |
|---|---|---|---|---|
| R01 real report producer | Preserve closing amounts, inflow allocation, refused/scheduled actions and exact canonical hash | Mock opening cash 10,000/debt 1,000; gross receipt 8,000, swept 800, net 7,200; supplier 200; vault deposit 7,000; closing cash 10,000/vault 7,000/debt 200; anchor equals exact JSON hash | Pass within simulated scope | `runEveryday`, real pipeline/watcher, simulated sink |
| R02 no reconciliation dependency | Not run must not mean pass | `reconciliation: null`, no reconcile decision; JSON can still be anchored | Pass; evidence hash alone is not verification | Real report producer |
| R03 opening/payment fields and labels | Bookkeeping information must be self-contained and labels accurate | Opening absent, paid result lacks recipient/amount/invoice ID; summary `Safe 0, vault 7,000` despite closing Safe 10,000 | Missing/Fail | G01–G03 retain failed business expectations |
| R04 ordinary day | Gross receipt 8,000, supplier 200, vault transfer 7,800 match deltas; no pause | Matches, anchors, no pause | Pass | `closeDay` with fake reader |
| R05 omitted payment | Detect unexplained balance/counter changes | Safe/counter differences, anchor then pause | Pass | Remove 200 payment from ledger |
| R06 duplicated ledger payment | Detect double recording | Safe/counter differences, anchor then pause | Pass | Record 200 payment twice |
| R07 recorded owner direct Safe payment | Recorded cash movement must reconcile without adding PlanModule spend | Recorded 100 direct outflow matches Safe delta, no pause | Pass at comparison layer only | Trusted manual ledger entry, no `planId`; no runtime import UI/process established |
| R08 unrecorded owner direct Safe payment | Detect unexplained outflow | 100 cash difference; pause | Pass | Same chain delta without ledger entry |
| R09 vault rounding 1 base unit | Within tolerance, no pause | Matches | Pass | Default tolerance 2 |
| R10 vault rounding 2 base units | Inclusive tolerance, no pause | Matches | Pass | Default tolerance 2 |
| R11 vault rounding 3 base units | Over tolerance, pause | Vault mismatch and pause | Pass | Default tolerance 2 |
| R12 module spend counter | Detect wrong counter even if Safe/vault match | Counter 201 versus recorded 200; pause | Pass | `spentToday(0)` mismatch |
| R13 UTC day rollover | Do not interpret reset as money loss; still check balances | Resets accepted; Safe gap 1 or vault gap 3 still fails | Pass, counter coverage limited across rollover | `reconcile` day change |
| R14 pause failure | Alert and tell owners what to do | `NotPauser` alert persisted, owner pause guidance logged | Pass | Fake pauser throws; no live transaction |
| R15 RPC unavailable | Distinguish inability to read from confirmed mismatch | Error propagates; no comparison/anchor/pause | Pass for error distinction; report not verified | Fake reader throws |
| R16 offsetting off-ledger transfers | An event-complete review must identify both unknown movements | -100/+100 cancel; current narrow balance input returns `ok: true` | Missing capability, not commercial validity proof | G04; transfers are trusted test-oracle context **not consumed by current ChainView** |
| R17 unexplained debt movement | Verify outstanding debt independently of cash | Additional test context 1,000 -> 900 ignored; `ChainView` has no debt dimension | Missing capability | G05; not proof of an actual lender exploit |
| R18 short customer receipt | Preserve gross/net, warn owner; no financial mismatch if chain matches | 7,000 gross, 10 swept, 6,990 net; `ShortPayment`, no pause | Pass | Real watcher and closeDay |
| R19 overpayment | Same accounting, flag excess | 8,100 gross, 10 swept, 8,090 net; `Overpayment`, no pause | Pass | Real watcher and closeDay |
| R20 unknown invoice | Preserve received cash despite unidentified allocation | 100 gross, 10 swept, 90 net; `UnmatchedInflow`, no pause | Pass | Real watcher and closeDay |
| R18–R20 checkpoint repeat | Do not record same receipt twice | Second poll empty; one ledger entry | Pass | Real watcher checkpoint |
| R21 lagging RPC node after receipt | Pin no older than receipt and retry unavailable block | Stale head 95 retried to 100; unavailable call retried at 100 | Pass; existing historical mitigation works in this scenario | Real `consistentTransport`, fake base RPC |
| R22 advancing head, parallel snapshot | Use a single coherent block to avoid false mismatch | Actual reader/transport mix blocks 100/101; Safe before transfer + vault after transfer falsely pauses; coherent block 101 matches | Confirmed conditional mismatch | G06; deterministic fake RPC, not a claimed live incident |
| R23 report reread after comparison | Anchored balances must be the compared closing snapshot | Compared Safe 10,000; report reread Safe 9,900 while `ok: true` persists | Confirmed conditional mismatch | G07; real producer with mocked changed boundary read |

The inflow sweep values in R18–R20 are event-oracle data for watcher accounting, not tests of the router's sweep-rate formula. R01 uses the demo 10% ordinary-day allocation. No test changes the current runtime API; extra transfer/debt fields belong only to trusted test-oracle context.

### Interpretation of test results

The new file has **30 assertions: 23 characterization/regression assertions and 7 explicitly expected-failing business assertions**. Vitest counts `it.fails` as successful when its expectation fails, and fails it if the expectation unexpectedly passes. Setup runs outside those assertions so infrastructure errors cannot stand in for business failures. A green test process therefore does **not** mean all bookkeeping expectations are satisfied.

G01 opening balances; G02 payment detail; G03 incorrect log labels; G04 transfer-completeness gap; G05 debt comparison gap; G06 mixed-block read; G07 report/compared-snapshot divergence. These remain documented rather than changing expected outcomes to make business failures disappear.

## Findings and follow-up

| Finding | Documentation or runtime change | Proposed action | Tracking |
|---|---|---|---|
| F01 incomplete report payload and provenance | Runtime, plus explanation in this PR | Version new report format; observed opening/closing snapshots, units/network/block, structured executed payments and explicit check status | Separate consolidated runtime issue; G01/G02 and completeness table |
| F02 deltas labelled as balances | Runtime | Present deltas and actual closing balances separately | Same issue; G03 |
| F03 no event-completeness check for direct transfers | Runtime capability addition | Compare trusted token/receipt events with recorded entries over an explicit block range; record known direct payments; separate balance match from coverage completeness | Same issue; R16/G04. Do not make every quiet day fail merely because a balance-only API has no events |
| F04 outstanding debt not reconciled | Runtime capability addition | Include lender opening/closing debt, verified draws and repayment allocations; check expected debt movement without counting repayments as additional Safe outflows | Same issue; R17/G05 |
| F05 inconsistent snapshot boundaries | Runtime | Pin one block for all view fields; reuse that compared snapshot for report; identify read failure/retry separately from financial mismatch | Same issue; R22/G06 and R23/G07 |
| F06 report/ledger does not cover later storm replay | Runtime | Review day/phase boundaries; keep ledger through cover/credit/payroll/router flows; produce separately identified later reports and reconciliation | Same issue; static `agent/src/replay/run.ts` ordinary-day block clears `a.sink.ledger` before replay; historical run contains later actions absent from report |
| Interpreting null, raw token units, repayment and historical pricing | Documentation | Operational notes and evidence limitations included here | Included in this PR; no historical rewrite |
| Original Base Sepolia exports absent | Evidence dependency, not runtime defect | Obtain and compare original exports and full anchor data | Pending; not a code issue by itself |

The runtime issue is linked in the review PR description. Existing invoice-processing findings remain in issue #16; no duplicate invoice-classification or partial-payment issue is created here.

## Verification

- Original regression suite: **301/301**, 25 test files, by `npm test -- --exclude test/reconciliation-review.test.ts`.
- Full suite: **331/331**, 26 test files, including the **7 known expected-failing business assertions**, not 331 business requirements passing.
- `npm run typecheck`: passes.
- `git diff --check`: passes.
- `npm run plan:hash -- ../data/fixtures/plans/plan-book.example.json`: `0xb6b90f2a183c40898babdd89110dc2b85e1493bacbd924474ae07675acdfe193`, unchanged from PR base.
- Policy, plans, deployments, runtime, historical tracked results and `docs/EVIDENCE.md` are unchanged from PR base; local report/run/decision-log digests preserved.
- No new replay, real blockchain transaction, or paid model benchmark was run. Base Sepolia remains **Not verified**.

## Conclusion

Local report/run/log descriptions and content-hash prefix agree. Current simulation detects several balance/counter mismatches, handles the stated vault tolerance and preserves customer receipts with owner warnings. It does not establish complete event, debt or storm-period accounting; snapshot consistency and report detail also need runtime follow-up.

Bookkeeping sign-off is **not ready**: address the confirmed runtime findings, rerun the reviewed expectations, and obtain/verify the required Base Sepolia exports. Creating this documentation/test PR or its follow-up issue is not completion of the task.
