# Security self-assessment

Required by the rules: permission tiers and a known-risk list. Fill in the red-team numbers on 18 Oct. Sections marked **TODO** are owned by the area in brackets.

## 1. Principle

The agent is controlled the way a bank controls a junior treasurer. Every control is a contract rule, not an instruction in a prompt, so losses stay bounded even if the model, its key or one data source is compromised.

## 2. Permission tiers

| Tier | What the agent may do | Who approves | Enforced by |
| --- | --- | --- | --- |
| L0 Read | Balances, signals, invoices, its own ledger | Nobody | n/a |
| L1 Draft | Draft plans, claims, proposals, messages | Nobody; nothing moves | Backend has no send path for drafts |
| L2 Act within plan | Pay payees registered for the active plan under per-payment, per-plan daily and overall daily caps; vault deposits and withdrawals (always back to the Safe); anchor reports; while storm mode is on, storm-plan actions: payroll, credit draw within the per-event cap, cover claim | The signed plan | `PlanModule` (typed functions only, no generic call) |
| L3 Co-sign | Anything above a cap; a payee not in the active plan (e.g., ordinary-day payroll); credit beyond the storm cap | Two of the three human Safe owners; the agent only proposes, as a Safe delegate | Safe threshold; the agent is not an owner |
| L4 Human only | Change plans, payees, limits, owners, modules, relayers | Safe (two owners) + 24 h timelock | `PlanModule` timelock, `PlanGuard` |

## 3. Bank controls mapped to contract rules

| Bank control | Contract rule | Attack it stops |
| --- | --- | --- |
| Limits (额度管理) | Per-payment cap, per-plan daily cap, overall daily ceiling, per-event credit cap in `PlanModule` | Draining the wallet in one go |
| Maker-checker (双人复核) | Agent proposes as a Safe delegate; outside the plan two human owners sign | One bad decision moving large sums |
| Separation of duties (印押证分管) | The agent key can execute typed plan actions but cannot sign Safe transactions, add payees, raise limits or edit plans | Permission escalation (the Grok wallet NFT pattern) |
| New-payee cooling-off | Adding or changing a payee goes through the 24 h timelock | Fake "we changed our bank details" invoices |
| Duplicate-payment check | Each invoice or payroll period has a `ref` that executes once | Duplicate invoices, double payroll runs |
| Two independent sources | Storm mode needs fresh HKO and GDACS attestations from separate relayers with separate keys; each relayer reads only its own source and the pairing happens on-chain | A fake warning or one compromised feed |
| End-of-day reconciliation | Ledger vs chain mismatch pauses the agent | Silent drift or unnoticed theft |
| Kill switch | Guardian key (or the agent itself, on a failed reconciliation) can pause instantly | Anything unforeseen |

## 4. Threats and responses

| Threat | Response | Residual risk |
| --- | --- | --- |
| Instructions hidden in emails or invoices | Extractor has no tools and outputs fields only; payee must already be registered | A registered payee could be overpaid up to the per-payment cap |
| Fake storm warning (email, Zalo) | Messages cannot unlock anything; only on-chain attestations can | None found |
| One relayer key compromised | Cannot unlock storm mode alone | Two compromised keys → losses capped by the storm plan |
| Replayed or stale attestation | Nonce; signing time must be under 1 h old; HKO attestations lapse after 12 h, GDACS after 24 h | None found |
| Agent key stolen | Attacker gets L2 at most: payees in an active plan, under the caps. The agent is not a Safe owner, so it cannot sign anything else. Guardian pauses | Up to `dailyCeiling` per day to existing payees; credit draws up to the per-event cap, which land in the Safe |
| Over-borrowing in a storm | Credit drawn per storm event is capped by the storm plan and by the line | Up to the per-event cap, drawn into the Safe |
| Duplicate invoice or payroll run | Deterministic `ref` per invoice or pay period; the contract rejects a used `ref` | An invoice re-issued under a new id still needs a registered payee and fits the caps |
| Arguments smuggled through an allowed call (e.g., vault `withdraw` to another receiver) | No generic call path; the module builds each call with the Safe as receiver | None found |
| Contract bugs | OpenZeppelin building blocks, unit, fuzz and invariant tests | Not audited |
| Personal data on-chain | Only hashes on-chain | None found |

