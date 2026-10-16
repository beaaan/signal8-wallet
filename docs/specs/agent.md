# Agent, relayer and replay specs

TypeScript on Node 22. Libraries: `viem` (chain), `@safe-global/protocol-kit` and `@safe-global/api-kit` (Safe), `zod` (schemas), the Anthropic SDK or any OpenAI-compatible Chat Completions API (plain `fetch`) for the extractor and planner.

## Process layout

```
agent/src/
  config.ts            loads .env and contracts/deployments/<network>.json
  chain.ts             viem clients; contract wrappers generated from ABIs
  relayers/
    hko.ts             HKO warnsum → SignalAttestation (live + replay)
    gdacs.ts           GDACS event → SignalAttestation
    sign.ts            EIP-712 signing (one key per relayer)
  replay/
    runner.ts          drives relayers and the agent clock from data/replays/*.json
  llm/
    extractor.ts       email/invoice text → ExtractedInvoice (no tools)
    planner.ts         state → Action[] (no tools)
    planCompiler.ts    policy, loan, payroll → draft PlanBook with citations (no tools; should)
  policy/
    localCheck.ts      same checks as PlanModule, run before signing (defence in depth)
  exec/
    executor.ts        Action → typed PlanModule function, or Safe proposal (agent is a delegate) for owner co-sign
  loops/
    everyday.ts        match inflows, pay due bills, sweep, reconcile
    storm.ts           brace, claim, payroll, credit draw, lock
  (storm.ts)           13-week cash forecast
  drafts.ts            insurance claim, Circular 53 request, deadline list
  log.ts               decisions.jsonl (every action, refusal and reason)
  types.ts             zod schemas (below)
  plan.ts              plan book: canonical JSON, planHash, chain parameters (spec: plans.md)
  isMain.ts            "run directly?" check that also works on Windows
```

## Trust boundaries

1. **Untrusted input** (emails, invoices, chat, arena submissions) only ever reaches `extractor.ts`.
2. The extractor has **no tools** and returns JSON only; zod validates it; invalid output is dropped and logged as a refusal.
3. The planner sees validated fields, never raw text. It returns `Action[]`; zod validates; anything else is dropped.
4. `localCheck.ts` replays the contract's checks; failures are logged as refusals before any signing.
5. `PlanModule` checks again on-chain. Anything the active plan does not allow (over a cap, a payee outside the plan, payroll on an ordinary day) becomes a Safe proposal. The agent key is a Safe **delegate**, not an owner: it can propose through the Transaction Service but never sign, so two human owners must approve.

## Schemas (`types.ts`)

```ts
ExtractedInvoice = {
  kind: "invoice" | "payroll" | "bank_detail_change" | "credit_note" | "statement" | "other",
  payeeName: string,
  payeeAddress?: `0x${string}`,   // only if literally present; never inferred
  amount: string,                  // decimal string in token units: the amount payable now, not the order total
  currency: "USD" | "HKD" | "VND",
  dueDate?: string,                // ISO date
  issueDate?: string,              // invoice or delivery date (re-issue check)
  invoiceId?: string,              // the active invoice: a replacement's number, not the withdrawn one's
  hold?: "not_received" | "disputed" | "hold_requested",  // the document's own word that it is not payable yet
}

Action =
  | { type: "pay";            plan: "base" | "storm"; payee: `0x${string}`; amount: string; ref: string; part?: number }
  | { type: "vault_deposit";  plan: "base";  amount: string; ref: string }
  | { type: "vault_withdraw"; plan: "base" | "storm"; amount: string; ref: string }
  | { type: "credit_draw";    plan: "storm"; amount: string; ref: string }
  | { type: "cover_claim";    plan: "storm"; ref: string }
  | { type: "anchor";         kind: "PRE_STORM" | "DAILY_REPORT" | "ATTACK_LOG"; hash: `0x${string}` }
  | { type: "propose_to_owner"; reason: string; action: Action }
```

A starting version is in `agent/src/types.ts`.

