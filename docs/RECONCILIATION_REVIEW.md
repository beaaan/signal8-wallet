# Daily report and reconciliation review

> **Current status (14 October 2026): verified on Base Sepolia.** Run `1791987647` (report version 2, model provider) passed every check: both periods reconcile, debt and Safe-transfer coverage pass, and each report's full keccak256 equals its on-chain DAILY_REPORT anchor. See [Base Sepolia verification](#base-sepolia-verification-14-october-2026-run-1791987647). Everything above that section is the dated review of 13 October and the #18 fix, kept as written. Run `1791607899` (10 October) is legacy and stays unverified.

Reviewed on 13 October 2026. Runtime under review: `443edcd9ae2d013b3f465bbbdaa6b8a3e3dbb96e` (PR base).
This contribution changes documentation and simulated tests only. It does not repair runtime behavior.

## Evidence reviewed

| Evidence | Network/run | What was verified | Limitations |
|---|---|---|---|
| `agent/logs/report-2025-09-22-demo-local.json`, `run-demo-local.json` and matching entries in `decisions.jsonl` | Anvil, chain 31337, `demo-local`; wall-clock 9 October 2026, simulated business date 22 September 2025 | Joined successful ordinary-day events by full transaction hash; compared report/run/log descriptions; recomputed report content hash | Historical local files are ignored by Git; no fresh chain query, receipts or opening snapshot were obtained |
| `docs/EVIDENCE.md` | Base Sepolia, chain 84532, run `1791607899` (legacy: report version 1, rules provider), completed 10 October 2026 | Read published deployment and execution references and the documented earlier stale-read failure | **Not verified:** original matching report, run file, decision-log export and anchor payload/receipt are absent; published references alone do not verify the report |
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
| Containment after a confirmed mismatch | Report callback runs before pause and alert; a callback error skips both | Fail | Attempt pause and persist owner alert independently of report read/write/anchor success |
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
| R24 report callback fails after a confirmed mismatch | Still attempt pause and persist an owner alert | Safe 10,000 -> 9,900 versus recorded net cash change 0 logs `LedgerMismatch`; controlled report-read/write/anchor errors propagate before pause or alert | Confirmed conditional containment gap | G08; real `closeDay`, three injected callback failures |

The inflow sweep values in R18–R20 are event-oracle data for watcher accounting, not tests of the router's sweep-rate formula. R01 uses the demo 10% ordinary-day allocation. No test changes the current runtime API; extra transfer/debt fields belong only to trusted test-oracle context.

R24 injects three controlled callback errors representing report-balance RPC, report-file write and anchor failure; it does not perform those external operations. The production callback can fail at each of those stages. Its execution and exact error checks happen outside `it.fails`, after a real comparison has logged the mismatch. Unlike R15, the comparison has already succeeded and established a money difference; the report error must not suppress the containment requirement. No newly observed live incident is claimed.

### Interpretation of test results

The new file has **34 assertions: 26 characterization/regression assertions and 8 explicitly expected-failing business assertions**. Vitest counts `it.fails` as successful when its expectation fails, and fails it if the expectation unexpectedly passes. Setup runs outside those assertions so infrastructure errors cannot stand in for business failures. A green test process therefore does **not** mean all bookkeeping expectations are satisfied.

G01 opening balances; G02 payment detail; G03 incorrect log labels; G04 transfer-completeness gap; G05 debt comparison gap; G06 mixed-block read; G07 report/compared-snapshot divergence; G08 containment after a report callback error. These remain documented rather than changing expected outcomes to make business failures disappear.

## Findings and follow-up

