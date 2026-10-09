# Agent, relayer and replay specs

TypeScript on Node 22. Libraries: `viem` (chain), `@safe-global/protocol-kit` and `@safe-global/api-kit` (Safe), `zod` (schemas), a model SDK for the extractor and planner.

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
  policy/
    localCheck.ts      same checks as PlanModule, run before signing (defence in depth)
  exec/
    executor.ts        Action → PlanModule call, or Safe proposal for owner co-sign
  loops/
    everyday.ts        match inflows, pay due bills, sweep, reconcile
    storm.ts           brace, claim, payroll, credit draw, lock
  forecast.ts          13-week cash forecast
  drafts.ts            insurance claim, Circular 53 request, deadline list
  log.ts               decisions.jsonl (every action, refusal and reason)
  types.ts             zod schemas (below)
```

## Trust boundaries

1. **Untrusted input** (emails, invoices, chat, arena submissions) only ever reaches `extractor.ts`.
2. The extractor has **no tools** and returns JSON only; zod validates it; invalid output is dropped and logged as a refusal.
3. The planner sees validated fields, never raw text. It returns `Action[]`; zod validates; anything else is dropped.
4. `localCheck.ts` replays the contract's checks; failures are logged as refusals before any signing.
5. `PlanModule` checks again on-chain. Anything over cap becomes a Safe proposal for the owner.

## Schemas (`types.ts`)

```ts
ExtractedInvoice = {
  kind: "invoice" | "payroll" | "bank_detail_change" | "other",
  payeeName: string,
  payeeAddress?: `0x${string}`,   // only if literally present; never inferred
  amount: string,                  // decimal string in token units
  currency: "USD" | "HKD" | "VND",
  dueDate?: string,                // ISO date
  invoiceId?: string,
}

Action =
  | { type: "pay";            plan: "base" | "storm"; payee: `0x${string}`; amount: string; ref: string }
  | { type: "vault_deposit";  plan: "base";  amount: string; ref: string }
  | { type: "vault_withdraw"; plan: "base" | "storm"; amount: string; ref: string }
  | { type: "credit_draw";    plan: "storm"; amount: string; ref: string }
  | { type: "cover_claim";    plan: "storm"; ref: string }
  | { type: "anchor";         kind: "PRE_STORM" | "DAILY_REPORT" | "ATTACK_LOG"; hash: `0x${string}` }
  | { type: "propose_to_owner"; reason: string; action: Action }
```

A starting version is in `agent/src/types.ts`.

## Relayers

### HKO (`relayers/hko.ts`)

- Endpoint: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en`
- `warnsum` returns `{}` when no warning is in force. When the tropical cyclone warning is in force, the entry `WTCSGNL` has `code` (`TC1`, `TC3`, `TC8NE`, `TC8SE`, `TC8NW`, `TC8SW`, `TC9`, `TC10`, `CANCEL`), `actionCode`, `issueTime`, `updateTime`.
- Map: `TC1→1`, `TC3→3`, `TC8*→8`, `TC9→9`, `TC10→10`, `CANCEL` or absent `→0`.
- Live mode polls every 60 s and attests on change. Replay mode reads `data/replays/<event>.json`.
- There is no HKO history endpoint, so replays use the recorded timeline (source cited in the JSON).

### GDACS (`relayers/gdacs.ts`)

- Endpoint: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`
- Returns GeoJSON features with `eventid`, `name`, `alertlevel` (Green/Orange/Red), `affectedcountries`, `fromdate`, `todate`, `iscurrent`.
- Attest `level` 1/2/3 for Green/Orange/Red when the region's country is among the affected countries; `eventId = keccak256("TC-" + eventid)`.
- **Hong Kong is listed as `CHN`**, not `HKG`: RAGASA-25 (event 1001211) shows `PHL, CHN`. Map region `HK` → accept `HKG` or `CHN`. YAGI-24 (event 1001090) includes `VNM`.
- GDACS events can end before the local signal is lowered (RAGASA-25 ends 24 Sep 12:00 UTC); that is why the GDACS freshness window is 24 h while HKO's is 3 h.

### Signing (`relayers/sign.ts`)

EIP-712 with viem `signTypedData`, domain and types exactly as in [contracts.md](contracts.md#signalattestor). Each relayer has its own key and its own nonce counter, persisted to `agent/state/nonces.json`.

## Replay (`replay/runner.ts`)

```
npm run replay -- --event ragasa-2025 --speed 600 [--pause-at-steps] [--dry-run]
```

- Loads `data/replays/<event>.json` (format below), converts timeline times to a compressed clock, emits each signal change to both relayers, and ticks the agent's storm loop.
- `--pause-at-steps` waits for Enter at each signal change (for the live demo).
- `--dry-run` runs everything except sending transactions.
- At the end it prints every transaction hash and appends them to `docs/EVIDENCE.md` (`npm run evidence`).

Replay file format:

```json
{
  "id": "ragasa-2025",
  "region": "HK",
  "gdacsEventId": "TC-xxxxxxx",
  "source": "https://www.hko.gov.hk/en/informtc/ragasa25/report.html",
  "timezone": "Asia/Hong_Kong",
  "signals": [ { "time": "2025-09-22T12:20:00+08:00", "code": "TC1" } ],
  "scenario": { "payday": "2025-09-24T09:00:00+08:00", "fakeMessages": [ ... ] }
}
```

## Loops

### Storm (`loops/storm.ts`)

Deterministic state machine; the planner only fills amounts.

| On | Do |
| --- | --- |
| level 1 | read storm plan hash; notify the owner with a 3-line summary |
| level 3 (rising) | `vault_withdraw` to reach the storm buffer; pause scheduled non-urgent payments locally; `anchor PRE_STORM` (hash of photos + warning snapshot) |
| storm starts (attestor event) | `cover_claim`; re-run forecast |
| payday while storm | `pay` each employee (storm plan); if forecast < buffer then `credit_draw` sized by forecast, capped by plan |
| storm ends | resume paused payments as owner proposals; draft claim and deadline list |

### Everyday (`loops/everyday.ts`)

1. Read `PaymentRouter.Inflow` events; match `invoiceRef` to open invoices; flag mismatches.
2. For bills due within 2 days: `pay` registered payees under the base plan.
3. Above buffer + margin: `vault_deposit`.
4. 23:59 local: build the day's report (ledger vs chain), hash it, `anchor DAILY_REPORT`. On mismatch, call `pause` with the guardian key and alert the owner.

## Decision log

Every action and every refusal is one line in `agent/logs/decisions.jsonl`:

```json
{"ts":"...","input":"invoice-017","stage":"extractor|planner|localCheck|chain","outcome":"executed|refused|proposed","reason":"PayeeNotActive","tx":"0x..."}
```

The dashboard and arena read this file (or a small API over it).
