# agent

TypeScript backend: relayers, replay runner, extractor, planner, local policy check, executor, storm and everyday loops, and the HTTP API for the dashboard. Spec: [../docs/specs/agent.md](../docs/specs/agent.md).

```bash
npm install
npm run typecheck
npm test               # vitest, no chain and no network
npm run replay -- --event ragasa-2025 --speed 600 --dry-run      # prints the timeline only
npm run plan:hash -- ../data/fixtures/plans/plan-book.example.json
npm run plan:rehash -- ../data/fixtures/plans/plan-book.example.json   # Safe transactions to re-sign a reworded plan book (reads the chain)
npm run hko:now        # current HKO tropical cyclone signal
npm run gdacs:now      # current GDACS cyclone events and the one for HK
npm run redteam        # every redteam/ case through the offline pipeline; writes ../redteam/results/rules-summary.json
npm run relayer:hko    # one HKO observation and what the live relayer would do (no transaction)
npm run relayer:gdacs  # same for GDACS
```

## Run locally against anvil

1. Start anvil and deploy the contracts (see `../contracts/README.md`); this writes `../contracts/deployments/anvil.json`.
   A second local chain gets its own name: `NETWORK=anvil-test forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8565 --broadcast` writes `deployments/anvil-test.json`, and the agent reads it with `NETWORK=anvil-test RPC_URL=http://127.0.0.1:8565`. Every `anvil-<name>` network is treated as local.
2. Nothing else is needed: with `NETWORK=anvil` (the default) or `anvil-<name>` the agent uses anvil's public dev keys for any role whose key is not in `../.env` (agent #5, HKO relayer #6, GDACS relayer #7, demo client #8). On any other network a missing key is an error.
3. Full Ragasa replay, with one ordinary day first:

   ```bash
   npm run replay -- --event ragasa-2025 --speed 600
   # options: --run-id <id>  --rpc <url>  --pause-at-steps  --skip-everyday  --dry-run  --yes  (--help lists them)
   npm run evidence       # markdown rows for docs/EVIDENCE.md from the latest run; -- --write puts them into the file
   ```

   The ordinary day matches the customer payment to `data/fixtures/receivables.json`, pays due invoices, sweeps to the vault and reconciles its ledger with the chain before anchoring the daily report (see below). At storm end the held supplier payments become owner proposals and the drafts are written to `logs/drafts/<runId>/`. The run summary and `logs/run-<id>.json` (`storm` key) state the cover payout; PlanModule's `Executed` event for a claim carries the amount the Safe received. The storm period (from the ordinary day's close to the end of the replay: cover, payroll, credit draw, the post-storm receipt) is reconciled and anchored as its own report, `logs/report-<date>-<runId>-storm.json`; `run-<id>.json` lists both periods under `periods`.

   Before the ordinary day the runner checks that the plan book hashes to the plans stored on-chain (exit 2 otherwise), and that today's `spentToday` / `spentAllToday` leave room for the run; the whole run lands in one chain day, so run it again on a fresh chain or tomorrow (UTC). Rehearse without using up a chain's day on a fork: `anvil --fork-url <rpc> --port 8555` and `--rpc http://127.0.0.1:8555`.
4. API for the dashboard and arena: `npm run serve` (port `AGENT_API_PORT`, default 8787). The arena (`POST /api/arena`) only runs on a local network (`anvil`, `anvil-<name>`) and only when the plan book matches the chain; otherwise the server starts read-only. Limits: 2,000 characters, 5 attempts per minute per IP and 20 overall; a run longer than `ARENA_TIMEOUT_MS` (default 50 s) answers 202 and lands on the board when it finishes. `X-Forwarded-For` is read only from loopback or with `TRUST_PROXY=1`, and only its last entry. `GET /api/decisions?lang=zh-Hant` (en, zh-Hans, vi) adds the owner explanation to each line. For the demo, run the arena on its own chain (`NETWORK=anvil-arena`, see `../docs/DEMO.md`).

