# Notes for AI coding assistants working in this repo

Project: Signal 8 Wallet, FinTechathon 2026 Topic F. Read `docs/PLAN.md` and the specs in `docs/specs/` before changing code.

Hard rules:

- Solidity **0.8.11** and OpenZeppelin **4.9.x** only (FISCO BCOS compatibility). Use custom errors.
- The model (extractor, planner) never receives private keys and never calls tools that move money. It returns JSON validated by zod in `agent/src/types.ts`.
- Untrusted text (emails, invoices, chat, arena input) goes only to the extractor. The two exceptions, kept by decision, are the plan compiler and the bare-agent baseline: no keys, no chain (`docs/SECURITY.md` known risk 18). Add no others.
- Every money movement goes through `PlanModule`; never add a path that calls the Safe directly from the agent key.
- Never commit `.env` or keys. Testnet only.
- Keep `docs/EVIDENCE.md` and `docs/SECURITY.md` accurate; they are submission deliverables.
