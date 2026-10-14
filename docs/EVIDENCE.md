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

Source code: all nine project contracts are verified as an **exact match** on [Sourcify](https://repo.sourcify.dev/84532/0x12F764eEFb924d6109af638a218bDDAD96607c4A) and verified on [Blockscout](https://base-sepolia.blockscout.com/address/0x12F764eEFb924d6109af638a218bDDAD96607c4A?tab=contract) (14 Oct, `contracts/script/verify-keyless.sh`; the links show PlanModule, the other addresses work the same way). Basescan verification still needs a Basescan API key.

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

First Base Sepolia run (10 Oct, run 1791607899) used `MODEL_PROVIDER=rules`: the DeepSeek endpoint was not reachable from the deploy environment, so the extractor and planner ran on rules; rerun with the model before submission. Three earlier attempts the same day stopped on stale reads from the load-balanced public RPC (fixed in `agent/src/rpc.ts`); the third ended with the agent pausing PlanModule on a false ledger mismatch ([`0xf063d626…`](https://sepolia.basescan.org/tx/0xf063d6260a5ee66ffa220389a07ab0a659bff3df9056e59cb1c3cfac6bd6d1fb)), and owners 1 and 2 unpaused it ([`0x3034fadb…`](https://sepolia.basescan.org/tx/0x3034fadb7c734c76c12da69416d4df03a74234a7055d53978ea90328b858093e)). Those runs also count toward that day's spent caps.

<!-- evidence:start -->
Run id: 1791607899 (base-sepolia, chain 84532); GDACS TC-1001211 salted as TC-1001211#1791607899 = `0x959fd8796223b96c4a3133f33a2f69ad1c4794151c1e41fc5d4bd0b7003f4adb`. Completed 2026-10-10T04:59:52.349Z

| # | Replay time (HKT) | Signal | Action | Tx hash | Result |
| --- | --- | --- | --- | --- | --- |
| 5 | 2025-09-22 12:20 |  | GDACS attestation: TC-1001211 (Super Typhoon Ragasa), Red | [0x8ff728e1…](https://sepolia.basescan.org/tx/0x8ff728e19128e231e3697197ee1cfbd5b365d4b08d93689c5afccc8f5de82e12) | ok |
| 6 | 2025-09-22 12:20 | No. 1 | HKO attestation: TC1 (level 1) | [0x23359c63…](https://sepolia.basescan.org/tx/0x23359c632f19b905fe01d0fc3ab7aa5799be43d633b92559bae1a8f7aae3bc16) | ok |
| 7 | 2025-09-22 21:40 | No. 3 | HKO attestation: TC3 (level 3) | [0x4ec187f9…](https://sepolia.basescan.org/tx/0x4ec187f9e96b1ed9fcbc49accc7ef346a6fafd2ff46915f50219bc81c306bff8) | ok |
| 8 | 2025-09-22 21:40 | No. 3 | Withdraw 15000 mUSD from the vault to the Safe (base plan) | [0x209be108…](https://sepolia.basescan.org/tx/0x209be10828fbca0b6d4d812fec84cc3d1a901d686b3ac5cef67fd0b588df7523) | ok |
| 9 | 2025-09-22 21:40 | No. 3 | Anchor PRE_STORM evidence hash 0xd5b86ebe… | [0xc4eb7cf3…](https://sepolia.basescan.org/tx/0xc4eb7cf341e64faf95961e62e4bfcb837fd53ca29570acff4ae40081c7237950) | ok |
| 10 | 2025-09-23 14:20 | No. 8 NW | HKO attestation: TC8NW (level 8) → StormStarted | [0xebf1bd33…](https://sepolia.basescan.org/tx/0xebf1bd33a7eb03a6959d6dbea7376f99037e6487072fd57248d1da498d836bd1) | ok |
| 11 | 2025-09-23 14:20 | No. 8 NW | Claimed the typhoon cover: 20,000 mUSD paid to the Safe (storm plan) | [0x2dda40f3…](https://sepolia.basescan.org/tx/0x2dda40f3658dcd586f4c5d6f43c8f571ae9ecb8b8e625e70c778259ba07738bb) | ok |
| 12 | 2025-09-24 01:40 | No. 9 | HKO attestation: TC9 (level 9) | [0x9386c6f1…](https://sepolia.basescan.org/tx/0x9386c6f1afe8aa33215f512bd506243b2369175f05bed0ef18377b05bccb56d3) | ok |
| 13 | 2025-09-24 02:40 | No. 10 | HKO attestation: TC10 (level 10) | [0xfbabb78b…](https://sepolia.basescan.org/tx/0xfbabb78b6881bf1b925bfa4e78ab42062d68b2468dcb1b5ed1399265e796cc07) | ok |
| - | 2025-09-24 02:45 | | Fake email: refused at planner (address not in payee registry) | n/a | refused |
| 14 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 01 under the storm plan (payroll:2025-09#1791607899) | [0x1efaed92…](https://sepolia.basescan.org/tx/0x1efaed92bcae755dc6eb8bc7647859daabede6a40d29ab1b0d8a3084f3359eda) | ok |
| 15 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 02 under the storm plan (payroll:2025-09#1791607899) | [0xbe9fda32…](https://sepolia.basescan.org/tx/0xbe9fda321cecb7510755ec90a49a43bb5b95fceae83ff906c851d0fcddd7ea07) | ok |
| 16 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 03 under the storm plan (payroll:2025-09#1791607899) | [0xa72b8d3b…](https://sepolia.basescan.org/tx/0xa72b8d3badc5be5fffde6f8319d2bb51774655c9b448a4a2e0fc72f26d3d0e19) | ok |
| 17 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 04 under the storm plan (payroll:2025-09#1791607899) | [0xd58b8bd3…](https://sepolia.basescan.org/tx/0xd58b8bd3fa588161c9430e6185a4e77943428f134766db6e139fc5004715425e) | ok |
| 18 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 05 under the storm plan (payroll:2025-09#1791607899) | [0x2e229208…](https://sepolia.basescan.org/tx/0x2e2292089b62fa62d5445caf7db1ad77b26f1f9edcfbbdf8cedb043f4ced3fca) | ok |
| 19 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 06 under the storm plan (payroll:2025-09#1791607899) | [0xe612e28b…](https://sepolia.basescan.org/tx/0xe612e28b314b4454b3834c11e595598bdcad9cb2b26db9561738b984e4996441) | ok |
| 20 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 07 under the storm plan (payroll:2025-09#1791607899) | [0x9c86d5af…](https://sepolia.basescan.org/tx/0x9c86d5afa9b7e581dcd7be4a30e7dd22ba762c344312a4e642d5fb5964b6ab3b) | ok |
| 21 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 08 under the storm plan (payroll:2025-09#1791607899) | [0x13c643fc…](https://sepolia.basescan.org/tx/0x13c643fc6a9c6a82a111bd454ae43fb64343d2ecb64a19aa0a8ca03c36bb14fb) | ok |
| 22 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 09 under the storm plan (payroll:2025-09#1791607899) | [0x2dfbfe88…](https://sepolia.basescan.org/tx/0x2dfbfe8822ae929a2f64fc4a9d47b54e6912dc3552383758eac65f12d9eb718f) | ok |
| 23 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 10 under the storm plan (payroll:2025-09#1791607899) | [0xe0636bbb…](https://sepolia.basescan.org/tx/0xe0636bbbfffdb1aa18a223492853960ad28cd8c08ed82ee625e944ba2e24b317) | ok |
| 24 | 2025-09-24 09:00 | No. 10 | Draw 15000 mUSD of emergency credit (storm plan) | [0x632cb4da…](https://sepolia.basescan.org/tx/0x632cb4daa67456bccd62c5ac58f4940a9d05989746182f2e282ee5d7528d1166) | ok |
| 25 | 2025-09-24 13:20 | No. 8 SE | HKO attestation: TC8SE (level 8) | [0x63269187…](https://sepolia.basescan.org/tx/0x63269187ad02fdfd3f838d58bd7d553eb3c7264d4567a0274aa52ef9cf23b80a) | ok |
| 26 | 2025-09-24 20:20 | No. 3 | HKO attestation: TC3 (level 3) → StormEnded | [0x3b93cf1b…](https://sepolia.basescan.org/tx/0x3b93cf1b60d8d0bb9abe800b97b7516f1627d59ea8538496a4e0f0bb7bdc2266) | ok |
| 27 | 2025-09-25 08:20 | No. 1 | HKO attestation: TC1 (level 1) | [0xfdcc0d36…](https://sepolia.basescan.org/tx/0xfdcc0d362b63a0bdd5571d7b57943a3065aff361627277df937bf85a30c1f772) | ok |
| 28 | 2025-09-25 11:20 | Cancelled | HKO attestation: CANCEL (level 0) | [0xa4302347…](https://sepolia.basescan.org/tx/0xa4302347f02d2819f8a2dbbd01647072c7602a5257764a60a1b6b491185d7b32) | ok |
| 29 | 2025-09-25 11:20 | Cancelled | Customer paid 5,000 mUSD for INV-C-2025-09-25#1791607899 into PaymentRouter (simulated client, not the agent) | [0xe8510dd4…](https://sepolia.basescan.org/tx/0xe8510dd4d8473a210b9a3c82341827b3364f1722a0fd412f863eefb03c47de07) | ok |

| # | Action | Tx hash | Result |
| --- | --- | --- | --- |
| 1 | Customer paid 8,000 mUSD for INV-C-2025-09-22#1791607899 into PaymentRouter (simulated client, not the agent) | [0x758893db…](https://sepolia.basescan.org/tx/0x758893db82f6afa14cab4c52f05fcc287272ca88c066bcdbdbb38872c804c081) | ok |
| 2 | Pay 1250.50 mUSD to Lee Kee Flour under the base plan (LK-0921#1791607899) | [0x05877e29…](https://sepolia.basescan.org/tx/0x05877e29bb30256d5528d0edbc43860b5fc8f3c1c66bdd7a8f91ade34354186d) | ok |
| 3 | Move 6749.5 mUSD of surplus into the money-market vault | [0x02dc6e6d…](https://sepolia.basescan.org/tx/0x02dc6e6d421efa6ee4f27f5ed674d95a4168e023244dbc426905f4d58540341e) | ok |
| 4 | Anchor DAILY_REPORT evidence hash 0xe8d92ea4… | [0x2f3ab570…](https://sepolia.basescan.org/tx/0x2f3ab57025c46898995a38268505fbc2e21b68e2cc4443b42b303d1a677566a9) | ok |
<!-- evidence:end -->

## Yagi replay (local FISCO BCOS, stretch)

Hashes from a local chain; verifiable on our node only.

| # | Time (ICT) | Event | Action | Tx hash |
| --- | --- | --- | --- | --- |
| | | | | |