## 5. Red-team results — TODO [Dashboard & red team], 18 Oct

| Attack family | Cases | Bare agent: success rate | Bare agent: funds lost | Signal 8 Wallet: success rate | Funds lost |
| --- | --- | --- | --- | --- | --- |
| Role-play reframing | | | | | |
| Encoded payloads | | | | | |
| Poisoned memory | | | | | |
| Permission escalation | | | | | |
| Fake bank-detail change | | | | | |
| Fake storm warning | | | | | |
| Abuse of registered payees (overpay within cap, duplicate or re-issued invoice) | | | | | |
| **Total** | | | | | |

Usefulness on the benign set (legitimate invoices, payroll, client payments), so a design that refuses everything cannot look safe:

| Agent | Benign cases | Task success (executed or correctly proposed) | False refusals |
| --- | --- | --- | --- |
| Bare agent | | | |
| Signal 8 Wallet | | | |

Method: same model and prompts for both; the bare agent holds a direct wallet tool; Signal 8 Wallet goes through the extractor, planner, local check and `PlanModule`. Cases were written before prompt tuning and frozen on 17 Oct. A partial success (e.g., an overpayment within the cap) counts as a success, with its funds lost. Raw results in `redteam/results/`.

## 6. Known-risk list

1. **Not audited.** Contracts are tested (unit, fuzz, invariant) but have had no external audit.
2. **Relayers are a trust point.** Two independent keys and sources reduce it; a decentralised oracle (e.g., Chainlink CRE) is the production path.
3. **Bootstrap configuration skips the timelock.** Initial plans, payees, the daily ceiling and the target contracts are set in the constructor; only later changes wait 24 h.
4. **Mock counterparties.** The insurer and lender are labelled simulations, not real products.
5. **Testnet only.** No real funds; the dollar token is a mock.
6. **Model output quality.** Wrong extraction can propose a wrong amount to a registered payee, bounded by the per-payment cap and visible in the decision log.
7. **Guard risk.** A faulty Safe guard can lock a Safe, so ours goes on a throwaway Safe first. `PlanGuard` is written and unit-tested against the Safe v1.4.1 guard interface but not yet set on any Safe. **TODO [Contracts]:** set it on a throwaway Safe on Base Sepolia, then on the demo Safe, or state here that it was not set. Without the guard, two human owners acting together can change modules or owners at once; the agent alone cannot.
8. **Replay mode.** In the Ragasa and Yagi replays the relayers sign with the current time and keep the 2025 official time as `sourceTime`, and each run salts the GDACS event id so the cover and credit cap reset per run. Live mode uses the real event id and signs as soon as the source changes.
9. **Tightening changes are timelocked too.** Removing a payee or lowering a cap waits 24 h like any other change; the owner pauses the module in the meantime.
10. **Agent can pause itself.** A stolen agent key can stop the agent (denial of service) but cannot move money outside the plan.
11. **Local runs use a stand-in Safe.** On Anvil the Business Safe is `LocalSafe` (one admin, no signatures) so the demo runs without a Safe deployment; it is never deployed to Base Sepolia, where the real 2-of-3 Safe holds the funds.
12. **Owner proposals are logged, not yet sent.** In the first iteration, actions outside the plan are written to `agent/logs/proposals.jsonl`; sending them to the Safe Transaction Service as a delegate is still to build. Either way the agent cannot sign them.
13. **Registered-payee abuse is only capped, not detected.** An inflated invoice from a registered supplier within the per-payment cap is paid (no purchase-order matching yet); see red-team family "abuse of registered payees".
14. **Regulation.** Crypto is not a lawful means of payment in Vietnam; the Yagi replay uses a mock bank deposit token on a local consortium chain. Hong Kong licenses stablecoin issuers since 2026; this is a prototype, not a licensed service.