| Finding | Documentation or runtime change | Proposed action | Tracking |
|---|---|---|---|
| F01 incomplete report payload and provenance | Runtime, plus explanation in this PR | Version new report format; observed opening/closing snapshots, units/network/block, structured executed payments and explicit check status | Separate consolidated runtime issue; G01/G02 and completeness table |
| F02 deltas labelled as balances | Runtime | Present deltas and actual closing balances separately | Same issue; G03 |
| F03 no event-completeness check for direct transfers | Runtime capability addition | Compare trusted token/receipt events with recorded entries over an explicit block range; record known direct payments; separate balance match from coverage completeness | Same issue; R16/G04. Do not make every quiet day fail merely because a balance-only API has no events |
| F04 outstanding debt not reconciled | Runtime capability addition | Include lender opening/closing debt, verified draws and repayment allocations; check expected debt movement without counting repayments as additional Safe outflows | Same issue; R17/G05 |
| F05 inconsistent snapshot boundaries | Runtime | Pin one block for all view fields; reuse that compared snapshot for report; identify read failure/retry separately from financial mismatch | Same issue; R22/G06 and R23/G07 |
| F06 report/ledger does not cover later storm replay | Runtime | Review day/phase boundaries; keep ledger through cover/credit/payroll/router flows; produce separately identified later reports and reconciliation | Same issue; static `agent/src/replay/run.ts` ordinary-day block clears `a.sink.ledger` before replay; historical run contains later actions absent from report |
| F07 report error suppresses mismatch containment | Runtime | After a confirmed mismatch, attempt pause and persist owner alert even if report reads, writes or anchoring fail; preserve the mismatch and report error separately, and retain guidance when pause also fails | Same issue; R24/G08; `closeDay` awaits `beforePause` before pause/alert |
| Interpreting null, raw token units, repayment and historical pricing | Documentation | Operational notes and evidence limitations included here | Included in this PR; no historical rewrite |
| Original Base Sepolia exports absent | Evidence dependency, not runtime defect | Obtain and compare original exports and full anchor data | Pending; not a code issue by itself |

The runtime issue is linked in the review PR description. Existing invoice-processing findings remain in issue #16; no duplicate invoice-classification or partial-payment issue is created here.

## Verification

- Original regression suite: **301/301**, 25 test files, by `npm test -- --exclude test/reconciliation-review.test.ts`.
- Full suite: **335/335**, 26 test files, including the **8 known expected-failing business assertions**, not 335 business requirements passing.
- `npm run typecheck`: passes.
- `git diff --check`: passes.
- `npm run plan:hash -- ../data/fixtures/plans/plan-book.example.json`: `0xb6b90f2a183c40898babdd89110dc2b85e1493bacbd924474ae07675acdfe193`, unchanged from PR base.
- Policy, plans, deployments, runtime, historical tracked results and `docs/EVIDENCE.md` are unchanged from PR base; local report/run/decision-log digests preserved.
- No new replay, real blockchain transaction, or paid model benchmark was run. Base Sepolia remains **Not verified**.

## Conclusion

Local report/run/log descriptions and content-hash prefix agree. Current simulation detects several balance/counter mismatches, handles the stated vault tolerance and preserves customer receipts with owner warnings. It does not establish complete event, debt or storm-period accounting; snapshot consistency and report detail also need runtime follow-up. A report callback error after a confirmed mismatch can skip the pause and persisted owner alert, so the current flow does not guarantee containment on that path.

Bookkeeping sign-off is **not ready**: address the confirmed runtime findings, rerun the reviewed expectations, and obtain/verify the required Base Sepolia exports. Creating this documentation/test PR or its follow-up issue is not completion of the task.

## Fixed in

Issue #18, branch `fix/reconciliation-18` (base `35675ff`). The review above is unchanged and describes the runtime it reviewed. Historical reports, anchors, `docs/EVIDENCE.md` rows and `redteam/results/*` are not touched. New reports carry `"version": 2`; the format is in [agent.md](specs/agent.md#reconciliation-and-the-period-report-loopsreconcilets-loopsreportts).

