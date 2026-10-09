# fixtures

Demo inputs (area D, by 11 Oct). All fictional.

- `invoices/*.txt`: supplier invoices and emails as the agent would receive them
- `payroll.json`: 10 staff (Ragasa) and 20 workers (Yagi), wallet addresses, amounts
- `plans/plan-book.json`: the plan book the owner signs (both plans, payees, daily ceiling, summary, citations); start from `plans/plan-book.example.json`. Format and hashing: [docs/specs/plans.md](../../docs/specs/plans.md). Check it with `npm run plan:hash -- ../data/fixtures/plans/plan-book.json` in `agent/`
- `policy.txt`, `loan.txt`: the insurance policy and credit-line terms the plan compiler reads
