# fixtures

Demo inputs (area D, by 11 Oct). All fictional.

Current supplier invoice assumptions are 200 mUSD for 50 kg high-gluten flour plus 20 kg rice flour, 1,200 for 40 kg pork shoulder, and 820 for 10 kg prawns. These are demo market proxies pending finance sign-off, not historical supplier quotations.

The already-paid LK-0917 record and its 1,250.50 mUSD purchase order retain their original amount for duplicate/reissue detection. That legacy sample is not a current flour-price benchmark. Recorded Base Sepolia transactions and the paired 10 Oct model benchmark also retain the amounts used in their original runs.

- `invoices/*.txt`: supplier invoices and emails as the agent would receive them
- `payroll.json`: 10 staff (Ragasa), wallet addresses, amounts
- `yagi/`: the Hai Phong garment workshop for the Yagi replay on a local FISCO BCOS chain, in mVND (a mock bank-issued VND deposit token): `payroll.json` (20 workers, 166,000,000 in total), `receivables.json`, and the `policy.txt` and `loan.txt` its plan book (`plans/plan-book.yagi.json`, hashed into `plans/plan-params.yagi.json`) cites. The agent reads them through `PLAN_BOOK`, `PAYROLL` and `RECEIVABLES` (see `agent/README.md`)
- `plans/plan-book.json`: the plan book the owner signs (both plans, payees, daily ceiling, summary, citations); start from `plans/plan-book.example.json`. Format and hashing: [docs/specs/plans.md](../../docs/specs/plans.md). Check it with `npm run plan:hash -- ../data/fixtures/plans/plan-book.json` in `agent/`
- `policy.txt`, `loan.txt`: the insurance policy and credit-line terms the plan compiler reads
