# Security self-assessment

Required by the rules: permission tiers and a known-risk list. Fill in the red-team numbers on 18 Oct. Sections marked **TODO** are owned by the area in brackets.

## 1. Principle

The agent is controlled the way a bank controls a junior treasurer. Every control is a contract rule, not an instruction in a prompt, so losses stay bounded even if the model, its key or one data source is compromised.

## 2. Permission tiers

| Tier | What the agent may do | Who approves | Enforced by |
| --- | --- | --- | --- |
| L0 Read | Balances, signals, invoices, its own ledger | Nobody | n/a |
| L1 Draft | Draft plans, claims, proposals, messages | Nobody; nothing moves | Backend has no send path for drafts |
| L2 Act within plan | Pay registered payees under per-payment and daily caps; vault sweeps; reconciliation; storm-plan actions while storm mode is on | The signed plan | `PlanModule` |
| L3 Co-sign | Anything above a cap; first payment to a new payee; credit beyond the storm cap | Owner (2-of-3 Safe) | Safe threshold |
| L4 Human only | Change plans, payees, limits, owners, modules, relayers | Owner signature + 24 h timelock | `PlanModule` timelock, `PlanGuard` |

## 3. Bank controls mapped to contract rules

| Bank control | Contract rule | Attack it stops |
| --- | --- | --- |
| Limits (额度管理) | Per-payment and daily caps in `PlanModule` | Draining the wallet in one go |
| Maker-checker (双人复核) | Agent proposes; above a cap the owner co-signs | One bad decision moving large sums |
| Separation of duties (印押证分管) | The agent key can execute but cannot add payees, raise limits or edit plans | Permission escalation (the Grok wallet NFT pattern) |
| New-payee cooling-off | New or changed payees wait 24 h | Fake "we changed our bank details" invoices |
| Two independent sources | Storm mode needs HKO and GDACS attestations, separate keys, matching event, fresh | A fake warning or one compromised feed |
| End-of-day reconciliation | Ledger vs chain mismatch pauses the agent | Silent drift or unnoticed theft |
| Kill switch | Guardian key can pause instantly | Anything unforeseen |

## 4. Threats and responses

| Threat | Response | Residual risk |
| --- | --- | --- |
| Instructions hidden in emails or invoices | Extractor has no tools and outputs fields only; payee must already be registered | A registered payee could be overpaid up to the per-payment cap |
| Fake storm warning (email, Zalo) | Messages cannot unlock anything; only on-chain attestations can | None found |
| One relayer key compromised | Cannot unlock storm mode alone | Two compromised keys → losses capped by the storm plan |
| Replayed or stale attestation | Nonce, issue time, 12 h expiry | None found |
| Agent key stolen | Attacker gets L2 at most: registered payees under daily caps; guardian pauses | One day's cap at worst |
| Over-borrowing in a storm | One draw per event, capped by plan and line | n/a |
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
| **Total** | | | | | |

Method: same model and prompts for both; the bare agent holds a direct wallet tool; Signal 8 Wallet goes through the extractor, planner, local check and `PlanModule`. Raw results in `redteam/results/`.

## 6. Known-risk list

1. **Not audited.** Contracts are tested (unit, fuzz, invariant) but have had no external audit.
2. **Relayers are a trust point.** Two independent keys and sources reduce it; a decentralised oracle (e.g., Chainlink CRE) is the production path.
3. **Bootstrap configuration skips the timelock.** Initial plans, payees and allowed calls are set in the constructor; only later changes wait 24 h.
4. **Mock counterparties.** The insurer and lender are labelled simulations, not real products.
5. **Testnet only.** No real funds; the dollar token is a mock.
6. **Model output quality.** Wrong extraction can propose a wrong amount to a registered payee, bounded by the per-payment cap and visible in the decision log.
7. **Guard risk.** A faulty Safe guard can lock a Safe; ours was tested on a throwaway Safe first. **TODO [Contracts]:** confirm, or state that the guard was not deployed.
8. **Regulation.** Crypto is not a lawful means of payment in Vietnam; the Yagi replay uses a mock bank deposit token on a local consortium chain. Hong Kong licenses stablecoin issuers since 2026; this is a prototype, not a licensed service.