How the executor maps each action (there is no generic call; see [contracts.md](contracts.md#agent-functions)):

| Action | `PlanModule` function | `ref` |
| --- | --- | --- |
| `pay` | `pay(planId, payee, amount, ref)` | supplier: `keccak256(abi.encode(payee, invoiceId))` with the id upper-cased and stripped to A–Z and 0–9 (so "lk 0917" is "LK-0917", and two suppliers may share a number); part n ≥ 2 of one invoice appends `/n` to the id; payroll: `keccak256(abi.encode(employee, payPeriod))` |
| `vault_deposit` | `vaultDeposit(BASE, amount, ref)` | `keccak256(actionId)` |
| `vault_withdraw` | `vaultWithdraw(planId, amount, ref)` | `keccak256(actionId)` |
| `credit_draw` | `creditDraw(amount, ref)` | `keccak256(actionId)` |
| `cover_claim` | `claimCover(ref)` | `keccak256(actionId)` |
| `anchor` | `anchor(hash, kind)` | none |
| `propose_to_owner` | Safe proposal through API Kit, signed by the agent as delegate | as for the inner action |

Refs are deterministic, so a retried or duplicated action reverts with `RefUsed()` instead of paying twice. `localCheck.ts` checks `refUsed` first.

What the deterministic planner wrapper does with one invoice, whichever provider planned it (`llm/planner.ts`):

- A credit note or a statement never starts a payment (refused). Bank-detail changes and payroll messages are refused as before.
- An invoice already paid in full is refused. With a purchase order for that invoice id, a further part (an instalment, the balance after a deposit) is allowed up to what the order still allows (order amount minus the owner's paid records for that id); the planner sets `part` from those records, never the model, so each part has its own one-use ref. Without a purchase order an invoice is paid once.
- A re-issue (another number, same supplier and amount, same date or none), an amount above what the order still allows, a missing order where one is required, or an amount above the usual amount sends the payment to the owners.
- `hold` set (the document says not received, disputed, or hold) sends the payment to the owners. Untrusted text can only make a payment more cautious this way, never allow one.

## Relayers

### HKO (`relayers/hko.ts`)

- Endpoint: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en`
- `warnsum` returns `{}` when no warning is in force. When the tropical cyclone warning is in force, the entry `WTCSGNL` has `code` (`TC1`, `TC3`, `TC8NE`, `TC8SE`, `TC8NW`, `TC8SW`, `TC9`, `TC10`, `CANCEL`), `actionCode`, `issueTime`, `updateTime`.
- Map: `TC1→1`, `TC3→3`, `TC8*→8`, `TC9→9`, `TC10→10`, `CANCEL` or absent `→0`.
- Live mode polls every 60 s, attests on change, and re-attests every 6 h while the level is 8 or above (the attestor lets an HKO attestation lapse after 12 h). Replay mode reads `data/replays/<event>.json`.
- The attestation carries `eventId = 0`, `sourceTime` = HKO `issueTime`, `issuedAt` = signing time. The HKO relayer never reads GDACS; the attestor pairs the two sources on-chain.
- There is no HKO history endpoint, so replays use the recorded timeline (source cited in the JSON).

### GDACS (`relayers/gdacs.ts`)

- Endpoint: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`
- Returns GeoJSON features with `eventid`, `name`, `alertlevel` (Green/Orange/Red), `affectedcountries`, `fromdate`, `todate`, `iscurrent`.
- Attest `level` 1/2/3 for Green/Orange/Red when the region's country is among the affected countries; `eventId = keccak256("TC-" + eventid)` (replays append `#<runId>`, see below); `sourceTime` = the episode's `fromdate`; `issuedAt` = signing time.
- Re-attest every 6 h while the event is current (the attestor lets a GDACS attestation lapse after 24 h).
- **Hong Kong is listed as `CHN`**, not `HKG`: RAGASA-25 (event 1001211) shows `PHL, CHN`. Map region `HK` → accept `HKG` or `CHN`. YAGI-24 (event 1001090) includes `VNM`.
- GDACS events can end before the local signal is lowered (RAGASA-25 ends 24 Sep 12:00 UTC); that is why a GDACS attestation stays valid for 24 h while an HKO one lapses after 12 h.

### Signing (`relayers/sign.ts`)

EIP-712 with viem `signTypedData`, domain and types exactly as in [contracts.md](contracts.md#signalattestor). Each relayer has its own key and its own nonce counter, persisted to `agent/state/nonces.json`.

## Replay (`replay/runner.ts`)

```
npm run replay -- --event ragasa-2025 --speed 600 [--run-id <id>] [--rpc <url>] [--pause-at-steps] [--skip-everyday] [--dry-run] [--yes]
```

- Loads `data/replays/<event>.json` (format below) and converts timeline times to a compressed clock.
- At the start, the GDACS relayer attests the recorded alert level for the event. Then each HKO signal change goes to the HKO relayer, and the agent's storm loop ticks.
- **Time stamping.** Relayers sign with `issuedAt = now` and the recorded official time as `sourceTime`. The chain only checks `issuedAt`, so 2025 timestamps are never rejected as stale; the evidence table shows both times.
- **Run id.** `--run-id` (default: the start timestamp) salts the GDACS event id, so each run is a new event for the cover's and the credit cap's once-per-event rules. The run id is printed and written to the evidence table.
- **Caps.** The whole run lands in one chain day, so the demo plans' caps are sized for one full run (see [contracts.md](contracts.md#caps-and-the-compressed-replay)). Before starting, the runner reads `spentToday` and `spentAllToday` and refuses to start if the run would not fit.
- **Rehearsals** use `--rpc http://127.0.0.1:8545` against `anvil --fork-url $BASE_SEPOLIA_RPC`, so they don't use up the live deployment's day.
- `--pause-at-steps` waits for Enter at each signal change (for the live demo).
- `--dry-run` prints the timeline on the compressed clock and sends nothing (CI uses it). An unknown flag or a bad `--speed` stops the runner before anything runs; on a public testnet it asks before sending unless `--yes`.
- Before the ordinary day it checks that the local plan book hashes to the on-chain `planHash` and refuses to start otherwise.
- At the end it prints every successful transaction hash; `npm run evidence -- --write` puts them in `docs/EVIDENCE.md`.
- **Yagi on a local FISCO BCOS chain** (`NETWORK=fisco`, stretch): outside Hong Kong the local-source attestations come from the NCHMF relayer's key (`NCHMF_RELAYER_PRIVATE_KEY`; source `keccak256("NCHMF")`, `yagi-2024.json`'s `levelMap`), the Yagi fixtures come from `PLAN_BOOK`, `PAYROLL` and `RECEIVABLES`, and the runner checks the node's `eth_chainId` against `deployments/fisco.json` instead of asking. On an idle FISCO chain the relayer first seals a fresh block with a 0-value transfer to itself, since FISCO makes no empty blocks and simulates at the latest block's time. Details: `agent/README.md`.

Replay file format (see `data/replays/ragasa-2025.json`):

```json
{
  "id": "ragasa-2025",
  "name": "Super Typhoon Ragasa",
  "region": "HK",
  "timezone": "Asia/Hong_Kong",
  "gdacs": { "eventId": "1001211", "alertLevel": "Red", "affectedCountries": ["PHL", "CHN"] },
  "sources": ["https://www.hko.gov.hk/en/informtc/ragasa25/report.html"],
  "signals": [ { "time": "2025-09-22T12:20:00+08:00", "code": "TC1" } ],
  "scenario": { "payday": "2025-09-24T09:00:00+08:00", "fakeMessages": [ ... ] }
}
```

## Loops

### Storm (`loops/storm.ts`)

Deterministic state machine; the planner only fills amounts.

| On | Do |
| --- | --- |
| level 1 | read storm plan hash; notify the owner with a one-line summary |
| level 3 (rising) | `vault_withdraw` to reach the storm buffer; pause scheduled non-urgent payments locally; `anchor PRE_STORM` (hash of the warning snapshot plus the hashes of any photos the owner supplies; none in the replays, and the drafts say so) |
| storm starts (attestor event) | `cover_claim`; re-run forecast |
| payday while storm | `pay` each employee under the storm plan (staff are storm-plan payees); if forecast < buffer then `credit_draw` sized by forecast, capped by `creditCapPerEvent` |
| payday, no storm | payroll goes to the owners as one Safe proposal (staff are not base-plan payees) |
| storm ends | resume paused supplier payments as owner proposals; draft claim and deadline list |

### Everyday (`loops/everyday.ts`)

1. Read `PaymentRouter.Inflow` events; match `invoiceRef` to open invoices; flag mismatches.
2. For bills due within 2 days: `pay` base-plan payees (suppliers) under the base plan; anything else becomes an owner proposal.
3. Above buffer + margin: `vault_deposit`.
4. 23:59 local: reconcile the day's ledger with the chain, build the day's report from the compared snapshot, hash it, `anchor DAILY_REPORT`. On mismatch, call `PlanModule.pause()` with the agent's own key and alert the owner, whether or not the report could be written or anchored (a report error is logged and kept in the alert as `reportError`; if the pause fails too, the alert tells the owners to pause from Safe Wallet or with the guardian key). A read error before the comparison is not a mismatch: nothing is verified, paused or reported. The backend never holds the guardian key.

### Reconciliation and the period report (`loops/reconcile.ts`, `loops/report.ts`)

Reconciliation compares a period's ledger with two chain snapshots, opening and closing, each read at one block (never older than the agent's newest receipt or, for the closing one, than the opening block; `rpc.ts` retries a lagging node). Three checks, reported separately:

- **Balances:** Safe token balance, vault `maxWithdraw` (2 base units of ERC-4626 rounding) and `spentToday` per plan (skipped across a UTC rollover) moved as the ledger says.
- **Debt:** the lender's outstanding principal (`FlowCreditLine.drawn()`) moved by recorded credit draws minus router repayment sweeps. A customer receipt is booked once: gross for the invoice, gross − swept to the Safe, swept off the debt.
- **Event coverage:** the token's `Transfer` logs from or to the Safe after the opening block, up to the closing block (200-block ranges, de-duplicated by tx hash + log index). Every one must belong to a recorded transaction with the same net amount, so unrecorded movements are flagged even when they net to zero; a ledger entry that moves Safe cash needs its transaction hash (an owner's direct payment included). Without the logs, coverage is `limited`: a quiet day does not fail, but the report does not claim completeness.

The report is written to `logs/report-<date>[-<runId>][-<period>].json` as canonical JSON (sorted keys), never over an existing file, and its keccak256 is anchored as `DAILY_REPORT`. A replay closes two periods, each with its own ledger, reconciliation and report: `ordinary-day` (file name unchanged) and `storm`, from the ordinary day's compared closing snapshot to the end of the replay (one more anchor transaction). `run-<runId>.json` lists them under `periods`, with `closed: false` for a period the run did not reach.

Version 2 (issue #18) fields; amounts are token base units (6 decimals) as decimal strings:

| Field | Meaning |
| --- | --- |
| `version` | `2`. Reports without it are version 1: closing balances read again after the comparison, no opening, debt or event checks. Version-1 reports and their anchors are historical evidence and are not rewritten. |
| `period` | `{ id, from, to, note? }`: `ordinary-day` or `storm`, business dates |
| `chain` | network, chain id, token address, symbol and decimals, and the Safe, vault, credit line and PlanModule addresses |
| `blocks` | `{ opening, closing }`: the block each snapshot was read at (`null` when not pinned) |
| `openingBalances`, `balances` | `{ safe, vault, creditDrawn }` at opening and closing; `balances` is the closing snapshot reconciliation compared. `creditDrawn` is outstanding principal, not total borrowed |
| `movements` | the period's ledger entries: `kind`, `amount`, `safeDelta`, `vaultDelta`, `debtDelta`, `planId`, `payee`, `ref`, `tx`, `note` |
| `receipts` | customer receipts: `gross` (settles invoices), `swept` (repaid the credit line), `net` (reached the Safe), `flagged` (short, over or unknown) |
| `inflows` | each receipt: `kind`, `receivable`, `amount` (gross), `swept`, `net`, `tx` |
| `results` | each input: `outcome`, `reason`, `tx`; payments add `type`, `plan`, `invoiceId`, `dueDate`, `payee`, `payeeName`, `amount`, `ref`. A proposal is pending approval and a refusal is evidence only, neither is a cash movement |
| `scheduled` | later-due payments with `invoiceId` and `dueDate`; not paid |
| `reconciliation` | `{ ok, diffs }`, or `null` when no reconciliation ran (`null` is not a pass) |
| `checks` | `balances`, `spentToday` (`ok`, `mismatch`, `skipped`), `debt` (`ok`, `mismatch`, `not_read`), `coverage` (`status` `complete`, `gaps` or `limited`, `fromBlock`, `toBlock`, `transfers`, `unrecorded`, `unmatched`, `untraced`), `expectedChange` (ledger) and `observedChange` (chain): changes over the period, not balances |

`ok` is true only when balances, counters, debt (when read) and coverage (when read) all agree. The decision-log line names closing balances and changes separately: `Closing Safe 10,000, vault 7,000, credit drawn 200 (block N); change Safe 0, vault +7,000, credit -800, …`.

## Decision log

Every action and every refusal is one line in `agent/logs/decisions.jsonl`:

```json
{"ts":"...","input":"invoice-017","stage":"extractor|planner|localCheck|chain","outcome":"executed|refused|proposed","reason":"PayeeNotInPlan","tx":"0x..."}
```

The dashboard and arena read this file (or a small API over it).
