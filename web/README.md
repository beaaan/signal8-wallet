# web

Dashboard, plan book page and attack arena (Next.js 15 App Router, TypeScript, viem). Plan: [../docs/PLAN.md §5.4](../docs/PLAN.md#54-dashboard-and-arena-area-c).

The site is **read-only**. It reads chain state with viem and the agent's decision log through the agent HTTP API. It holds no keys and sends no transactions. The only write is the arena form: the website forwards the text to the agent, and the agent decides what happens.

## Pages

- `/` **dashboard** (polls `/api/dashboard` 5 s after each answer, paused while the tab is hidden), in a quiet "ledger" style: labels and numbers, no sentences. Dotted labels and activity rows fold out their explanation on click, tap or Enter. `?big=1` or the `b` key enlarges everything for a projector.
  - **Status**: the plan in force as a title ("Storm plan on", "Everyday plan", "Paused", "Not connected"), the HKO signal drawn like the real symbol, and chips for the signal, GDACS level and when storm mode started. "Plan unknown" when the storm flag can't be read. A small "Live · 4s ago" dot turns red with a "Why?" list when the contracts, chain or agent can't be read, and keeps the time of the last good refresh
  - **Needs you**: owner approvals (decisions with outcome `proposed`) as rows of payee, reference, short reason and amount; drafts from one run fold into one row. A proposal drops off when a later log line shows the same payment handled. "Nothing needs you" when empty. On Base Sepolia "Review in Safe" opens the Safe Wallet queue
  - **Money**: cash in the Safe, the money-market fund (`convertToAssets`), borrowed vs credit limit, and typhoon cover (`claimed(eventId)`). Amounts carry no unit; the section names it once
  - **Limits**: bars for today's spend against the active plan's daily cap and the overall ceiling, plus credit drawn this storm (`drawnInEvent`), and the per-payment cap. Daily limits reset at 00:00 UTC (08:00 in Hong Kong)
  - **This storm / Last storm**: the HKO signal history as one line, with at most three short actions per signal. Chain actions are placed by block; agent decisions without a transaction are placed by their `storm:<code>` label
  - **Activity**: chain events and agent decisions merged into one list, grouped by plan and day, ten rows then "Show more". A payroll run folds into one row that opens to list each payment, as do back-to-back drafts. Each row has a time, an icon, a short title and the amount; transactions link to Basescan on Base Sepolia, and on anvil show a short hash with a copy button when the row is opened. Arena attempts (`arena:` inputs) and log lines older than the deployment's start block (an earlier anvil run) are left out
- `/plan` **plan book** in the owner's language (`?lang=` `en`, `zh-Hant`, `zh-Hans` or `vi`; any string or summary missing in that language falls back to English). Each plan's limits are shown as label and amount, allowed actions as chips, and each source clause folds out under the limit it supports. Also shown: the payee list, and the plan hash computed here with the same canonical JSON as the agent. That hash is checked against `plans(0).planHash` and `plans(1).planHash`: "matches the signed plan on-chain", "does not match", "hash couldn't be read" or "not connected". The hash has a copy button.
- `/arena` **attack arena**: a QR code to the page, a text box (2,000 characters at most) and a channel select. It shows "Arena closed" instead of the form when the arena agent's `GET /api/health` fails or reports a non-anvil network. The live board polls `/api/arena/board` every 3 s (and right after a submit) and shows only the outcome and the first 80 characters of each attempt. Submissions are rendered as React text only, never as HTML.

Route handlers: `app/api/dashboard` (GET), `app/api/arena` (POST, forwards to the agent), `app/api/arena/board` (GET, proxied).

Library: `lib/config.ts` (env), `lib/deployments.ts` (reads `../contracts/deployments/<NETWORK>.json`), `lib/abis.ts`, `lib/chain.ts` (viem reads and the event feed), `lib/plan.ts` (plan book loader, `canonicalJson`, `planHash`), `lib/agentApi.ts`, `lib/activity.ts` (timeline, storm strip, "Needs you"), `lib/words.ts` (plain-language reasons and labels), `lib/dashboard.ts` (puts it all together; every number and time is formatted on the server in the business's time zone), `lib/format.ts`. UI pieces live in `app/components/`: inline SVG icons, the HKO signal symbol and the nav. Fonts: IBM Plex Sans and IBM Plex Mono through `next/font`.

Any of the three sources can be missing: no deployments file, RPC down or agent API down. When one is missing the page shows "not connected" for that part and renders the rest.

## Environment

Put these in `web/.env.local` (see `.env.example`) or in the shell. The website does not read the repo root `.env`, because that file holds keys.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NETWORK` | `anvil` | Selects `../contracts/deployments/<NETWORK>.json` |
| `RPC_URL` | `http://127.0.0.1:8545` | RPC when `NETWORK` is not `base-sepolia` |
| `BASE_SEPOLIA_RPC` | `https://sepolia.base.org` | RPC when `NETWORK=base-sepolia` |
| `AGENT_API_URL` | `http://127.0.0.1:8787` | Agent HTTP API (`agent: npm run serve`) |
| `ARENA_AGENT_API_URL` | `AGENT_API_URL` | Agent the arena posts to and reads the board from, e.g. one on an anvil fork |
| `TRUST_PROXY` | unset | `1` only behind a reverse proxy that appends the client address to `X-Forwarded-For` |
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

For Base Sepolia, run `NETWORK=base-sepolia BASE_SEPOLIA_RPC=… npm run dev`. The feed then links to sepolia.basescan.org and "Review in Safe" opens the Safe Wallet queue.

To let judges' phones reach the arena, run `npm run build && npm start -- -H 0.0.0.0` and set `PUBLIC_ARENA_URL` to the laptop's LAN address.

## Scripts

- `npm run dev`, `npm run build`, `npm start`
- `npm run typecheck`: `tsc --noEmit`
- `npm run check:plan-hash [-- <plan-book.json>]`: hashes the plan book with `web/lib/plan.ts` and with the agent (`cd agent && npx tsx src/plan.ts …`), and fails if the two disagree. It needs `npm install` in `agent/`.

There is no lint script yet. `next lint` is deprecated in Next 15.5 and needs interactive setup.

## Arena notes

- The arena runs on a local test chain (an Anvil fork), never the demo Safe. A believable invoice from a registered supplier would really be paid. The agent refuses arena input (HTTP 403) unless its `NETWORK` is `anvil`.
- The website caps the body at 64 KB and the text at 2,000 characters, and rate-limits in memory: 20 submissions per minute in total, and 5 per minute per client. A route handler cannot see the socket address, so without `TRUST_PROXY=1` everyone shares one client key and no IP is sent to the agent; with it, the last `X-Forwarded-For` hop is used and forwarded. Friendly messages for the agent's 403, 413 and 429, "not connected" (503) when it is down, and "Still deciding, watch the board" (202) when it does not answer within 60 s or answers 202 itself.
- Before demo day, check that the host loads from where we present. Many `*.vercel.app`-style hosts are blocked in mainland China. The fallback is the presenter's laptop on a phone hotspot.