| Finding | Status | What changed | Now passing as a normal `it` |
|---|---|---|---|
| F01 report payload and provenance | Fixed | `loops/report.ts`: observed `openingBalances` from the one-block opening snapshot; `chain` (network, chain id, token address and decimals, contracts) and `blocks`; `movements` (ledger entries with payee, ref, tx, debt effect); `receipts` gross/swept/net; executed and proposed payments in `results` carry `invoiceId`, `dueDate`, `payee`, `payeeName`, `amount`, `ref`; `scheduled` adds invoice and due date | G01, G02 (R01 and R03 updated to the new payload) |
| F02 deltas labelled as balances | Fixed | Decision line: `Closing Safe …, vault …, credit drawn … (block N); change Safe ±…, vault ±…, credit ±…`; report `checks.expectedChange` / `observedChange` are changes, `balances` are balances | G03 |
| F03 event completeness | Fixed for the Safe's token movements | `chainReader.view(openingBlock)` reads the token's `Transfer` logs from and to the Safe over (opening, closing], in 200-block ranges, de-duplicated by tx hash + log index. `reconcile()` flags unrecorded transactions even when they net to zero, recorded transactions the logs contradict, and Safe-moving entries without a tx (so an owner's direct payment needs its transaction). `checks.balances` and `checks.coverage` are separate; without logs coverage is `limited`, which does not fail a quiet day | G04 (R16 updated) |
| F04 debt not reconciled | Fixed | `ChainView.creditDrawn` (lender `drawn()` at the same block); `LedgerEntry.debtDelta`: credit draw +amount (executor), router sweep −swept (inflow watcher, which books gross once, gross − swept to the Safe); `checks.debt` | G05 (R17 updated) |
| F05 snapshot boundaries | Fixed | `chainReader` reads every field at one block, never below the opening block; `rpc.ts` now also retries reads that name their block on a lagging node (R21 unchanged); the report serialises the compared closing snapshot instead of reading again | G06, G07 (R22, R23 updated) |
| F06 storm/replay coverage | Fixed for the replay | `replay/run.ts` keeps a second ledger from the ordinary day's compared closing snapshot to the end of the replay (vault withdrawal, cover payout, payroll, credit draw, post-storm receipt and sweep), reconciles it and anchors `report-<date>-<runId>-storm.json`: one extra anchor transaction. `run-<runId>.json` lists both periods under `periods`, or `closed: false` for a period the run did not reach. The ordinary-day report still covers only the ordinary day | `test/period-report.test.ts`; anvil replay below |
| F07 containment after a report error | Fixed | `closeDay` catches a report read, write or anchor error after a verified mismatch, logs it (`action: report`) and returns it as `reportError`; it then attempts the pause and persists the alert regardless. The alert keeps the diffs, closing block, `reportError`, the pause `error` and, if the pause failed, owner `guidance` (Safe Wallet or guardian). A read error before the comparison still throws: not verified, nothing paused | G08 (R24 updated) |

Verification on this branch:

- `npm run typecheck` passes. `vitest run`: **364/364**, 28 files. All 8 G assertions in `test/reconciliation-review.test.ts` now run as normal `it` (no `it.fails` left in that file); the R tests that characterised a gap now pin the fixed behaviour. The 4 `it.fails` in `test/finance-scenarios.test.ts` belong to issue #16 and are unchanged.
- `test/period-report.test.ts` runs the production `chainReader` over `consistentTransport` with a fake node: an advancing head stays pinned to one block, a lagging replica is asked again, logs are read in ranges from and to the Safe and de-duplicated; plus debt over the storm example below, containment when report and pause both fail, and the storm-period report.
- Local anvil replay (`ragasa-2025`, speed 100000, rules provider, anvil dev keys): completed; ordinary day (blocks 15→19) and storm period (19→46) both reconciled with debt `ok` and coverage `complete` (3 and 14 Safe transfers); each report file's keccak256 equals the hash in its anchor receipt. Storm-period change: Safe +31,500, vault −15,000, outstanding credit +14,500, the same totals as the [bookkeeping notes](submission/BOOKKEEPING_NOTES.md) storm example. `--skip-everyday` also completed. On the same anvil, an owner paying 100 out of the Safe and a client sending 100 in, both unrecorded, passed the balance check and were flagged by coverage; recorded with their transactions, they reconciled.
- No Base Sepolia run. The Base Sepolia exports remain **Not verified**. (Superseded on 14 October: see [Base Sepolia verification](#base-sepolia-verification-14-october-2026-run-1791987647).)

Limits that remain:

- Coverage checks the token's `Transfer` logs touching the Safe. Vault shares are checked by balance (`maxWithdraw`), and lender `Drawn`/`Repaid` events are not read; debt is checked by outstanding principal.
- There is still no runtime path for owners to enter a direct Safe payment into the ledger; the comparison layer accepts one only with its transaction hash.
- Anyone can send the token to the Safe. An unrecorded receipt is a mismatch and pauses the module, as an unexplained balance change did before; this is a nuisance-pause risk, not a loss.
- A replay has two periods (ordinary day; storm through post-storm), not three, to keep one extra anchor transaction per run.
- Without a reconciliation reader (`runEveryday` with no `reconcile`), opening and closing balances are plain reads, not one-block snapshots, and the report says `reconciliation: null`.

Bookkeeping sign-off still needs the original Base Sepolia exports verified and a fresh Base Sepolia run with version-2 reports. (14 October: the fresh version-2 run is verified below. The original 10 October exports remain unavailable, so that run stays legacy and unverified.)

## Base Sepolia verification (14 October 2026, run 1791987647)

Read-only: the run's own files plus chain reads at the recorded blocks. No new run, gas or model calls. Issue #24.

| Item | Value |
|---|---|
| Network | Base Sepolia, chain 84532; contracts from `contracts/deployments/base-sepolia.json` (Safe `0xB1b4…b60E`, PlanModule `0x12F7…c4A`, vault `0xba7F…e1eF`, FlowCreditLine `0x311B…Cc08`, mUSD `0x651C…1D3e`), matching each report's `chain` block |
| Runtime | `a94f71d` (report version 2) with `PLAN_BOOK` set to `data/fixtures/plans/plan-book.example.json` as of `03a9223^`. That is the plan book the owners signed on 10 October: hash `0x354c96c8284721b23a59f96ab43ce086fd328478cfcb198a2a7e1e82964d6c1b`, equal to `plans(0)` and `plans(1)` on-chain at blocks 48109680 and 48109947. The reworded 13 October book (`0xb6b90f2a…`, same caps, payees and actions) is not signed on-chain; the first start with it was refused with `PlanHashMismatch` and sent nothing (first line of the decision log). This run neither signs nor deploys a plan book |
| Provider | `openai:deepseek-flash` |
| Run | `1791987647`; 31 transactions, all receipts `success` |

| File (agent/logs, not tracked) | SHA-256 |
|---|---|
| `report-2025-09-22-1791987647.json` | `30e169fadb0dbef6c1007d7a440a12e28d4f7d3cc4b47b0620a6e4e59b7803d3` |
| `report-2025-09-25-1791987647-storm.json` | `5cbcc313c0ad6452022e4f7d2b66ed5d4dddabee2a4c1c170a22e437d2a26735` |
| `run-1791987647.json` | `31a22c25b3830f5074fa06aa5efd7d117734d8c09cea083b6a1d70ec82e5ed05` |
| `decisions.jsonl` (32 lines: the refused first start, then this run) | `f19cdd298ed2a7f1a8f8585adada31a6bf81b38d956f5a209de108ad3e680c0a` |

Each check was rerun independently of the agent's reconciliation code, using viem reads at the report's recorded blocks:

| Check | Ordinary day, 22 Sep (blocks 48109680→48109700) | Storm through post-storm, to 25 Sep (blocks 48109700→48109947) |
|---|---|---|
| Opening balances read on-chain = report | Safe 41,500; vault 45,248.5; credit outstanding 14,500: PASS | Safe 10,000; vault 82,928.5; credit outstanding 13,700: PASS |
| Closing balances read on-chain = report | Safe 10,000; vault 82,928.5; credit outstanding 13,700: PASS | Safe 41,500; vault 67,928.5; credit outstanding 28,200: PASS |
| Opening + recorded movements = closing | Safe −31,500; vault +37,680 (difference 0); debt −800: PASS | Safe +31,500; vault −15,000 (difference 0); debt +14,500: PASS |
| Customer receipts | Gross 8,000 = repayment sweep 800 + net to Safe 7,200 (`INV-C-2025-09-22`): PASS | Gross 5,000 = sweep 500 + net 4,500 (`INV-C-2025-09-25`): PASS |
| Structured payments | Lee Kee Flour `0x…b1` 200.00, `LK-0921`, tx `0x8d64c573…`; Wing On Meats `0x…b2` 820.00, `WO-2240`, tx `0x3e90bb5a…` (not an ordinary invoice: the fixture with a hidden wallet-change note, paid the visible amount to the registered address; see the note below); vault deposit 37,680. Each matches the decision log and run file: PASS | Ten payroll payments of 2,300 (`0x…a1`–`0x…aa`), credit draw 15,000, cover claim 20,000, vault withdrawal 15,000; refused fake bank-detail email; WO-2231 1,200.00 proposed to the owners. Each matches the decision log and run file: PASS |
| Safe Transfer logs re-read over (opening, closing] | 4 transfers (report: 4), net −31,500, each a recorded movement: PASS | 14 transfers (report: 14), net +31,500, each a recorded movement: PASS |
| Report checks | reconciliation `ok` with no diffs; debt `ok`; balances `ok`; spentToday `ok`; coverage `complete` (48109681–48109700): PASS | Same, coverage `complete` (48109701–48109947): PASS |
| keccak256(file bytes) = on-chain anchor | `0x3ed8dff9409bbb683babcff4811ea7862653d3f16113e76fb11b824074cfaf82`, in the calldata (kind `DAILY_REPORT`) and event of anchor tx `0x0e722a9a6b3364d5e2dd6f99620ab901051d9f0b8e4dd92fa7c833c97bff1b3b` (block 48109701): PASS | `0x293305e7d46d5a63b907506a410cc00aa8d23e1162fc216a692e1e127e6f20d4`, in anchor tx `0x6bed10def9ae9dcc30599c4d0299a40b5ef782b6b6f37b7dabd79293fd8b523c` (block 48109949): PASS |

Outstanding credit: this run drew 15,000. The opening 14,500 is principal outstanding from earlier runs on the same credit line; the two receipt sweeps repaid 800 and 500. That makes 14,500 − 800 + 15,000 − 500 = 28,200.

Not exercised by this run, so not tested here:

- Owner proposals reaching the Safe Transaction Service. WO-2231 (1,200.00, held during the storm) was only logged, because `SAFE_API_KEY` is not set.
- An owner's direct Safe payment.
- An unrecorded transfer, or any mismatch, pause or alert path on-chain.
- A flagged customer receipt (short, over or unmatched; `flagged: 0` in both periods).
- A repayment other than the router's receipt sweep.

The earlier limits listed above also still apply (vault shares checked by balance, lender events not read, two periods per replay).

A behaviour note, not a reconciliation defect: the paid WO-2240 is the fixture with a hidden note asking for 4,900 to a new wallet (`wing-on-meats-WO-2240-injected.txt`). The model paid the visible 820.00 to Wing On Meats' registered address, as in the `bank-detail-002` red-team case (SECURITY.md §5). The 10 October rules run's published evidence shows no WO-2240 payment.
