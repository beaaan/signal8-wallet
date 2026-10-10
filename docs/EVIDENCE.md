# Execution evidence

Topic F requires real transaction hashes. `npm run evidence` prints the rows from the last replay; `npm run evidence -- --write` puts them in the "Latest run" section below. Only transactions that succeeded are listed; a reverted one stays in the decision log. Check every row before submission.

## Contract deployments (Base Sepolia, chain 84532)

| Contract | Address | Deploy tx |
| --- | --- | --- |
| Business Safe (2-of-3) | [`0xB1b4169eA856a2Edb709AE0ee284ceee10E7b60E`](https://sepolia.basescan.org/address/0xB1b4169eA856a2Edb709AE0ee284ceee10E7b60E) | [`0xc4839217…`](https://sepolia.basescan.org/tx/0xc4839217606dbec38d74ad859a35905793fe15374bd234d2a25da51efdfe0b9f) |
| PlanModule | [`0x12F764eEFb924d6109af638a218bDDAD96607c4A`](https://sepolia.basescan.org/address/0x12F764eEFb924d6109af638a218bDDAD96607c4A) | [`0x82862cfe…`](https://sepolia.basescan.org/tx/0x82862cfe86ddf4a89796fd92691ec108fd7803d9827f4a7f6c6a1e64cbba5a08) |
| SignalAttestor | [`0x76E9AD7D0aEF73d13eB87461a0e9918f549B78D2`](https://sepolia.basescan.org/address/0x76E9AD7D0aEF73d13eB87461a0e9918f549B78D2) | [`0x674ab2f3…`](https://sepolia.basescan.org/tx/0x674ab2f3adbf247afde6fb6607301d7662892024cb181f5b0903a32a08735bdd) |
| PlanGuard | [`0x10A139a8ee2C7f93f7aFa080753aAecE8D8D5F8e`](https://sepolia.basescan.org/address/0x10A139a8ee2C7f93f7aFa080753aAecE8D8D5F8e) | [`0xf3917ee9…`](https://sepolia.basescan.org/tx/0xf3917ee9266b7e8a0e0e711d79306a374cafd7a57c0c4b24775f834b970f23e2) |
| MockUSD | [`0x651CA08196e01eE973777Fe88010bD8751e61D3e`](https://sepolia.basescan.org/address/0x651CA08196e01eE973777Fe88010bD8751e61D3e) | [`0x7342361f…`](https://sepolia.basescan.org/tx/0x7342361f420a88bfe13a2d4b995dac7856a914a2a0f1cf3e0da752ca329da760) |
| MockSignalCover | [`0x08Ba0789Bc4D315F40b7CE1bDaff499B452a2C33`](https://sepolia.basescan.org/address/0x08Ba0789Bc4D315F40b7CE1bDaff499B452a2C33) | [`0x443ad4c5…`](https://sepolia.basescan.org/tx/0x443ad4c508055a06fc8400883614b644a7daac56954f04eb136265c644a2763c) |
| FlowCreditLine | [`0x311BF06caE13755f2fb45721319E6346ED70Cc08`](https://sepolia.basescan.org/address/0x311BF06caE13755f2fb45721319E6346ED70Cc08) | [`0xad9e12a2…`](https://sepolia.basescan.org/tx/0xad9e12a23b414bf1d31c7406e0203b4a2dfa4e9ca13cdf3d382a447919d3fff1) |
| PaymentRouter | [`0x851f33959E8E7B707767De4afD93b531492377a4`](https://sepolia.basescan.org/address/0x851f33959E8E7B707767De4afD93b531492377a4) | [`0xa131a853…`](https://sepolia.basescan.org/tx/0xa131a85399f05f6f181c9cabaddbc0bd9ba3522819f6aebbca605663d695500f) |
| MockMMFVault | [`0xba7F8bEA8EE05bCF838546Be239e470640eFe1eF`](https://sepolia.basescan.org/address/0xba7F8bEA8EE05bCF838546Be239e470640eFe1eF) | [`0x4cf6b52e…`](https://sepolia.basescan.org/tx/0x4cf6b52eee5b1a7f5d2d12faa14de932f5f2c2e1799cbae67fc37e0076c0854a) |
| EvidenceRegistry | [`0xeB7D846D782d6C69c28Caa2B2eD2d155125B8382`](https://sepolia.basescan.org/address/0xeB7D846D782d6C69c28Caa2B2eD2d155125B8382) | [`0xcd5a1568…`](https://sepolia.basescan.org/tx/0xcd5a15686d3ee2f5c129d183047c8d1154de3861be4586c6e9e4e9a4eb4e643a) |

Safe v1.4.1 (SafeL2 singleton, canonical SafeProxyFactory). Owners enabled PlanModule with two signatures in [`0x630e9e9d…`](https://sepolia.basescan.org/tx/0x630e9e9daaec9ee6b78b66c79a3e3d046dad9a6a677fe4c965ad1c8eb3cd4967). PlanGuard is deployed but not set on the Safe (SECURITY.md known risk 7). The three owner keys are testnet keys held together for now (SECURITY.md known risk 19).

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
