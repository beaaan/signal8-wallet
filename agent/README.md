# agent

TypeScript backend: relayers, replay runner, extractor, planner, local policy check, executor, storm and everyday loops, and the HTTP API for the dashboard. Spec: [../docs/specs/agent.md](../docs/specs/agent.md).

```bash
npm install
npm run typecheck
npm test               # vitest, no chain and no network
npm run replay -- --event ragasa-2025 --speed 600 --dry-run      # prints the timeline only
npm run plan:hash -- ../data/fixtures/plans/plan-book.example.json
npm run hko:now        # current HKO tropical cyclone signal
npm run gdacs:now      # current GDACS cyclone events and the one for HK
```

## Run locally against anvil

1. Start anvil and deploy the contracts (see `../contracts/README.md`); this writes `../contracts/deployments/anvil.json`.
2. Nothing else is needed: with `NETWORK=anvil` (the default) the agent uses anvil's public dev keys for any role whose key is not in `../.env` (agent #5, HKO relayer #6, GDACS relayer #7, demo client #8). On any other network a missing key is an error.
3. Full Ragasa replay, with one ordinary day first:

   ```bash
   npm run replay -- --event ragasa-2025 --speed 600
   # options: --run-id <id>  --rpc <url>  --pause-at-steps  --skip-everyday
   npm run evidence       # markdown rows for docs/EVIDENCE.md from the latest run
   ```

   The runner checks today's `spentToday` / `spentAllToday` first and refuses if the run would not fit the caps; the whole run lands in one chain day, so run it again on a fresh chain or tomorrow (UTC). Rehearse without using up a chain's day on a fork: `anvil --fork-url <rpc> --port 8555` and `--rpc http://127.0.0.1:8555`.
4. API for the dashboard and arena: `npm run serve` (port `AGENT_API_PORT`, default 8787). The arena (`POST /api/arena`) only runs when `NETWORK=anvil`.

Base Sepolia: `npm run keys:new` writes fresh keys for the agent, both relayers and the demo client into `../.env` (only where empty; never printed) and prints the addresses to fund. Set `NETWORK=base-sepolia`.

## Model

`MODEL_API_KEY` unset → the offline `rules` provider (regex extraction, name-matching planner); tests and CI always use it. With `MODEL_API_KEY` set, `MODEL_PROVIDER=anthropic` (the default then) calls the Anthropic Messages API with `MODEL_NAME` (default `claude-opus-5-5`, effort `low`), no tools, JSON output constrained by a schema and then validated with zod. The model never receives a private key or a tool, and the planner only ever sees validated fields and registry addresses.

## Layout

| Path | What |
| --- | --- |
| `src/config.ts` | `../.env`, `contracts/deployments/<network>.json`, paths; keys only via `secretKey()` |
| `src/abis.ts`, `src/chain.ts` | viem ABIs, clients, snapshot reads, revert decoding |
| `src/relayers/` | `hko.ts` (parser + attestation), `gdacs.ts` (event list, region mapping, event id), `sign.ts` (EIP-712, nonces in `state/nonces.json`), `submit.ts` (attest from the relayer's own key) |
| `src/llm/` | `provider.ts`, `rules.ts`, `anthropic.ts`, `extractor.ts`, `planner.ts` |
| `src/policy/localCheck.ts` | PlanModule's checks, same order and error names |
| `src/exec/` | `executor.ts` (typed PlanModule calls; proposals to `logs/proposals.jsonl`), `refs.ts` (deterministic refs) |
| `src/pipeline.ts` | untrusted text → extractor → planner → executor |
| `src/loops/` | `storm.ts` (state machine, forecast), `everyday.ts` (one ordinary day) |
| `src/replay/` | `runner.ts` (CLI, dry run), `timeline.ts`, `run.ts` (real mode, `logs/run-<id>.json`) |
| `src/log.ts` | `logs/decisions.jsonl` |
| `src/server.ts`, `src/evidence.ts`, `src/keys.ts` | `npm run serve`, `npm run evidence`, `npm run keys:new` |

Logs (`logs/`) and state (`state/`) are gitignored; `LOG_DIR` and `STATE_DIR` override them.

## Not built yet

- Safe proposals through Safe API Kit (`proposeTransaction` as a delegate) on Base Sepolia: proposals are only written to `logs/proposals.jsonl` for now (TODO in `exec/executor.ts`).
- `drafts.ts` (insurance claim, deadline list), `planCompiler.ts`, inflow matching and the reconciliation `pause()` in the everyday loop, live-mode relayer polling and 6-hourly re-attestation.
