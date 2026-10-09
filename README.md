# Signal 8 Wallet (风球钱包)

FinTechathon 2026, International Track, **Topic F (Agent Wallet)**.

An AI treasurer for a small business. It runs the business's money every day from **plans the owner signs in advance**, and switches to a **pre-signed storm plan** the moment an official typhoon signal is raised. The AI reads, forecasts, drafts and explains; smart contracts decide what money may move.

- Live demo: replay of Super Typhoon Ragasa (Hong Kong, 22 to 25 Sep 2025) on **Base Sepolia**.
- Second replay: Typhoon Yagi (Vietnam, 6 to 7 Sep 2024) on a local **FISCO BCOS** chain (stretch goal).
- Submission deadline: **20 Oct 2026, 23:59 Beijing (22:59 Vietnam)**.

## Where things are

| What | Where |
| --- | --- |
| Detailed implementation plan | [docs/PLAN.md](docs/PLAN.md) |
| Contract specs | [docs/specs/contracts.md](docs/specs/contracts.md) |
| Agent, relayer and replay specs | [docs/specs/agent.md](docs/specs/agent.md) |
| Security self-assessment (fill in as we go) | [docs/SECURITY.md](docs/SECURITY.md) |
| Demo script and demo-day checklist | [docs/DEMO.md](docs/DEMO.md) |
| Execution evidence (transaction hashes) | [docs/EVIDENCE.md](docs/EVIDENCE.md) |
| Questions for the organizers | [docs/ORGANIZER_QUESTIONS.md](docs/ORGANIZER_QUESTIONS.md) |
| How we work (branches, PRs, done) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Task board | Notion: "FinTechathon 2026: hackathon tasks" |

## How it works, in one picture

```
 Owner (calm day) ──signs──▶ PlanModule (on-chain) ◀──unlocks storm plan── SignalAttestor ◀── HKO relayer
                               ▲         │                                                  ◀── GDACS relayer
 Emails, invoices ──▶ AI agent ┘proposes │ allowed actions only
 (untrusted)                             ▼
                               Business Safe (2-of-3: owner, partner, agent)
                                         │ pays, claims, draws, sweeps
                 ┌───────────────┬───────┴────────┬──────────────────┐
           staff/suppliers  MockSignalCover  FlowCreditLine    MockMMFVault, EvidenceRegistry
```

## Repository layout

```
contracts/   Foundry project (Solidity 0.8.11, OpenZeppelin 4.9): PlanModule, SignalAttestor, mocks
agent/       TypeScript: relayers, replay runner, extractor, planner, executor, everyday loop
web/         Dashboard and attack arena (Next.js, to be scaffolded)
data/        Replay timelines (Ragasa, Yagi) and demo fixtures (invoices, payroll, plans)
redteam/     Attack suite and benchmark harness
docs/        Plan, specs, security self-assessment, demo, evidence
```

## Quick start (once the code lands)

```bash
# contracts
cd contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v4.9.6 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge build && forge test

# agent
cd ../agent
cp ../.env.example ../.env   # fill in RPC, keys, Safe address
npm install
npm run typecheck
npm run replay -- --event ragasa-2025 --speed 600 --dry-run   # dry run works today
```

## Ground rules

1. **No private key ever goes near a model.** The agent backend signs; the model only emits typed actions.
2. **Nothing typed into a chat, email or invoice can widen the agent's authority.** Only signed plans and two-source official signals can.
3. **Every money movement is a transaction hash** we can put in `docs/EVIDENCE.md`.
4. Testnet only. No real funds, no token issuance, no yield promises. Insurer and lender are labelled mocks.
