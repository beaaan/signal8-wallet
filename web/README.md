# web

Dashboard and attack arena (Next.js). Plan: [../docs/PLAN.md §5.4](../docs/PLAN.md#54-dashboard-and-arena-area-c).

Scaffold: `npx create-next-app@latest . --ts --app --eslint` (pin the version you get).

Pages:

- `/` dashboard: balances, active plan, storm banner, transaction feed (Basescan links), pending owner approvals (link into Safe Wallet). Reads chain events with viem and `agent/logs/decisions.jsonl`.
- `/arena` attack arena: text box behind a QR code; submissions go into the agent pipeline; live board of attempts and outcomes; rate limit per IP.
