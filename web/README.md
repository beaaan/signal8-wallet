# web

Dashboard and attack arena (Next.js). Plan: [../docs/PLAN.md §5.4](../docs/PLAN.md#54-dashboard-and-arena-area-c).

Scaffold: `npx create-next-app@latest . --ts --app --eslint` (pin the version you get).

Pages:

- `/` dashboard: balances, active plan, storm banner, transaction feed (Basescan links), pending owner approvals (link into Safe Wallet). Reads chain events with viem and `agent/logs/decisions.jsonl`.
- `/plan` plan book page (should): the plan book in the owner's language, each rule with its citation, the plan hash and whether it matches the on-chain `planHash`. Spec: [../docs/specs/plans.md](../docs/specs/plans.md).
- `/arena` attack arena: text box behind a QR code; submissions go into the agent pipeline; live board of attempts and outcomes.
  - Runs against an **Anvil fork** of Base Sepolia, reset before each session, never the demo Safe: a believable invoice from a registered supplier would really be paid.
  - Rate limit per IP, cap input length, show only the outcome and the first 80 characters on the projected board.
  - Must load on the judges' phones. If we present in mainland China, test the host from there (many `*.vercel.app`-style hosts are blocked); fallback is the presenter's laptop on a phone hotspot.
