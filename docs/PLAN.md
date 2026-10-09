# Implementation plan

Ten working days, 10 to 20 Oct 2026. Submission closes **20 Oct, 23:59 Beijing (22:59 Vietnam)**; we aim to submit by **18:00 Vietnam** that day.

The one date that decides everything is **16 Oct**: if the Ragasa replay does not run end to end on Base Sepolia by then, cut scope in the order in [section 9](#9-risks-and-cut-order). Everything after 18 Oct is polish, evidence and documents.

Contents:

1. [What we must hand in](#1-what-we-must-hand-in)
2. [Team, areas and rhythm](#2-team-areas-and-rhythm)
3. [System overview](#3-system-overview)
4. [Milestones and acceptance criteria](#4-milestones-and-acceptance-criteria)
5. [Work plan by area](#5-work-plan-by-area)
6. [Day-by-day schedule](#6-day-by-day-schedule)
7. [Hand-offs between people](#7-hand-offs-between-people)
8. [Environments, keys and secrets](#8-environments-keys-and-secrets)
9. [Risks and cut order](#9-risks-and-cut-order)
10. [Definition of done for the whole project](#10-definition-of-done-for-the-whole-project)

---

## 1. What we must hand in

From the rules (Topic F):

| Deliverable | Where it lives | Owner area |
| --- | --- | --- |
| Technical documentation | `docs/` (architecture, specs, limitations) | Pitch & docs |
| 10-minute deck | exported PDF in `docs/submission/` | Pitch & docs |
| 5-minute demo video (optional; we do it) | link in README | Pitch & docs |
| Code with README and tests | this repo | Everyone |
| Security self-assessment: permission tiers + known-risk list | `docs/SECURITY.md` | Pitch & docs, with Dashboard (red team) |
| Execution evidence: **real transaction hashes** for Topic F | `docs/EVIDENCE.md` | Agent |

Scoring: task completion 40%, security & compliance 30%, innovation & interaction 30%, on-chain challenge bonus 0 to 5.

What earns each line is in the [plan doc](https://claude.ai/code/artifact/f02a0647-e8c2-4a34-a8f1-8a5fc763978e) ("Why it scores"). Short version:

- **Task completion:** one run produces 15 to 20 transaction hashes across everyday mode and the storm replay.
- **Security:** L0 to L4 tiers enforced by contract, bank controls mapped one to one, measured red-team numbers.
- **Innovation:** pre-signed plans under an official trigger, the live attack arena, plain explanations in Vietnamese, Cantonese and English.
- **Bonus:** original contracts, plus the same contracts on FISCO BCOS.

## 2. Team, areas and rhythm

| Area | Owns | Main folders |
| --- | --- | --- |
| **A. Contracts** | PlanModule, guard, SignalAttestor, mocks, Foundry tests, deployments, FISCO port | `contracts/` |
| **B. Agent** | relayers, replay runner, extractor, planner, executor, storm and everyday loops, evidence table | `agent/`, `data/` |
| **C. Dashboard & red team** | dashboard, owner approvals, attack arena, attack suite, benchmark | `web/`, `redteam/` |
| **D. Pitch & docs** | registration, organizer emails, tech doc, security self-assessment, deck, video, Yagi research | `docs/` |

With three people, merge C into D and drop the FISCO port.

**Rhythm:**

- **Daily check-in, 15 minutes, same time every day.** Each person says what they finished, what's next, and what blocks them. Update the Notion board right after.
- **Board:** Notion "FinTechathon 2026: hackathon tasks". One card per chunk of work; the checklist inside each card is the source of truth for sub-steps.
- **Code:** short-lived branches and pull requests into `main`, one reviewer. See [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Interfaces first:** A publishes ABIs and addresses to `contracts/deployments/base-sepolia.json`; B and C only read from there.

## 3. System overview

```
                         calm day                                    storm
  ┌──────────┐   signs plans    ┌──────────────────────┐   unlock   ┌────────────────┐
  │  Owner   │ ───────────────▶ │  PlanModule (+guard) │ ◀───────── │ SignalAttestor │ ◀── HKO relayer  (signal code)
  └──────────┘  (timelocked)    │  base plan, storm    │            └────────────────┘ ◀── GDACS relayer (cyclone event)
       ▲ co-signs over-cap      │  plan, payees, caps  │
       │                        └──────────┬───────────┘
  ┌────┴─────┐  typed actions              │ execTransactionFromModule
  │ AI agent │ ────────────────────────────┤
  └────▲─────┘                             ▼
       │ fields only            ┌──────────────────────┐
  ┌────┴──────────┐             │  Business Safe 2-of-3 │──▶ payees (staff, suppliers)
  │ Extractor     │             └──────────┬───────────┘──▶ MockSignalCover (claim)
  │ (no tools)    │                        │              ──▶ FlowCreditLine (draw; inflows swept via PaymentRouter)
  └────▲──────────┘                        │              ──▶ MockMMFVault (ERC-4626)
       │ untrusted                         ▼              ──▶ EvidenceRegistry (hashes)
  emails, invoices, chats            Dashboard + arena (reads events)
```

Key decisions (already made, don't reopen without a reason):

- **Chain:** Base Sepolia (84532). Safe v1.4.1 (Protocol Kit default). Safe's Allowance Module is **not** deployed on Base Sepolia, so our own `PlanModule` enforces limits.
- **Oracle:** two signing relayers (HKO, GDACS) with separate keys, verified on-chain by EIP-712. Chainlink Functions was shut down on testnets in June 2026; Chainlink CRE is a stretch goal only.
- **Solidity 0.8.11 + OpenZeppelin 4.9.x** everywhere, because FISCO BCOS supports at most 0.8.11.
- **Money:** a mock 6-decimal dollar token for payroll-sized amounts; one compatibility run with real test USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- **Vietnam (Yagi):** crypto is not a lawful means of payment in Vietnam, so the Yagi replay uses a mock bank-issued VND deposit token on a local FISCO chain.

Full specs: [contracts](specs/contracts.md), [agent, relayers, replay](specs/agent.md).

## 4. Milestones and acceptance criteria

| # | Date | Milestone | Accepted when |
| --- | --- | --- | --- |
| M1 | 12 Oct | **Foundations** | Repo, CI and keys work; the 2-of-3 Safe exists; `PlanModule` passes unit, fuzz and invariant tests locally and in CI |
| M2 | 14 Oct | **Storm trigger** | All contracts deployed and verified on Base Sepolia; replaying Ragasa makes `SignalAttestor` unlock storm mode at Signal 8 and lock it at Signal 3, visible as events |
| M3 | 16 Oct | **Replay works** | One command runs the full Ragasa replay plus one ordinary day; every step in the walkthrough produces a transaction hash; the dashboard shows it live |
| M4 | 18 Oct | **Security & freeze** | Red-team benchmark finished (bare agent vs ours); security self-assessment drafted; **feature freeze** |
| M5 | 20 Oct | **Submit** | Every deliverable in section 1 uploaded; confirmation saved |

The Ragasa walkthrough (what M3 must produce):

| Replay time (HKT) | Signal | Agent action | Evidence |
| --- | --- | --- | --- |
| 22 Sep 12:20 | No. 1 | Checks the storm plan is signed; sends the owner a 3-line summary | plan hash read |
| 22 Sep 21:40 | No. 3 | Brace: vault withdraw to buffer, pause non-urgent payments, anchor pre-storm evidence hash | 2 tx |
| 23 Sep 14:20 | No. 8 NW | Relayers attest; storm unlocks; claim cover payout; re-run forecast | 3 tx (2 attest + unlock event, claim) |
| 24 Sep 02:40 | No. 10 | Fake "move funds now" email arrives; rejected (not a registered payee, no plan allows it) | attack log entry |
| 24 Sep 09:00 | No. 10 | Payday: pay 10 staff; draw emergency credit within cap; repayment sweep paused | 10+ tx (batch allowed), draw tx |
| 24 Sep 20:20 | No. 3 | Storm plan locks; delayed supplier payments queued for owner | attest tx, lock event |
| 25 Sep 11:20 | Cancelled | Drafts insurance claim and deadline list; sweep resumes on next inflow | inflow tx with sweep |

## 5. Work plan by area

### 5.1 Contracts (area A)

Spec: [specs/contracts.md](specs/contracts.md). Build in this order; each step ends with green tests.

1. **Project setup (10 Oct).** `forge init`, `foundry.toml` pinned to solc 0.8.11, OpenZeppelin v4.9.6, remappings, CI job. Mock dollar token (`MockUSD`, 6 decimals, owner mint).
2. **`PlanModule` core (10 to 11 Oct).**
   - Storage: plans (base, storm), payee registry with `activeFrom` time, allowed calls per plan (target + selector), daily spend per plan with reset, agent address, paused flag.
   - `executeTransfer` and `executeCall` for the agent only; both go through `Safe.execTransactionFromModule`.
   - Every check is in the contract: caller is the agent, not paused, plan active (storm plan needs `attestor.isStorm()`), payee registered and past cooling-off, per-transaction cap, daily cap, call allowlist.
3. **Timelock and pause (11 to 12 Oct).** `queueChange(bytes)` / `applyChange(bytes)` after 24 h, only callable by the Safe. `pause()` instant from the Safe or the owner's guardian key; `unpause()` by the Safe.
4. **Tests (11 to 12 Oct), the M1 gate.**
   - Unit tests for every revert path.
   - Fuzz: random amounts and payees never exceed caps.
   - **Invariant:** total moved by the agent per day per plan ≤ that plan's daily cap; the agent can never call admin functions; storm-plan actions never execute while `isStorm()` is false.
5. **`SignalAttestor` (12 to 13 Oct).** EIP-712 verification of two attestations (HKO, GDACS), freshness windows, nonces, 12 h auto-expiry, configurable chain id (FISCO returns 0 from `CHAINID`). Tests with forged, stale, replayed and mismatched attestations.
6. **Mocks (12 to 14 Oct).**
   - `MockSignalCover`: pays a fixed sum once per event id when storm level ≥ 8.
   - `FlowCreditLine` + `PaymentRouter`: credit limit, `draw`, and a router that clients pay into; it forwards `sweepBps` to the lender and the rest to the Safe, and skips the sweep while storm mode is on.
   - `MockMMFVault`: OpenZeppelin ERC-4626 over `MockUSD`.
   - `EvidenceRegistry`: `anchor(bytes32 hash, bytes32 kind)` with an event.
7. **Transaction guard (should, 13 Oct).** Blocks Safe transactions that disable the module, change owners or threshold, or set a new guard, unless the change came through the timelock. Test on a throwaway Safe first: a broken guard can lock a Safe permanently.
8. **Deploy (14 Oct).** Foundry script deploys everything, enables the module on the Safe (a Safe transaction signed by 2 owners), registers demo payees, sets plans, verifies on Basescan, writes `contracts/deployments/base-sepolia.json` with addresses and ABIs.
9. **FISCO port (stretch, 17 to 19 Oct).** See 5.6.

### 5.2 Trigger and replay (area B)

Spec: [specs/agent.md](specs/agent.md), sections "Relayers" and "Replay".

1. **Replay data (12 Oct).** `data/replays/ragasa-2025.json` is already in the repo, transcribed from the HKO Ragasa report. Add the GDACS event id for RAGASA-25 (query GDACS `geteventlist` for TC events, Sep 2025).
2. **HKO relayer (12 to 13 Oct).** Two modes: `live` polls `warnsum` every 60 s; `replay` reads the JSON on a compressed clock. Maps `TC1/TC3/TC8NE/TC8SE/TC8SW/TC8NW/TC9/TC10/CANCEL` to levels 1/3/8/8/8/8/9/10/0, signs the EIP-712 attestation with its own key, and submits it.
3. **GDACS relayer (13 to 14 Oct).** Confirms an active tropical-cyclone event (alert level Orange or Red) whose affected countries include the region, signs with a separate key, and submits it.
4. **Replay runner (14 Oct).** `npm run replay -- --event ragasa-2025 --speed 600` drives both relayers and the agent clock. 600× compresses 23 hours to about 2.3 minutes; the demo uses a faster speed with pauses at each step.

### 5.3 Agent (area B)

1. **Plumbing (10 to 11 Oct).** TypeScript, viem, Safe Protocol Kit and API Kit, zod. Reads `contracts/deployments/*.json`. Keys come only from `.env`.
2. **Extractor (12 to 13 Oct).** A model call with **no tools** that turns one email or invoice into JSON matching `ExtractedInvoice`. Output validated with zod; anything invalid is dropped and logged. Test it with an invoice containing hidden instructions; the output must contain only fields.
3. **Planner (13 to 15 Oct).** A second model call that sees the ledger, forecast, active plan and extracted invoices, and returns a list of typed `Action`s (schema in [specs/agent.md](specs/agent.md)). It cannot call anything. The backend checks each action against a local copy of the plan before signing (defence in depth) and then the contract checks again.
4. **Executor (13 to 15 Oct).** Within plan → `PlanModule.executeTransfer/executeCall` signed by the agent key. Over cap → proposes a Safe transaction through the Transaction Service so the owner can co-sign in Safe Wallet.
5. **Storm playbook (14 to 16 Oct).** Brace, claim, payroll, credit draw, lock: the steps in the walkthrough table. Deterministic code drives the order; the planner only fills in amounts and payees.
6. **Cash forecast (should, 14 to 15 Oct).** 13 weeks from the ledger, payroll and scheduled bills; it sizes the credit draw, and the contract cap always wins.
7. **Everyday loop (15 to 16 Oct).** Match inflows to invoices; pay due bills to registered payees; sweep surplus to the vault; end-of-day reconciliation that hashes the report into `EvidenceRegistry` and pauses the agent on mismatch.
8. **After-storm drafts (should, 15 to 17 Oct).** Insurance claim with the evidence hash; Circular 53/2024 restructuring request in Vietnamese for the Yagi variant; deadline list. The owner sends them; the agent never does.
9. **Explanations (stretch, 16 to 17 Oct).** Every action gets a 2-line explanation in the owner's language with an explorer link.

### 5.4 Dashboard and arena (area C)

1. **Dashboard (15 to 17 Oct).** Next.js page reading chain events through viem: balances, active plan, storm banner, transaction feed with Basescan links, pending owner approvals with a link into Safe Wallet.
2. **Arena (should, 16 to 18 Oct).** A page behind a QR code: a text box where a judge pastes an attack (email, invoice text, chat). It goes into the same agent pipeline as real input. A live board lists each attempt and its outcome: refused by the extractor, refused by the backend, reverted on-chain, or executed. Rate-limit per IP.

### 5.5 Red team and benchmark (area C)

1. **Attack suite (15 to 17 Oct).** About 40 cases in `redteam/attacks/*.json`, 6 families:
   - role-play reframing (Freysa-style: "your transfer function handles incoming funds")
   - encoded payloads (Morse, base64, Unicode tricks)
   - poisoned memory (a planted "the owner approved this" note)
   - permission escalation (the NFT-gift pattern: "you now have admin rights")
   - fake bank-detail changes ("we changed our account, pay here")
   - fake storm warnings, including a fake Zalo message in Vietnamese
2. **Baseline (16 Oct).** The same model and prompts, but holding a plain wallet tool with no plan module. This is the comparison, so keep it fair.
3. **Benchmark (17 to 18 Oct).** Run every attack against both. Record attack success rate and funds lost per family. Chart for the deck; table for `docs/SECURITY.md`.

### 5.6 FISCO BCOS and Yagi (stretch, areas A and D)

1. Local 4-node chain: `bash build_chain.sh -l 127.0.0.1:4 -p 30300,20200`, web3 RPC enabled on port 8545 (FISCO BCOS v3.16).
2. Deploy `PlanModule` (standalone vault version, no Safe), `SignalAttestor` with the FISCO chain id, and a mock VND deposit token. `TIMESTAMP` is in milliseconds on FISCO: use the contracts' time-unit constant.
3. `data/replays/yagi-2024.json`: Vietnam's level 4 disaster risk warning on 6 Sep 2024, landfall in Quảng Ninh and Hải Phòng around 13:00 on 7 Sep, GDACS Red alert. Area D confirms the exact bulletin times from Vietnamese sources.
4. Run it; record the hashes as "local chain" in `docs/EVIDENCE.md`.

### 5.7 Pitch and docs (area D)

1. **10 Oct:** register; send [ORGANIZER_QUESTIONS.md](ORGANIZER_QUESTIONS.md).
2. **16 to 19 Oct:** technical document (architecture, plan format, contracts, agent loop, data sources, limitations).
3. **17 to 18 Oct:** security self-assessment in [SECURITY.md](SECURITY.md) with C's numbers.
4. **17 to 19 Oct:** deck following [DEMO.md](DEMO.md).
5. **19 Oct:** record the 5-minute video from a clean run; two timed rehearsals.
6. **20 Oct:** final check against section 1 and submit.

## 6. Day-by-day schedule

| Day | A. Contracts | B. Agent | C. Dashboard & red team | D. Pitch & docs |
| --- | --- | --- | --- | --- |
| **Fri 10 Oct** | Foundry setup, CI, MockUSD; start PlanModule | Keys, RPC, Safe API key, wallets funded; agent plumbing | Create the 2-of-3 Safe with A; Next.js scaffold | Register; organizer emails; kick-off call; everyone assigned on Notion |
| **Sat 11 Oct** | PlanModule core + timelock | Agent plumbing; read deployments JSON; MockUSD transfers via Safe SDK | Dashboard skeleton reading Safe balance | Collect demo fixtures: invoices, payroll, plans in `data/fixtures/` |
| **Sun 12 Oct** | Tests + invariant (**M1**) | Ragasa JSON + GDACS id; HKO relayer; extractor | Draft attack families; 10 first cases | Yagi research (bulletin times, Circular 53 text) |
| **Mon 13 Oct** | SignalAttestor + tests; guard (should) | HKO relayer done; planner skeleton | 25 cases; baseline harness design | Tech doc outline; security doc skeleton |
| **Tue 14 Oct** | Mocks; deploy + verify; deployments JSON (**M2** with B) | GDACS relayer; replay runner; executor (**M2**) | Dashboard reads PlanModule and attestor events | Deck outline and story |
| **Wed 15 Oct** | Support B; fix integration bugs | Storm playbook; forecast; everyday matching and payments | Dashboard tx feed; arena skeleton; 40 cases | Tech doc sections for contracts and trigger |
| **Thu 16 Oct** | Help debug end-to-end; start FISCO chain | Reconciliation; full replay end to end (**M3**) | Baseline agent; first benchmark run | Evidence table template filled as hashes appear |
| **Fri 17 Oct** | FISCO port | After-storm drafts; explanations (stretch) | Benchmark; arena live board | Security self-assessment; deck draft |
| **Sat 18 Oct** | FISCO port; README setup script | Bug fixes only (**freeze**) | Final benchmark numbers + chart (**M4**) | Deck with chart; tech doc complete |
| **Sun 19 Oct** | Yagi replay on FISCO; record hashes | Clean run for evidence; backup recording; pre-fund wallets | Arena polish; demo rehearsal | Record video; two rehearsals; final evidence table |
| **Mon 20 Oct** | Final checks | Final checks | Final checks | **Submit by 18:00 Vietnam**; save confirmation |

## 7. Hand-offs between people

| From → to | What | Format | When |
| --- | --- | --- | --- |
| A → B, C | Addresses and ABIs | `contracts/deployments/base-sepolia.json` (written by the deploy script) | 14 Oct, earlier with a local Anvil deployment |
| A → B | Event names and EIP-712 type hashes | [specs/contracts.md](specs/contracts.md) | 12 Oct |
| B → C | Agent decision log (for dashboard and arena) | JSON lines in `agent/logs/decisions.jsonl`, one per action or refusal | 15 Oct |
| B → D | Transaction hashes with descriptions | appended to `docs/EVIDENCE.md` by `npm run evidence` | from 14 Oct |
| C → D | Benchmark results | `redteam/results/summary.json` + chart PNG | 18 Oct |
| D → all | Fixtures (invoices, payroll, policy text, plans) | `data/fixtures/` | 11 Oct |

Until A deploys to Base Sepolia, B and C work against a local Anvil chain (`anvil` + the same deploy script).

## 8. Environments, keys and secrets

- Copy `.env.example` to `.env`. Never commit `.env` or any private key; CI has none.
- Separate keys for: owner, partner, agent, HKO relayer, GDACS relayer, deployer. Each person holds only the keys their area needs; the owner and partner keys stay with two different people.
- Test ETH from the Coinbase CDP faucet (Base Sepolia); test USDC from Circle's faucet (20 USDC per address every 2 hours).
- Safe Transaction Service on Base Sepolia needs a free API key from developer.safe.global.
- Model API key for the extractor and planner stays in the agent backend's `.env` only.

## 9. Risks and cut order

If a milestone slips, cut in this order. **Never cut** `PlanModule`, `SignalAttestor`, the relayers or the red-team benchmark: they carry the 30% security score.

1. FISCO port and Yagi replay
2. Owner explanations (chat bot)
3. Vault sweep in everyday mode
4. Credit pause logic in `PaymentRouter` (keep the draw)
5. Attack arena page (keep the benchmark; show results on a slide)
6. Transaction guard (state it as a known risk in `SECURITY.md`)

Other risks:

| Risk | Response |
| --- | --- |
| A broken guard locks the Safe | Test on a throwaway Safe; keep the guard optional until the end |
| Base Sepolia slow on demo day | Pre-recorded run; local Anvil fork as fallback |
| Organizers say testnet hashes don't count | Ask on 10 Oct; plan B is a tiny mainnet run on Base with a few dollars, owner-funded |
| Model output breaks the schema | zod validation drops it; the planner retries once, then the action goes to the owner |
| Scope creep | Anything not in this plan goes to a "later" column on Notion |

## 10. Definition of done for the whole project

- [ ] `forge test` green in CI; invariant test included
- [ ] `npm run replay -- --event ragasa-2025` completes on Base Sepolia from a fresh clone
- [ ] `docs/EVIDENCE.md` lists every hash from that run with what it did
- [ ] Red-team results in `docs/SECURITY.md`, bare agent vs ours, per family
- [ ] `docs/SECURITY.md` has the L0 to L4 tiers and the known-risk list
- [ ] Deck, video and technical document in `docs/submission/`
- [ ] Submitted, confirmation saved
