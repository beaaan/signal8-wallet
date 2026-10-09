# web

Dashboard, plan book page and attack arena (Next.js 15 App Router, TypeScript, viem). Plan: [../docs/PLAN.md §5.4](../docs/PLAN.md#54-dashboard-and-arena-area-c).

The site is **read-only**. It reads chain state with viem and the agent's decision log through the agent HTTP API. It holds no keys and sends no transactions. The only write is the arena form: the website forwards the text to the agent, and the agent decides what happens.

## Pages

- `/` **dashboard** (polls `/api/dashboard` every 5 s). It shows:
  - connection status for the deployment file, the RPC and the agent API
  - storm banner: `SignalAttestor.isStorm(region)` and `currentEvent`, the latest HKO and GDACS levels, red when storm mode is on
  - paused banner
  - Safe mUSD balance, money-market fund position (`convertToAssets` of the Safe's shares), credit drawn / limit
  - active plan (storm if `isStorm`, else base) with its caps, `spentToday`, and `spentAllToday` against `dailyCeiling`
  - **Waiting for the owners**: agent decisions with outcome `proposed`, plus a link to the Safe Wallet queue on Base Sepolia
  - **Transactions**: PlanModule `Executed`/`PausedSet`, SignalAttestor `Attested`/`StormStarted`/`StormEnded`, PaymentRouter `Inflow`, MockSignalCover `Claimed`, FlowCreditLine `Drawn` and EvidenceRegistry `Anchored`, scanned from the deployment's `startBlock`, newest first, with Basescan links on chain 84532. Payee addresses are shown by their plan book names.
  - **Agent decisions** (executed / refused / proposed, with the reason)
- `/plan` **plan book** in the owner's language (`?lang=` over the summary's language tags; rule lines exist in `en` and `zh-Hant`, and other languages fall back to English). Each plan's rules are shown in plain words with amounts, with citations under the rule they support. Also shown: the payee list, and the plan hash computed here with the same canonical JSON as the agent. That hash is checked against `plans(0).planHash` and `plans(1).planHash`: "matches the signed plan on-chain", "does not match" or "not connected".
- `/arena` **attack arena**: a QR code to the page, a text box (2,000 characters at most) and a channel select. The live board polls `/api/arena/board` every 3 s and shows only the outcome and the first 80 characters of each attempt. Submissions are rendered as React text only, never as HTML.

Route handlers: `app/api/dashboard` (GET), `app/api/arena` (POST, forwards to the agent), `app/api/arena/board` (GET, proxied).

Library: `lib/config.ts` (env), `lib/deployments.ts` (reads `../contracts/deployments/<NETWORK>.json`), `lib/abis.ts`, `lib/chain.ts` (viem reads and the event feed), `lib/plan.ts` (plan book loader, `canonicalJson`, `planHash`), `lib/agentApi.ts`, `lib/dashboard.ts` (puts it all together), `lib/format.ts` (display helpers used by the browser).

Any of the three sources can be missing: no deployments file, RPC down or agent API down. When one is missing the page shows "not connected" for that part and renders the rest.

## Environment

Put these in `web/.env.local` (see `.env.example`) or in the shell. The website does not read the repo root `.env`, because that file holds keys.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NETWORK` | `anvil` | Selects `../contracts/deployments/<NETWORK>.json` |
| `RPC_URL` | `http://127.0.0.1:8545` | RPC when `NETWORK` is not `base-sepolia` |
| `BASE_SEPOLIA_RPC` | `https://sepolia.base.org` | RPC when `NETWORK=base-sepolia` |
| `AGENT_API_URL` | `http://127.0.0.1:8787` | Agent HTTP API (`agent: npm run serve`) |
| `PUBLIC_ARENA_URL` | request origin + `/arena` | What the arena QR code points to. Set it when presenting from a laptop, e.g. `http://192.168.1.20:3000/arena` |
| `REPO_ROOT` | `..` (the parent of `web/`) | Where `contracts/` and `data/` are |

The plan book is read from `../data/fixtures/plans/plan-book.json`, or `plan-book.example.json` when that file does not exist.

## Run against the local anvil deployment

```sh
# 1. chain + contracts (see contracts/README.md); this writes contracts/deployments/anvil.json
anvil
# 2. agent API (see agent/README.md)
cd agent && npm run serve
# 3. website
cd web
npm install
npm run dev          # http://localhost:3000 (defaults: NETWORK=anvil, RPC 127.0.0.1:8545, agent 127.0.0.1:8787)
```

For Base Sepolia, run `NETWORK=base-sepolia BASE_SEPOLIA_RPC=… npm run dev`. The feed then links to sepolia.basescan.org and "Waiting for the owners" links to the Safe Wallet queue.

To let judges' phones reach the arena, run `npm run build && npm start -- -H 0.0.0.0` and set `PUBLIC_ARENA_URL` to the laptop's LAN address.

## Scripts

- `npm run dev`, `npm run build`, `npm start`
- `npm run typecheck`: `tsc --noEmit`
- `npm run check:plan-hash [-- <plan-book.json>]`: hashes the plan book with `web/lib/plan.ts` and with the agent (`cd agent && npx tsx src/plan.ts …`), and fails if the two disagree. It needs `npm install` in `agent/`.

There is no lint script yet. `next lint` is deprecated in Next 15.5 and needs interactive setup.

## Arena notes

- The arena runs on a local test chain (an Anvil fork), never the demo Safe. A believable invoice from a registered supplier would really be paid. The agent refuses arena input (HTTP 403) unless its `NETWORK` is `anvil`.
- The website caps input at 2,000 characters, rate-limits 5 submissions per minute per IP (in memory), and sends the client IP in `X-Forwarded-For` so the agent can apply its own per-IP limit. It turns the agent's 403, 413 and 429 responses into friendly messages, and shows a 503 "not connected" message when the agent is down.
- Before demo day, check that the host loads from where we present. Many `*.vercel.app`-style hosts are blocked in mainland China. The fallback is the presenter's laptop on a phone hotspot.