Base Sepolia: `npm run keys:new` writes fresh keys for the agent, both relayers and the demo client into `../.env` (only where empty; never printed) and prints the addresses to fund. Set `NETWORK=base-sepolia`.

## Owner proposals (Safe Transaction Service)

Anything outside the active plan (over a cap, a payee in the other plan, `propose_to_owner`, ordinary-day payroll, a plan change) becomes an owner proposal; the agent never calls the Safe itself.

- Always: one line in `logs/proposals.jsonl` with the Safe transactions the owners would sign (`token.transfer`, vault `approve`+`deposit`/`withdraw`, `draw`, `claim`, `anchor`, or `PlanModule.queueChange(setter)` for a plan change).
- On `base-sepolia` with `SAFE_API_KEY` (and `SAFE_ADDRESS`, which must equal the deployment's Safe): `exec/safeProposer.ts` also builds the Safe transaction with protocol-kit (MultiSend for several calls), takes the next nonce from the service, signs the safeTxHash with the agent key **as a delegate** and calls api-kit `proposeTransaction`. Two owners still sign in Safe Wallet. If the key is missing or the service fails, the proposal stays logged and the decision line says so.
- Each proposal records its refs; a payment whose ref is already in `proposals.jsonl` (for this PlanModule) or already used on-chain is not proposed or paid again.
- The agent address must first be added as a delegate of the Safe by one owner: `OWNER_PRIVATE_KEY=0x… npm run safe:delegate` (needs `SAFE_API_KEY`; signs an EIP-712 message, no transaction; the key is used for that command only). `npm run safe:delegate -- --check` lists the delegates. Safe Wallet's settings can do the same.
- **Not tested live.** The service client and signer are injected and unit-tested with fakes (`test/safeProposer.test.ts`: nonce from the service, signature recovers to the agent, fallback on errors). There is no Safe Transaction Service for anvil, so the proposer has not been run against the real service from this environment.

## Owner's records and red team

`data/fixtures/purchase-orders.json`, `paid-invoices.json` and `payroll.json` are the owner's records the planner checks invoices against (`src/controls.ts`): an invoice already paid is refused (invoice numbers are compared normalised: case, spaces and dashes ignored, so `lk 0917` is `LK-0917`); a re-issue (same supplier and amount, new number, and the same issue date or none), an amount above its purchase order, no PO for a supplier that requires one, or (without a PO) an amount above the supplier's `usualAmount` (the landlord's rent, 3,800.00) becomes an owner proposal; a payroll message on an ordinary day becomes one proposal for payroll.json's staff when the totals match. Executed supplier payments join the paid history for the session.

`npm run redteam` runs every `../redteam/attacks` case (on an ordinary day and in storm mode) and every `../redteam/benign` case (with its own context) through extractor → planner → localCheck on a simulated PlanModule built from the example plan book (`src/sim.ts`); no chain, no keys. It prints a per-family table (attacker wins, funds lost, outcomes) and the benign task success, and writes the `ours` key of `../redteam/results/rules-summary.json`. `-- --model` uses the configured model provider and writes `ours` in `../redteam/results/summary.json`, preserving the other model side. Offline runs therefore leave the model benchmark intact. Compare model sides only after both have run on the same model and fixture revision.

## After-storm drafts

`src/drafts.ts` writes, at storm end, Markdown drafts the owner reviews, signs and sends (the agent never sends anything): an insurance claim letter (English, and Traditional Chinese for HK) citing the cover event id, the payout tx and the PRE_STORM hash; a deadline list (payroll, held supplier payments with due dates, credit repayment, claim window); and for a Vietnamese region (Yagi) a Circular 53/2024/TT-NHNN restructuring request in Vietnamese. Files go to `logs/drafts/<runId>/`, and each is a decision line (stage `owner`, outcome `proposed`, action `draft`). Preview without a chain: `npx tsx src/drafts.ts --event yagi-2024`. The 30-day claim window, the 10% sweep and the Circular 53 conditions are demo assumptions to check against the real policy, loan and circular.

## Everyday: inflows and reconciliation

- `loops/inflows.ts` reads `PaymentRouter` `Inflow` events since a checkpoint (`state/inflows-<network>.json`; a replay starts at its own first block), matches `invoiceRef` = keccak256(id) (or id#runId in replays) to `data/fixtures/receivables.json`, logs matches and flags short payments, overpayments and unknown refs for the owner. Partial payments add up.
- `loops/reconcile.ts`: at the end of a period the ledger (executed actions recorded by the executor, plus inflows: gross, amount − swept to the Safe, swept off the credit line) is compared with chain snapshots each read at one block: Safe balance, vault `maxWithdraw`, `spentToday` per plan, the lender's outstanding principal, and the Safe's token `Transfer` logs since the opening block (each must be a recorded transaction, so offsetting unrecorded movements are caught). The period report (`loops/report.ts`, version 2, see `../docs/specs/agent.md`) is built from that compared snapshot and anchored first; on a mismatch the agent then calls `PlanModule.pause()` with its own key, logs it, appends to `logs/alerts.jsonl` and prints an alert, even if the report could not be written or anchored. The replay stops there. Tested with fake readers and a fake RPC node (`test/reconcile.test.ts`, `test/period-report.test.ts`, `test/reconciliation-review.test.ts`).

## Live relayers

`npm run relayer:hko -- --live` polls the HKO warnsum every 60 s, attests when the level changes and re-attests every 6 h while it is 8 or above. `npm run relayer:gdacs -- --live` polls GDACS every 60 s and attests the current Orange/Red tropical-cyclone event for the deployment's region (HK accepts CHN and HKG), re-attesting every 6 h while it is current (a tracked event downgraded to Green is attested; one that stops being current lapses). Both start from the attestor's `latest(source, region)`, keep polling through fetch or submit errors, and log to `logs/relayer-<source>.jsonl`. Without `--live` they make one observation and print the decision (no transaction). The scheduling is tested with a fake clock and fetch (`test/live.test.ts`).

## Model

`MODEL_API_KEY` unset → the offline `rules` provider (regex extraction, name-matching planner); tests and CI always use it. With `MODEL_API_KEY` set, `MODEL_PROVIDER=anthropic` (the default then) calls the Anthropic Messages API with `MODEL_NAME` (default `claude-opus-5-5`, effort `low`), no tools, JSON output constrained by a schema and then validated with zod. The model never receives a private key or a tool, and the planner only ever sees validated fields and registry addresses.

`MODEL_PROVIDER=openai` uses any OpenAI-compatible Chat Completions API (`src/llm/openai.ts`) with the same prompts (`src/llm/prompts.ts`). For DeepSeek:

```bash
MODEL_PROVIDER=openai
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-flash
MODEL_REASONING_EFFORT=low     # optional; sent as reasoning_effort
MODEL_API_KEY=...              # in ../.env, never committed
```

JSON mode there guarantees JSON but not the schema, so the schema is written into the system prompt and zod still decides. The plan compiler (`--model`) and the bare baseline (`redteam:bare`, tools as functions) use the same setting. Not yet called live.

## Explanations, plan compiler and bare-agent baseline

- `npm run explain -- [--lang en|zh-Hant|zh-Hans|vi] [--last N]` (`src/explain.ts`): a deterministic two-line explanation of each decision line in `logs/decisions.jsonl` (what happened; why, with a Basescan link on Base Sepolia). Contract errors and the planner's refusal reasons are mapped; anything else is shown raw. The zh-Hant, zh-Hans and vi wording still needs a native speaker's review.
- `npm run plan:compile -- [--out file] [--model]` (`src/llm/planCompiler.ts`): drafts a plan book from `../data/fixtures/policy.txt` and `loan.txt` (untrusted text), `payroll.json` and `payees.json` (trusted). The output must pass the `PlanBook` schema, every citation's quote must appear verbatim in the cited clause, and payee addresses may only come from payroll.json or the payee register. Without `--model` an offline compiler reads the numbered clauses with fixed patterns (English summary only). The result is a draft until two owners sign.
- `npm run redteam:bare [-- --only <id-prefix>]` (`src/bare.ts`): the baseline from redteam/README.md. Same cases and model (`MODEL_NAME`), same business context and rules as the planner, but the model holds `transfer` / `propose_to_owner` tools on a simulated wallet (no chain, no key). It needs `MODEL_API_KEY` and writes the `bare` key of `../redteam/results/summary.json`. Run ours with the same model (`npm run redteam -- --model`) for a fair comparison.
- `npm run redteam:table` (`src/redteamTable.ts`): the Markdown tables for `docs/SECURITY.md` §5 from the paired model `summary.json`; a side that has not run shows "not run". Use `npm run redteam:table -- ../redteam/results/rules-summary.json` for the separate rules-only results.

## Layout

| Path | What |
| --- | --- |
| `src/config.ts` | `../.env`, `contracts/deployments/<network>.json`, paths; keys only via `secretKey()` |
| `src/abis.ts`, `src/chain.ts` | viem ABIs, clients, snapshot reads, revert decoding |
| `src/relayers/` | `hko.ts` (parser + attestation), `gdacs.ts` (event list, region mapping, event id), `sign.ts` (EIP-712, nonces in `state/nonces.json`), `submit.ts` (attest from the relayer's own key) |
| `src/llm/` | `provider.ts`, `rules.ts`, `anthropic.ts`, `extractor.ts`, `planner.ts` |
| `src/policy/localCheck.ts` | PlanModule's checks, same order and error names |
| `src/exec/` | `executor.ts` (typed PlanModule calls, `pause()`), `safeProposer.ts` (owner proposals: log + Safe Transaction Service as delegate), `calls.ts` (action → call), `refs.ts` (deterministic refs) |
| `src/controls.ts` | purchase orders, paid invoices and payroll the planner checks against |
| `src/pipeline.ts` | untrusted text → extractor → planner → executor |
| `src/loops/` | `storm.ts` (state machine, forecast, storm record), `everyday.ts` (one ordinary day), `inflows.ts` (Inflow matching), `reconcile.ts` (end-of-day check, pause) |
| `src/ledger.ts` | the day's ledger and the reconciliation arithmetic |
| `src/drafts.ts` | after-storm drafts for the owner |
| `src/relayers/live.ts` | live HKO and GDACS relayers (`npm run relayer:hko`, `relayer:gdacs`) |
| `src/sim.ts`, `src/redteam.ts` | offline PlanModule simulation; `npm run redteam` |
| `src/replay/` | `runner.ts` (CLI, dry run), `timeline.ts`, `run.ts` (real mode, `logs/run-<id>.json`) |
| `src/log.ts` | `logs/decisions.jsonl` |
| `src/server.ts`, `src/evidence.ts`, `src/keys.ts` | `npm run serve`, `npm run evidence`, `npm run keys:new` |
| `src/explain.ts`, `src/llm/planCompiler.ts` | owner explanations in four languages; plan book drafts from policy text |
| `src/bare.ts`, `src/redteamTable.ts` | bare-agent baseline; SECURITY.md §5 tables |

Logs (`logs/`) and state (`state/`) are gitignored; `LOG_DIR` and `STATE_DIR` override them.

## Not built yet, or not verified

- Safe Transaction Service proposals are unit-tested only (see above); adding the agent as a delegate is one owner command (`npm run safe:delegate`), not yet run.
- The model provider, the plan compiler's `--model` path and the bare-agent baseline have not been called live (no model key here).
- The live relayers run against the real HKO and GDACS endpoints, but a full live storm (attest → refresh after 6 h) has only been exercised with the fake clock. There is no live source for the Yagi (NCHMF) relayer; the Yagi variant is replay-only.
