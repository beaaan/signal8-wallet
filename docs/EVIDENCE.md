# Execution evidence

Topic F requires real transaction hashes. `npm run evidence` prints the rows from the last replay; `npm run evidence -- --write` puts them in the "Latest run" section below. Only transactions that succeeded are listed; a reverted one stays in the decision log. Check every row before submission.

## Contract deployments (Base Sepolia, chain 84532)

| Contract | Address | Deploy tx |
| --- | --- | --- |
| Business Safe (2-of-3) | | |
| PlanModule | | |
| SignalAttestor | | |
| PlanGuard | | |
| MockUSD | | |
| MockSignalCover | | |
| FlowCreditLine | | |
| PaymentRouter | | |
| MockMMFVault | | |
| EvidenceRegistry | | |

## Ragasa replay (Base Sepolia)

Run id: ______ (salts the GDACS event id). Relayers sign with the run's wall-clock time; the 2025 HKO time is in each attestation's `sourceTime`. Every HKO signal change is also an attestation tx; the rows below list the ones that change state.

| # | Replay time (HKT) | Signal | Action | Tx hash | Result |
| --- | --- | --- | --- | --- | --- |
| 0 | 2025-09-22 12:20 | No. 1 | GDACS attestation (RAGASA-25, Red) | | |
| 1 | 2025-09-22 21:40 | No. 3 | Vault withdraw to buffer | | |
| 2 | 2025-09-22 21:40 | No. 3 | Anchor pre-storm evidence | | |
| 3 | 2025-09-23 14:20 | No. 8 NW | HKO attestation → StormStarted | | |
| 4 | 2025-09-23 14:20 | No. 8 NW | Cover claim | | |
| - | 2025-09-24 02:45 | No. 10 | Fake email: refused (no tx; decision log line) | n/a | refused |
| 5 | 2025-09-24 09:00 | No. 10 | Payroll, 10 staff under the storm plan (one row per tx) | | |
| 6 | 2025-09-24 09:00 | No. 10 | Credit draw | | |
| 7 | 2025-09-24 20:20 | No. 3 | HKO attestation → StormEnded | | |
| 8 | 2025-09-25 11:20 | Cancelled | Client payment via router, sweep resumes | | |

## Everyday run (Base Sepolia)

| # | Action | Tx hash | Result |
| --- | --- | --- | --- |
| 1 | Client payment via router (with sweep) | | |
| 2 | Supplier payment | | |
| 3 | Vault deposit | | |
| 4 | Daily report anchor | | |
| 5 | Over-cap payment proposed by the agent (delegate) → two owners signed | | |

## Latest run

Written by `npm run evidence -- --write` from the newest `agent/logs/run-<runId>.json`; everything between the markers is replaced on each write.

<!-- evidence:start -->
_No run written yet._
<!-- evidence:end -->

## Yagi replay (local FISCO BCOS, stretch)

Hashes from a local chain; verifiable on our node only.

| # | Time (ICT) | Event | Action | Tx hash |
| --- | --- | --- | --- | --- |
| | | | | |
