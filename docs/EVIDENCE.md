# Execution evidence

Topic F requires real transaction hashes. `npm run evidence` appends rows from the last replay; check every row before submission.

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

| # | Replay time (HKT) | Signal | Action | Tx hash | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | 2025-09-22 21:40 | No. 3 | Vault withdraw to buffer | | |
| 2 | 2025-09-22 21:40 | No. 3 | Anchor pre-storm evidence | | |
| 3 | 2025-09-23 14:20 | No. 8 NW | HKO attestation | | |
| 4 | 2025-09-23 14:20 | No. 8 NW | GDACS attestation → StormStarted | | |
| 5 | 2025-09-23 14:20 | No. 8 NW | Cover claim | | |
| 6 | 2025-09-24 02:40 | No. 10 | Fake email: refused (no tx; decision log line) | n/a | refused |
| 7 | 2025-09-24 09:00 | No. 10 | Payroll | | |
| 8 | 2025-09-24 09:00 | No. 10 | Credit draw | | |
| 9 | 2025-09-24 20:20 | No. 3 | HKO attestation → StormEnded | | |
| 10 | 2025-09-25 11:20 | Cancelled | Client payment via router, sweep resumes | | |

## Everyday run (Base Sepolia)

| # | Action | Tx hash | Result |
| --- | --- | --- | --- |
| 1 | Client payment via router (with sweep) | | |
| 2 | Supplier payment | | |
| 3 | Vault deposit | | |
| 4 | Daily report anchor | | |
| 5 | Over-cap payment proposed → owner co-signed | | |

## Yagi replay (local FISCO BCOS, stretch)

Hashes from a local chain; verifiable on our node only.

| # | Time (ICT) | Event | Action | Tx hash |
| --- | --- | --- | --- | --- |
| | | | | |
