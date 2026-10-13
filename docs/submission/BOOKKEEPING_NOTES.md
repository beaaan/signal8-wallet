# Demo operational bookkeeping notes

These notes describe the prototype's cash, fund and loan movements for the technical document. They are not audited financial statements, tax advice or a complete statutory accounting system. mUSD is a fictional six-decimal demo token; nominal demo amounts are approximately USD, not live settlement funds.

## What each movement means

| Transaction | Safe cash | Fund/debt | Operational interpretation |
|---|---|---|---|
| Insurance payout C | +C | No loan increase | Compensation received; retain cover event ID, claim evidence and transaction |
| Credit draw D | +D | Outstanding principal +D | Borrowing, **not revenue**; separate from cover/customer income |
| Payroll W | -W | No direct fund/debt movement | Wage payment; allocate employee, payroll period, amount, reference and transaction |
| Deposit into vault V | -V | Withdrawable fund assets +V, subject to measured rounding | Asset transfer, **not supplier expense** |
| Withdraw from vault V | +V | Withdrawable fund assets -V, subject to measured rounding | Asset transfer, **not sales revenue** |
| Customer payment through router, gross G and sweep S | +(G-S) | Outstanding principal -S | Gross receipt G settles the customer's invoice; S repays borrowing before the remainder reaches Safe |
| Supplier payment P | -P | No direct debt movement | Allocate to verified invoice/payable; cash paid alone does not prove goods were received |
| Owner direct Safe payment P | -P | Depends on verified purpose | Record its transaction and allocation separately; no PlanModule spending counter increment if module was bypassed |

Do not book both G and G-S as separate cash receipts. Do not subtract S again from Safe cash: that portion never entered Safe. An exact receipt match can still have a repayment sweep; invoice allocation is based on **gross** receipt, not net cash.

`balances.creditDrawn` in the existing report reads lender `drawn()`, which decreases on repayment. Interpret it as **outstanding principal**, not total ever borrowed. Vault balance is withdrawable token assets from `maxWithdraw`, not a supplier cost or the count of fund shares.

## Storm example from the historical local run

Source: Anvil `demo-local`, chain 31337, executed on 9 October 2026 with September 2025 simulated business dates. These are run/log descriptions, not freshly verified chain receipts or a complete closing trial balance. Preserve original values.

| Recorded operation | Safe effect (mUSD) | Fund effect | Debt effect | Supporting identifier |
|---|---:|---:|---:|---|
| Pre-storm vault withdrawal | +15,000 | -15,000 | 0 | `0x8e58f2a9b5e8e5aa7d4129dae7a46a132460f54181c9280a29e103fb2e52f25a` |
| Cover payout | +20,000 | 0 | 0 | `0x84884d431cbbee903246c8a3931ecde30994e66a926b3247808229bddb1de142` |
| Payroll: ten staff at 2,300 each | -23,000 | 0 | 0 | Ten separate pay transactions in `run-demo-local.json`, payroll period `2025-09` |
| Emergency borrowing | +15,000 | 0 | +15,000 | `0x2d98324f7ec1ae0bb0a1b565bf390c1cac03cfcacb0c0f0562e95e86c10fdd74` |
| Post-storm customer receipt: gross 5,000, swept 500 | +4,500 | 0 | -500 | `0xa1c1a6d38b560d5cebd563963d0b6a1d82a0afd542fb6667cc394c4e4a00549d`, receivable `INV-C-2025-09-25` |

The selected movements sum to +31,500 Safe cash, -15,000 fund assets and +14,500 principal. These are **selected movement totals**, not independently observed closing balances; other movements, approvals, liabilities and timing must be considered before presenting a complete period close.

The existing daily report is sealed during the **ordinary-day phase before** those storm actions. Its closing balances are not end-of-storm balances. The replay run records later actions, but does not currently perform a second daily-report reconciliation for the whole replay. See [review](../RECONCILIATION_REVIEW.md).

## Allocation and exceptions

- Exact customer receipt: allocate the gross amount to the invoice; record gross, swept principal, net cash, transaction and matching status.
- Short receipt: retain the amount actually received and its remaining receivable; flag owner follow-up. Do not pretend the invoice was fully paid.
- Overpayment: allocate the verified invoice amount and hold the excess for owner refund/credit review; a warning must not initiate a refund from an untrusted message.
- Unknown invoice reference: retain actual gross/net movement as unallocated cash; owner identifies the customer and receivable.
- Refused input: decision evidence only, not a cash expense or payment.
- Owner proposal: pending approval, not a settled payable or cash movement.
- Later-due/scheduled action: intended payment, not a completed transaction.
- Direct owner movement: needs independently verified transaction and purpose. A handwritten claim does not create a trusted accounting record.

An inflow warning need not pause a financially consistent day. An unexplained Safe movement, vault difference above the rounding tolerance, or applicable PlanModule counter mismatch currently triggers pause and an owner alert. Vault tolerance is **2 token base units = 0.000002 mUSD**, not 2 mUSD. UTC rollover resets counters; cash/fund checks continue but interval-spend completeness still needs event-level support.

## Minimum review bundle

Retain network, chain ID, run/business date, token address/decimals, observed opening and closing block snapshots, invoice/payee allocations, gross and net inflows, repayment/draw details, refusal/proposal/schedule records, comparison differences, pause outcome, canonical report bytes and anchor receipt/hash.

`reconciliation: null` means no reconciliation ran. `ok: true` currently means the compared **cash/fund/counter deltas** matched within their scope; it does not prove event completeness, debt reconciliation, goods delivery or commercial validity. Offsetting transfers can cancel in balances. Report anchoring seals content; it does not make missing information accurate or independently verified.

Base Sepolia run `1791607899` has published references in `docs/EVIDENCE.md`, but the original matching report/log export and full hash comparison remain **Not verified**. Do not present the Anvil example above as Base Sepolia evidence or an audited result. Future report changes must produce new report bytes and hashes; never rewrite historical reports or anchors.
