# Plan book

The plan book is the one document the owner reads and signs on a calm day. It holds both plans, the payees and the overall daily ceiling, in plain language and as exact numbers. Both on-chain plans store its hash, so anyone can check that what runs is what was signed.

- Schema: `PlanBook` in [agent/src/types.ts](../../agent/src/types.ts) (zod).
- Example: [data/fixtures/plans/plan-book.example.json](../../data/fixtures/plans/plan-book.example.json) (Ragasa dim-sum shop, fictional).
- Hash and chain parameters: `npm run plan:hash -- <file>` ([agent/src/plan.ts](../../agent/src/plan.ts)).

## Format

| Field | Meaning | On-chain |
| --- | --- | --- |
| `version` | Always `1` | no |
| `business`, `region` | Who and where; `region` is `HK` or `VN-QN-HP` | `region` must match `PlanModule.region` |
| `token` | Symbol and decimals of the token amounts are written in | used to convert amounts |
| `dailyCeiling` | Most the agent can pay registered payees through `pay` in one day, across both plans. Vault moves, credit draws, cover payouts and payments the owners make directly from the Safe are not counted | `dailyCeiling` |
| `payees[]` | `id`, `name`, `address`, `role` (`staff`, `supplier`, `other`), `plans` (`base`, `storm`) | `setPayee(address, mask)`; bit 0 = base, bit 1 = storm |
| `plans.base`, `plans.storm` | `perTxCap`, `dailyCap`, `creditCapPerEvent`, `actions` | `Plan` struct; actions become `ACT_*` bits |
| `summary` | Plain-language summary per language tag (`en`, `zh-Hant`, `zh-Hans`, `vi`) | no, but hashed |
| `citations[]` | For each rule, the document, clause and a short quote it comes from | no, but hashed |

Amounts are decimal strings in token units, as everywhere else in the repo. Validation also checks that credit and cover claims are storm-plan only, that a credit action and a positive credit cap come together, and that no address is listed twice.

Names, summaries and citations stay off-chain (they are personal or business data); only the hash goes on-chain.

## Hash

`planHash = keccak256(utf8(canonicalJson(planBook)))`, where canonical JSON is RFC 8785 (JCS): keys sorted, no whitespace. The hash covers the summary and citations too, so the owner signs exactly the text they read, not just the numbers.

Both `plans[BASE].planHash` and `plans[STORM].planHash` store the same plan book hash. The agent refuses to act if the hash of its local plan book differs from the on-chain one.

## How it reaches the chain

1. `npm run plan:hash -- data/fixtures/plans/plan-book.json` prints the hash and the chain parameters (amounts in token units, action bits, payee masks) as JSON.
2. **First deployment:** the deploy script reads that JSON and passes it to the `PlanModule` constructor (bootstrap, no timelock).
3. **Later changes:** the agent, as a Safe delegate, proposes `queueChange` transactions for each changed setter; two owners sign; after 24 h the owners apply them.
4. **Wording-only changes:** editing the summary or citations changes the hash but no number. `npm run plan:rehash -- <plan-book.json>` reads both plans, the ceiling and the payees on-chain, refuses if any of them would change, and prints the two `queueChange(setPlan(...))` transactions and, for after the 24 h delay, the two `applyChange` transactions that store the new hash in both plans. It signs nothing. Point the agent and `/plan` at the new plan book only once both plans store its hash; until then the agent refuses to act.

## Where plan books come from

- **By hand (must):** area D writes `data/fixtures/plans/plan-book.json` for Ragasa (and a Yagi one) by 11 Oct, starting from the example.
- **Plan compiler (should):** `agent/src/llm/planCompiler.ts` reads the owner's policy, loan terms and payroll (`data/fixtures/policy.txt`, `loan.txt`, `payroll.json`) and drafts a plan book with a citation for each rule. It is a model call with no tools, its output must pass the `PlanBook` schema, and it is only a draft: nothing changes on-chain until the owners sign. These documents are treated as untrusted text, like invoices.
- **Review and sign (should):** the dashboard's `/plan` page shows the plan book in the owner's language, each rule with its citation, the hash, and whether it matches the hash on-chain. Changes link to the Safe proposal to sign.
