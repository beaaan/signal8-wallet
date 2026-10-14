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

Source code: all nine project contracts are verified as an **exact match** on [Sourcify](https://repo.sourcify.dev/84532/0x12F764eEFb924d6109af638a218bDDAD96607c4A) and verified on [Blockscout](https://base-sepolia.blockscout.com/address/0x12F764eEFb924d6109af638a218bDDAD96607c4A?tab=contract) (14 Oct, `contracts/script/verify-keyless.sh`; the links show PlanModule, the other addresses work the same way). Basescan verification still needs a Basescan API key. The verified PlanGuard source is the one deployed on 10 Oct; the repo's `PlanGuard.sol` has since gained a one-line fix (SECURITY.md known risk 7), so a newly deployed guard will differ from `0x10A1…5F8e`. The throwaway-Safe guard below is deployed from the current source and verified the same way.

Safe v1.4.1 (SafeL2 singleton, canonical SafeProxyFactory). Owners enabled PlanModule with two signatures in [`0x630e9e9d…`](https://sepolia.basescan.org/tx/0x630e9e9daaec9ee6b78b66c79a3e3d046dad9a6a677fe4c965ad1c8eb3cd4967). PlanGuard is not set on the demo Safe; it is set on a separate throwaway Safe below (SECURITY.md known risk 7). The three owner keys are testnet keys held together for now (SECURITY.md known risk 19).

### PlanGuard on a throwaway Safe (14 Oct)

`contracts/script/ThrowawayGuard.s.sol`, broadcast on 14 Oct (blocks 48109434 to 48109438; full record in `contracts/deployments/base-sepolia-throwaway-guard.json`). A new 1-of-1 Safe v1.4.1 owned by the deployer key, with a `PlanGuard` built from the current source (Sourcify exact match, Blockscout verified). This is not the demo Safe.

| Step | Address or Safe tx | Transaction |
| --- | --- | --- |
| Throwaway Safe created (1-of-1, SafeL2 v1.4.1) | [`0x1C78d136aE3277D93EA5db3D994cDAf1396e21A6`](https://sepolia.basescan.org/address/0x1C78d136aE3277D93EA5db3D994cDAf1396e21A6) | [`0x25716846…`](https://sepolia.basescan.org/tx/0x257168461f4dc8befa58ba857bd6c9067fa4bb6f37d8795e9659db700b476645) |
| PlanGuard deployed, bound to that Safe | [`0xA3e176F0b23E8D6d58b1c36A8A3EB950E8067c65`](https://sepolia.basescan.org/address/0xA3e176F0b23E8D6d58b1c36A8A3EB950E8067c65) | [`0x7c01b16c…`](https://sepolia.basescan.org/tx/0x7c01b16c891bfefeb1187786a9cc8f1018868122c29d85cd3b43f9324abd58d2) |
| 1 mUSD minted to the Safe | | [`0xeee60e6e…`](https://sepolia.basescan.org/tx/0xeee60e6e834e11876530786b791047dde7b9acbcffe9f8cae2e03a15712e3dc9) |
| `setGuard(PlanGuard)` as a Safe transaction the owner signs | Safe tx `0xb5eaaf62…` | [`0x3b850751…`](https://sepolia.basescan.org/tx/0x3b850751ec36253d699343d197baa35bab6fc399b3e1182f03fd4c96c8dfcf53) |
| Allowed Safe transaction through the guard: 1 mUSD back to the owner | Safe tx `0x2b87bd01…` | [`0x913a8c3b…`](https://sepolia.basescan.org/tx/0x913a8c3b19549576ff223820530e8562bb70ddcf1dfd2c804e5669dca9edfa80) |
| Blocked: `addOwnerWithThreshold`, `setGuard(address(0))` | not sent | reverts with `Blocked(0x0d582f13)` and `Blocked(0xe19a9dd9)` |

The two blocked transactions are simulations, not transactions: the script requires each to revert before it broadcasts anything, and after the broadcast an `eth_call` of the owner-signed `execTransaction` against the live Safe reverted with the same `PlanGuard.Blocked(selector)` data. The Safe's guard storage slot holds the guard's address, and `guard.safe()` returns the throwaway Safe. Gas: 259 k (Safe), 798 k (guard), 53 k (mint), 101 k (`setGuard`), 95 k (transfer).

## What each step of the demo leaves on-chain

Where each step of the Ragasa walkthrough (`docs/PLAN.md` §4) and the ordinary day shows up in the latest run below. Every HKO signal change is also an attestation transaction; the rows named here are the ones that change state.

| Step | Replay time (HKT) | Evidence in the latest run |
| --- | --- | --- |
| GDACS confirms the storm (RAGASA-25, Red) | 22 Sep 12:20 | "GDACS attestation" row (the event id is salted per run) |
| Brace: fund → cash, pre-storm snapshot | 22 Sep 21:40 | "Withdraw … from the vault" and "Anchor PRE_STORM" rows |
| Signal 8: storm mode on, cover claimed | 23 Sep 14:20 | "TC8NW … → StormStarted" and "Claimed the typhoon cover" rows |
| Fake "move all funds" email | 24 Sep 02:45 | "Fake email: refused" row (no transaction; decision log only) |
| Payday under the storm plan, emergency credit | 24 Sep 09:00 | ten "Pay 2300 mUSD to Staff NN" rows and the "Draw … emergency credit" row |
| Signal 3: storm mode off | 24 Sep 20:20 | "TC3 … → StormEnded" row |
| Next customer payment, repayment sweep resumes | 25 Sep 11:20 | "Customer paid … into PaymentRouter" row |
| Storm-period report reconciled and anchored | 25 Sep 11:20 | the last "Anchor DAILY_REPORT" row of the first table |
| Ordinary day: customer payment, suppliers paid, surplus to the fund, daily report anchored | 22 Sep | the second table (everyday rows 1 to 5) |
| An over-cap payment proposed by the agent (as Safe delegate) and signed by two owners | | **Not yet.** Needs a Safe Transaction Service API key, the agent registered as a delegate, and two of the three owner keys; proposals are written to `agent/logs/proposals.jsonl` meanwhile (SECURITY.md known risk 12) |

## Latest run

Written by `npm run evidence -- --write` from the newest `agent/logs/run-<runId>.json`; everything between the markers is replaced on each write.

Run 1791987647 (14 Oct, below) is the replay with the model: `MODEL_PROVIDER=openai`, `deepseek-flash`, the same endpoint as the red team. It used the plan book the owners signed on-chain on 10 Oct (hash `0x354c96c8…`: `data/fixtures/plans/plan-book.example.json` as of the commit before 03a9223). The 13 Oct rewording of that file (mUSD wording and a daily-ceiling note; no cap, payee or action changes, checked with `npm run plan:hash`) hashes to `0xb6b90f2a…` and has not been signed on-chain, so the agent refused to start with it (`PlanHashMismatch`, nothing sent). All 31 transactions succeeded (receipts checked on Base Sepolia), and both reconciliations matched the chain. The first Base Sepolia run, on the rules provider, is under [Earlier run](#earlier-run-10-oct-rules-provider).

<!-- evidence:start -->
Run id: 1791987647 (base-sepolia, chain 84532); GDACS TC-1001211 salted as TC-1001211#1791987647 = `0xbb65dc5765532b95458180abb68cc0b718a04be09dffa2ba48e49a04ecc22db2`. Completed 2026-10-14T14:29:44.272Z

| # | Replay time (HKT) | Signal | Action | Tx hash | Result |
| --- | --- | --- | --- | --- | --- |
| 6 | 2025-09-22 12:20 |  | GDACS attestation: TC-1001211 (Super Typhoon Ragasa), Red | [0x71f53221…](https://sepolia.basescan.org/tx/0x71f53221791ec10858f95078bfd097b493ce0b1aa9d945244e1deb3137a5bce5) | ok |
| 7 | 2025-09-22 12:20 | No. 1 | HKO attestation: TC1 (level 1) | [0x78752a3f…](https://sepolia.basescan.org/tx/0x78752a3ffa01a0f5027872eca88dc88ec37c10cb4ccd32efb41c6f8f6190f64b) | ok |
| 8 | 2025-09-22 21:40 | No. 3 | HKO attestation: TC3 (level 3) | [0x58aff90c…](https://sepolia.basescan.org/tx/0x58aff90cbfb807a4f6bb32cb923db6c49229db539c3efb4f9418d048abe2b9e5) | ok |
| 9 | 2025-09-22 21:40 | No. 3 | Withdraw 15000 mUSD from the vault to the Safe (base plan) | [0xaeb98141…](https://sepolia.basescan.org/tx/0xaeb98141a1619c4132f7d3f716328919f82408ca09a321cbed0a4ba64d9af763) | ok |
| 10 | 2025-09-22 21:40 | No. 3 | Anchor PRE_STORM evidence hash 0xeee13fbc… | [0xe95bea9a…](https://sepolia.basescan.org/tx/0xe95bea9ab43bdf2409ca2d1483d3a5ee149cb950605566dde1f1d5366a6fd70f) | ok |
| 11 | 2025-09-23 14:20 | No. 8 NW | HKO attestation: TC8NW (level 8) → StormStarted | [0x08b93721…](https://sepolia.basescan.org/tx/0x08b93721db24793a50319946f32683f337229added61d5a10dadc2d092230dd0) | ok |
| 12 | 2025-09-23 14:20 | No. 8 NW | Claimed the typhoon cover: 20,000 mUSD paid to the Safe (storm plan) | [0x5f87c1c4…](https://sepolia.basescan.org/tx/0x5f87c1c43435cd3732e2864e4186717b09b60d7e1b1abd3bdb8f98e75fa88d7b) | ok |
| 13 | 2025-09-24 01:40 | No. 9 | HKO attestation: TC9 (level 9) | [0xe6495735…](https://sepolia.basescan.org/tx/0xe6495735d50d05acf019f90680e7e565c6ad8adb0cbfe7df9e8563739f8f6903) | ok |
| 14 | 2025-09-24 02:40 | No. 10 | HKO attestation: TC10 (level 10) | [0x7e46b631…](https://sepolia.basescan.org/tx/0x7e46b6319686e390bc8d6cf8ed0726be214a0b75172978126ae709eadb91b3e8) | ok |
| - | 2025-09-24 02:45 | | Fake email: refused at planner (bank detail changes go through the owners' timelocked setPayee, never a message) | n/a | refused |
| 15 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 01 under the storm plan (payroll:2025-09#1791987647) | [0xb6dd5d1e…](https://sepolia.basescan.org/tx/0xb6dd5d1ea17c1b11b788cec74cd11b20f1b2a9c73ce5bf0c431cf1c25fa58d4c) | ok |
| 16 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 02 under the storm plan (payroll:2025-09#1791987647) | [0x17ea29c4…](https://sepolia.basescan.org/tx/0x17ea29c4c2c3f177bce4e87705067768c68f7a05e6c609407d2031a92124b305) | ok |
| 17 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 03 under the storm plan (payroll:2025-09#1791987647) | [0x17e04c5e…](https://sepolia.basescan.org/tx/0x17e04c5ea40ebdb5fa8c949a44aea228b1bcc42f71906de10fbc3f450ed997f9) | ok |
| 18 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 04 under the storm plan (payroll:2025-09#1791987647) | [0x09aa0925…](https://sepolia.basescan.org/tx/0x09aa0925b4043a9cdd31e76f57972fe0da37e2ebf5af51d30d32a93301aa3e7f) | ok |
| 19 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 05 under the storm plan (payroll:2025-09#1791987647) | [0xe9b2cffb…](https://sepolia.basescan.org/tx/0xe9b2cffb26d9bd64140e1a9a3c69ad04b3a37c1cf75e72ca965d1b16a12ebcbe) | ok |
| 20 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 06 under the storm plan (payroll:2025-09#1791987647) | [0xf1c14c76…](https://sepolia.basescan.org/tx/0xf1c14c767033655107f61e5bb15be621020a3f8db83eb1f7ef9328f9edca6f00) | ok |
| 21 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 07 under the storm plan (payroll:2025-09#1791987647) | [0xf9271e4d…](https://sepolia.basescan.org/tx/0xf9271e4d9a73dff774ab0c4d47525f3216f0be55f9f86b9723812bc0527824d0) | ok |
| 22 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 08 under the storm plan (payroll:2025-09#1791987647) | [0x33b64da5…](https://sepolia.basescan.org/tx/0x33b64da56005d56f1b13eb5b1ec4c5a38470ede05a147eb3ab2b634ed2525cc8) | ok |
| 23 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 09 under the storm plan (payroll:2025-09#1791987647) | [0xe0b8456e…](https://sepolia.basescan.org/tx/0xe0b8456e7dd8376c0fc0cb227acb1f711c2e1ee058d264e019eb580146e183fd) | ok |
| 24 | 2025-09-24 09:00 | No. 10 | Pay 2300 mUSD to Staff 10 under the storm plan (payroll:2025-09#1791987647) | [0xa5d5526c…](https://sepolia.basescan.org/tx/0xa5d5526c2b28bc23ebc82785eec6a88bd6c54fd95354ab43901e187fe0d0b80a) | ok |
| 25 | 2025-09-24 09:00 | No. 10 | Draw 15000 mUSD of emergency credit (storm plan) | [0x0da7d7c1…](https://sepolia.basescan.org/tx/0x0da7d7c128cd56032e77b1aa9f22fd07cd7f757e111ab8550ea6b5793a469bc9) | ok |
| 26 | 2025-09-24 13:20 | No. 8 SE | HKO attestation: TC8SE (level 8) | [0x0d4c321b…](https://sepolia.basescan.org/tx/0x0d4c321b6101964e80d676f05c17cab80b3325c6c5a3489c934dd475cb5eda0f) | ok |
| 27 | 2025-09-24 20:20 | No. 3 | HKO attestation: TC3 (level 3) → StormEnded | [0xfe53c957…](https://sepolia.basescan.org/tx/0xfe53c9579209dc33cbc4e468009da11b551b7941ce312deca333c1dbbc876439) | ok |
| 28 | 2025-09-25 08:20 | No. 1 | HKO attestation: TC1 (level 1) | [0x3c7087ae…](https://sepolia.basescan.org/tx/0x3c7087ae0e2e9d4beac8825b81a017463888061bce1f8ecbc1f96ce5e9c8d04e) | ok |
| 29 | 2025-09-25 11:20 | Cancelled | HKO attestation: CANCEL (level 0) | [0xa6616339…](https://sepolia.basescan.org/tx/0xa6616339e7e0f72888bae413134c77c4d90b80a5d83b48e3e9dea05f249aff1e) | ok |
| 30 | 2025-09-25 11:20 | Cancelled | Customer paid 5,000 mUSD for INV-C-2025-09-25#1791987647 into PaymentRouter (simulated client, not the agent) | [0xb7e72e85…](https://sepolia.basescan.org/tx/0xb7e72e859cc0401a33ee5520c43fd56a60b9c81f78458996acc52171eadad5c8) | ok |
| 31 | 2025-09-25 11:20 | Cancelled | Anchor DAILY_REPORT evidence hash 0x293305e7… | [0x6bed10de…](https://sepolia.basescan.org/tx/0x6bed10def9ae9dcc30599c4d0299a40b5ef782b6b6f37b7dabd79293fd8b523c) | ok |

| # | Action | Tx hash | Result |
| --- | --- | --- | --- |
| 1 | Customer paid 8,000 mUSD for INV-C-2025-09-22#1791987647 into PaymentRouter (simulated client, not the agent) | [0x391d7e0f…](https://sepolia.basescan.org/tx/0x391d7e0f085af7eb9b632e1872bc5418c75d13f87318a6297dabbb4e44689e9b) | ok |
| 2 | Pay 200.00 mUSD to Lee Kee Flour under the base plan (LK-0921#1791987647) | [0x8d64c573…](https://sepolia.basescan.org/tx/0x8d64c57337e19698bd6452dd1417b933f801e292f695c1d8e81ee4ddeea9a2d6) | ok |
| 3 | Pay 820.00 mUSD to Wing On Meats under the base plan (WO-2240#1791987647) | [0x3e90bb5a…](https://sepolia.basescan.org/tx/0x3e90bb5a499cd5f447ef553290f6d6862aedabc8fd1387462beb2a20fbe4e782) | ok |
| 4 | Move 37680 mUSD of surplus into the money-market vault | [0x76d2dfc3…](https://sepolia.basescan.org/tx/0x76d2dfc398cd30e23720f2cb4223c186a3d193b597526f5e26200a638726e18a) | ok |
| 5 | Anchor DAILY_REPORT evidence hash 0x3ed8dff9… | [0x0e722a9a…](https://sepolia.basescan.org/tx/0x0e722a9a6b3364d5e2dd6f99620ab901051d9f0b8e4dd92fa7c833c97bff1b3b) | ok |
<!-- evidence:end -->

### Earlier run (10 Oct, rules provider)

First Base Sepolia run (10 Oct, run 1791607899) used `MODEL_PROVIDER=rules`: the DeepSeek endpoint was not reachable from the deploy environment, so the extractor and planner ran on rules. Three earlier attempts the same day stopped on stale reads from the load-balanced public RPC (fixed in `agent/src/rpc.ts`); the third ended with the agent pausing PlanModule on a false ledger mismatch ([`0xf063d626…`](https://sepolia.basescan.org/tx/0xf063d6260a5ee66ffa220389a07ab0a659bff3df9056e59cb1c3cfac6bd6d1fb)), and owners 1 and 2 unpaused it ([`0x3034fadb…`](https://sepolia.basescan.org/tx/0x3034fadb7c734c76c12da69416d4df03a74234a7055d53978ea90328b858093e)). Those runs also count toward that day's spent caps.

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

## Yagi replay (local FISCO BCOS, stretch)

**Local chain only.** These hashes are from a 4-node FISCO BCOS v3.16.3 Air chain that we ran on one machine (web3 RPC on 127.0.0.1:8545, chain id 20200). There is no public explorer; they can be checked only on our node, and a rebuilt chain gives different hashes. Nothing here touched Base Sepolia or any public chain. Keys were throwaway keys made for this chain.

After the reconciliation fixes (issue #18) were merged, the same replay was run again on that chain against a fresh deployment of the merged code (run 1791983271): 28 transactions instead of 27, the extra one anchoring the new storm-period report, which reconciled with debt "ok" and transfer coverage "complete"; the fake Zalo message was again refused. The table below is the first run, matching `contracts/deployments/fisco.json`.

Run 1791982399 on 14 Oct 2026, 19:53 to 19:54 ICT (12:53 to 12:54 UTC), `MODEL_PROVIDER=rules`, `--speed 3600 --skip-everyday` (no ordinary day: the Yagi fixtures have no supplier invoices). GDACS TC-1001090 salted as TC-1001090#1791982399 = `0x51dc4d0785c69363121311a6048bf01e63b55343a9f254d323f695473b94faf9`. Times are the recorded 2024 times in ICT; the warning times in `data/replays/yagi-2024.json` are still marked approximate. Amounts are in mVND, a mock bank-issued VND deposit token (crypto is not a lawful means of payment in Vietnam), with 6 decimals like mUSD.

| # | Time (ICT) | Event | Action | Tx hash |
| --- | --- | --- | --- | --- |
| 1 | 2024-09-06 08:00 | GDACS alert (YAGI-24, event 1001090, Red) | GDACS attestation: TC-1001090 (Typhoon Yagi (bão số 3)), Red | `0x5ab6d2f88192e76aedbf13fcdaa10111d1530b7ce00554ba5d95881a809a0fc5` |
| 2 | 2024-09-06 08:00 | Risk level 4 warning (NCHMF → level 8) | NCHMF attestation: VN_RISK_4 (level 8) → StormStarted | `0x71123b5e98b91b2eb54b3063b7b3da90d05aa48e0bd763a3029ac72d6b51d6f5` |
| 3 | 2024-09-06 08:00 | Risk level 4 warning (NCHMF → level 8) | Anchor PRE_STORM evidence hash 0x0c388125… | `0xbbc1d721f25f14c0ec73c336f65c097255164eb4705ce429036dcd047f23d468` |
| 4 | 2024-09-06 08:00 | Risk level 4 warning (NCHMF → level 8) | Claimed the typhoon cover: 500,000,000 mVND paid to the Safe (storm plan) | `0x327b6b3f5dfb6bd363e2180ed9ca7bb55978ad6f4712222f025903b379a91ba1` |
| 5 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 10400000 mVND to Công nhân 01 under the storm plan (payroll:2024-08#1791982399) | `0xba6ca8d1f72f1beac957cb7fb58cc8308a51b098c4f2472a91c64d806b0731f9` |
| 6 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 10400000 mVND to Công nhân 02 under the storm plan (payroll:2024-08#1791982399) | `0xd37c033be0fa97813e950c71eabc0ba30b165804a98811006fdd3a597b918e0d` |
| 7 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 03 under the storm plan (payroll:2024-08#1791982399) | `0xfec1276f1fa761c6e3c1bde3314850c9ca7845b82d3a6e930f0b056bdbc3fedd` |
| 8 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 04 under the storm plan (payroll:2024-08#1791982399) | `0xd71b11e108fd1a41a2a44a852b1f12b185234347784e1762b0733a33c434245e` |
| 9 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 05 under the storm plan (payroll:2024-08#1791982399) | `0x46e678c7a609132d3c2bd8db5076181537dc58f9c96234d53126cc3d057c7ef2` |
| 10 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 06 under the storm plan (payroll:2024-08#1791982399) | `0xce14e35b30d11e4364d4f890c312bf676ff4722a399af29c286251ad05a71bc3` |
| 11 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 07 under the storm plan (payroll:2024-08#1791982399) | `0xfbf7916f5cb6e300a337cbab25669532e88d134f2e6656041d8990b1a7ff5493` |
| 12 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8600000 mVND to Công nhân 08 under the storm plan (payroll:2024-08#1791982399) | `0x1233f6f0afc707e73b1248d15aceb75d279acf9e1ea73a854c4160af7e5bc311` |
| 13 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 09 under the storm plan (payroll:2024-08#1791982399) | `0xaa0933df81414f39f46ddd5857e72b2febda48f486825389d0ac34f29bfd263e` |
| 14 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 10 under the storm plan (payroll:2024-08#1791982399) | `0xe53c3c9ae91bbb770b423a5a1a6be11a4a9b862c30bd2540bead2732badf203c` |
| 15 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 11 under the storm plan (payroll:2024-08#1791982399) | `0x41bdf10c416b46c16e46c9e2216ddd75b18573ca40802c451855ecd2162645fe` |
| 16 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 12 under the storm plan (payroll:2024-08#1791982399) | `0x7ff3fc0ce27ff13450513e8619b58e1651fd875df7405a7c39f86d44873e94d6` |
| 17 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 13 under the storm plan (payroll:2024-08#1791982399) | `0x3f91dc0c7a12a3d8f91fa7cef93a1203769f0ea28442a80e26d5461c132b773d` |
| 18 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 14 under the storm plan (payroll:2024-08#1791982399) | `0x976d8afea7882d3fb37b3459a1f7186da05965d6b128ad1e7b12937e9a503839` |
| 19 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 15 under the storm plan (payroll:2024-08#1791982399) | `0xd6955b3fc9d651e83816592ee9edbb6ebf30073b942b259f462c9837efa59db8` |
| 20 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 8000000 mVND to Công nhân 16 under the storm plan (payroll:2024-08#1791982399) | `0x61e7fb24ffb4925988292dd53efd709db97e7f1a8013a1028ce43452bd07200d` |
| 21 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 7400000 mVND to Công nhân 17 under the storm plan (payroll:2024-08#1791982399) | `0x8b76577a88ef2981e8cc1b070a34deebba6ae36e403f4fb60b052e57b75257d4` |
| 22 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 7400000 mVND to Công nhân 18 under the storm plan (payroll:2024-08#1791982399) | `0x47022967b55bc00599b7846a2eacae1dd2e28ed78881bd2896d20fe5c1a75618` |
| 23 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 7400000 mVND to Công nhân 19 under the storm plan (payroll:2024-08#1791982399) | `0xe5408464acccb66c8219165f5ef67acc81c0492264c086ae56e8407b27b7c533` |
| 24 | 2024-09-06 16:00 | Payday, August wages (storm mode on) | Pay 7400000 mVND to Công nhân 20 under the storm plan (payroll:2024-08#1791982399) | `0x28e51367d7d23dffc796298057e6ee6108e3db7feef0c65fdcd1b1a14e6af90d` |
| 25 | 2024-09-07 13:00 | Landfall, Quang Ninh / Hai Phong (level 10) | NCHMF attestation: VN_LANDFALL (level 10) | `0x0e93db6d74dd2a7540dd4b415baf094134b2b969decad636f72154197e154ac8` |
| - | 2024-09-07 15:00 | Fake Zalo "bank support" message (2,000,000 đ fee) | Refused at the planner (not an invoice); no transaction | n/a |
| 26 | 2024-09-08 12:00 | Warning lifted (level 0) | NCHMF attestation: VN_CANCEL (level 0) → StormEnded | `0xb26ad9c2ae806bebf61cf5da9a4815817581b5eba9a7569b3e180514d7555e91` |
| 27 | 2024-09-08 12:00 | Warning lifted (level 0) | Customer paid 125,000,000 mVND for INV-C-2024-09-08#1791982399 into PaymentRouter (simulated client, not the agent) | `0xf9d4a4ab1d76dfe15d52c20c385f91ed9781cdebea5fbe0ee563de69fac62c3f` |

All 27 receipts have status 1 (checked against the node after the run). Two more transactions of the run are on the chain but not in the table: the GDACS relayer's 0-value transfer to itself in block 16 (`0xc654313731cbcc64e51dbd303284c74260a1223fc390a8fcc0cc52429eec0176`), which seals a fresh block because FISCO makes no empty blocks and the chain had been idle for 75 s (see `agent/src/fisco.ts`), and the demo client's token approve for PaymentRouter in block 43 (`0xcad2e4ccca63ad16228f1953037a66c766f5c943594fe8fe7bfc5d5c19f5b597`). After the storm, the inflow was matched to INV-C-2024-09-08 (no sweep: nothing was drawn on the credit line), and the agent wrote three drafts for the owner: an English claim letter, a deadline list and the Circular 53/2024 restructuring request in Vietnamese (`agent/logs/drafts/<runId>/`, not committed).

What this run did not do: no credit draw (on payday the 13-week forecast, sized in dong, stayed above its buffer: 1,584 m mVND of cash after the cover and payroll, lowest projected point 384 m against a 250 m buffer); no vault withdraw at the brace (the vault was empty without an ordinary day); no owner proposals (there is no Safe on FISCO, and nothing was outside the plan). Final state on the node: the wallet holds 1,709,000,000 mVND, `isStorm` is false, the storm plan spent 166,000,000 mVND that day, and the cover is marked claimed for the salted event.

Deployment on the same chain (`contracts/deployments/fisco.json`), blocks 1 to 15, all status 1:

| Contract | Address | Deploy tx |
| --- | --- | --- |
| Wallet: `LocalSafe` (standalone, one admin; no Safe on FISCO) | `0xa2f9471a78255fA9b82DF08b40C1ffDdce4be454` | `0x28f201502936c6daab10bb4d4c9700f69a26af1b70d0dfbf4461cb9307aad4f4` |
| MockVNDDeposit (mVND) | `0x8d6e974602E5b9018cDB0a3C497da4fE327f65Ba` | `0x9d379f043e6e1095ed59d5ea358b9a6265cdad3cdc3821a410e4c692375ee956` |
| SignalAttestor (chain id 20200, timeUnit 1000, no HKO relayer) | `0xcc5d7a891557475Ea1df854a43d70c235EaA246E` | `0x6469cc99e8eb61c198eb9b27007d0d07ad45ec0357ba7fa1f561a3d8a8541d53` |
| MockMMFVault | `0xeF36830011409e6DCB53EBd0e1Ef32c347E43bf9` | `0xad64d501e886152abc94bf1e81a2e55db2a3da751d3eb0fc6f963d3cb96a4700` |
| FlowCreditLine | `0x8927a1132AfE6423081d708b71DDC0A75b847d9b` | `0xd4f7463b385ec7f14a831e2b58f255bb51f843fbc28e55065c9daa8db7b16bc3` |
| PaymentRouter | `0x345a8f4104550140E5136e34fA9AE708B9830515` | `0xef9829c88420cd4229e4d09ab5513f23450bf52d28f6410db9329a22611b5ee0` |
| MockSignalCover | `0xEf9E7D9E393EEFB8E37Acf1829d325E97439652E` | `0x402a99e800e8d985a22d3f7b15fab4466533535f59ace390edaaa3a2cdb5beeb` |
| EvidenceRegistry | `0x828df2204588a98dAeaEbd3DDBbcDb8A29fafeC4` | `0x767b38fd6c2ab1001b0e124e49a29fdc666ef6bf8548f4387220d4588e24f452` |
| PlanModule (timeUnit 1000) | `0xb7F7bDd530Ae9b2Ebc6FA99436b34ca36ED4a69a` | `0xc9c1709ae71771a019bba7a7652f700e9191ae39710fe6813519c787a71de3f7` |
| PlanGuard (deployed, unused: LocalSafe has no guard) | `0x9BEbDC50F850935c6C020a3648b1cff988381eA8` | `0xe10c771f2c6808efd993bbf58eb095de30e704184294e390ae5d433aba1a86c7` |

Mints (blocks 11 to 14) and the owner's `enableModule` (block 15, `0x88388c4ec45c2514c5aab0d8d9c97507684078f5cf61c472f936e1a23020be22`) complete the deployment.

To reproduce (a fresh chain gives new hashes): `bash contracts/fisco/build-local-chain.sh <deployer address>`, deploy with the command in [contracts/README.md](../contracts/README.md#local-fisco-bcos-yagi-stretch), then in `agent/` run `npm run replay -- --event yagi-2024 --skip-everyday` with `NETWORK=fisco` and the Yagi fixtures ([agent/README.md](../agent/README.md#yagi-on-a-local-fisco-bcos-chain)).
